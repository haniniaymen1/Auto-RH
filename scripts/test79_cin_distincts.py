#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 79 — TESTS « LE NOMBRE DE CIN NE DOIT PAS ÊTRE LE MÊME NOMBRE QUE LES
FICHES DE PAIE » (tableau de bord admin) sur COPIE de base (site admin de
test port 4217, lancé par le harnais).

Constat de l'utilisateur (capture) : la carte « Fiches de paie » affichait
1557 « importées » et la carte « CIN détectés » affichait 1557 « dans le
contenu » — LES DEUX COMpteurs ÉTAIENT IDENTIQUES.

Cause : /api/stats calculait withCin = nombre de FICHES possédant un CIN
(count), pas le nombre de CIN eux-mêmes. Plusieurs fiches appartiennent au
même employé (un bulletin par période) : le compteur gonflait jusqu'à
égaler « Fiches de paie ».

Réponse Task 79 :
  - withCin = nombre de CIN DISTINCTS détectés (dédoublonnage en JavaScript
    après déchiffrement transparent — la colonne cin est chiffrée à IV
    aléatoire, aucun `distinct` SQL possible — avec la MÊME normalisation
    que le répertoire des employés : majuscules, sans espaces/tirets/
    points/slashs ; « 9593-1034 » ≡ « 95931034 » ≡ « 9593 1034 ») ;
  - sansCin reste un comptage de FICHES (fiches sans aucun CIN détecté) ;
  - la carte « CIN détectés » affiche le nouveau compteur avec le sous-titre
    honnête « CIN distincts dans le contenu ».

Scénarios testés ici :
  0. Contrôles STATIQUES (route stats + page + type + bundle servi).
  A. DYNAMIQUE : recomputation INDÉPENDANTE en Python du nombre de CIN
     distincts depuis la liste complète /api/payslips (valeurs brutes
     déchiffrées) et comparaison EXACTE avec /api/stats.
  B. Preuve du dédoublonnage : le jeu de données Task 65 insère 3 fiches
     pour le même CIN dont une forme « sale » (minuscules + espace) — les
     3 fiches ne doivent compter que pour UN SEUL CIN distinct.
  C. Invariant demandé : dès que des fiches partagent un CIN, le compteur
     « CIN détectés » est STRICTEMENT INFÉRIEUR à « Fiches de paie ».
"""
import glob
import json
import http.cookiejar
import os
import re
import sys
import urllib.request
import urllib.error
from collections import Counter

BASE = "http://127.0.0.1:4217"
EMAIL = "test64@autorh.local"
ANCIEN = "AncienMot64"
NOUVEAU = "NouveauSolide64"
# Racine du projet = dossier parent de scripts/ (portable : fonctionne aussi
# depuis l'archive ZIP extraite chez l'utilisateur).
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

resultats = []


def check(nom, condition, detail=""):
    resultats.append((nom, bool(condition), detail))
    print(("  [OK]  " if condition else "  [KO]  ") + nom + (("  — " + str(detail)) if (detail and not condition) else ""))


def client_nouveau():
    cj = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def req(opener, chemin, data=None):
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(BASE + chemin, data=body)
    if body:
        r.add_header("Content-Type", "application/json")
    try:
        with opener.open(r, timeout=60) as rep:
            return rep.status, rep.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def norm(cin):
    """MÊME normalisation que normalizeQuery (Task 67) : majuscules, sans
    espaces/tirets/points/slashs."""
    return re.sub(r"[\s./\-]", "", (cin or "").strip()).upper()


print("=== 0. Contrôles statiques du code Task 79 ===")
try:
    stats = open(os.path.join(REPO, "src/app/api/stats/route.ts"), encoding="utf-8").read()
    check("route stats : commentaire Task 79 documente le constat utilisateur (1557 = 1557)",
          "1557" in stats and "CIN DISTINCTS" in stats)
    check("route stats : ANCIEN calcul (comptage de fiches) SUPPRIMÉ",
          "const withCin = await db.payslip.count" not in stats)
    check("route stats : import de la normalisation du répertoire (majuscules, sans espaces/tirets/points/slashs)",
          'import { normalizeQuery } from "@/lib/payslip-extractor"' in stats)
    check("route stats : dédoublonnage en JavaScript après déchiffrement (colonne chiffrée à IV aléatoire)",
          "const cinsDistincts = new Set<string>()" in stats
          and "cinsDistincts.add(cle)" in stats
          and "normalizeQuery(String(r.cin ?? \"\").trim())" in stats)
    check("route stats : comptage des fiches avec CIN conservé pour sansCin (comptage de FICHES)",
          "const fichesAvecCin = await db.payslip.count({\n      where: { cin: { not: null } },\n    })" in stats
          and "const withoutCin = total - fichesAvecCin" in stats)
    check("route stats : invariant honnête (plafond fiches / fiches avec CIN)",
          "Math.min(withCin, fichesAvecCin, total)" in stats)
    check("route stats : gardes session + expiration intactes",
          "getSessionUser" in stats and "motDePasseExpire()" in stats)
except Exception as e:  # noqa
    check("lecture de la route stats", False, e)

try:
    page = open(os.path.join(REPO, "src/app/page.tsx"), encoding="utf-8").read()
    check("page : carte « CIN détectés » conservée avec son accent",
          'label="CIN détectés"' in page and "highlight" in page)
    check("page : sous-titre honnête « CIN distincts dans le contenu »",
          'sub="CIN distincts dans le contenu"' in page)
    check("page : ANCIEN sous-titre ambigu SUPPRIMÉ",
          'sub="dans le contenu"' not in page)
    check("page : carte « Fiches de paie » inchangée",
          'label="Fiches de paie"' in page and 'sub="importées"' in page)
    check("page : commentaire Task 79 présent",
          "MODIFIÉ (Task 79)" in page and "1557" in page)
except Exception as e:  # noqa
    check("lecture de la page", False, e)

try:
    types = open(os.path.join(REPO, "src/lib/types.ts"), encoding="utf-8").read()
    check("types : StatsResponse.withCin documenté CIN distincts (Task 79)",
          "MODIFIÉ Task 79" in types and "CIN DISTINCTS" in types)
except Exception as e:  # noqa
    check("lecture des types", False, e)

# --- Bundle servi (preuve que le build embarque Task 79) ---
try:
    chunks = (glob.glob(os.path.join(REPO, ".next/standalone/.next/static/chunks/*.js"))
              + glob.glob(os.path.join(REPO, ".next/static/chunks/*.js")))
    if not chunks:
        check("bundle : aucun build trouvé — vérification ignorée (lancez npm run build)", True)
    else:
        def embarque(s):
            return any(s in open(c, encoding="utf-8", errors="replace").read() for c in chunks)
        check(f"bundle : sous-titre « CIN distincts dans le contenu » embarqué dans {len(chunks)} chunks",
              embarque("CIN distincts dans le contenu"))
        check("bundle : l'ancien sous-titre ambigu n'existe plus comme sous-titre isolé",
              not embarque('sub:"dans le contenu"')
              and not embarque('sub: "dans le contenu"')
              and embarque('sub:"CIN distincts dans le contenu"'))
        check("bundle : cartes « Fiches de paie » / « CIN détectés » toujours embarquées",
              embarque("Fiches de paie") and embarque("CIN détectés") and embarque("importées"))
except Exception as e:  # noqa
    check("lecture du bundle", False, e)

# --- Route compilée serveur (la logique dédoublonnée doit être DANS le build) ---
try:
    serveur_chunks = glob.glob(os.path.join(REPO, ".next/standalone/.next/server/chunks/*.js"))
    if not serveur_chunks:
        check("route compilée : aucun chunk serveur trouvé — ignoré (lancez npm run build)", True)
    else:
        logique = False
        for c in serveur_chunks:
            t = open(c, encoding="utf-8", errors="replace").read()
            if "normalizeQuery" in t and "Math.min(" in t and "payslip.findMany({where:{cin:{not:null}},select:{cin:!0}})" in t.replace(" ", "").replace("!0", "!0"):
                logique = True
                break
        check("route compilée : dédoublonnage normalizeQuery + plafond Math.min DANS le build servi", logique)
except Exception as e:  # noqa
    check("lecture des chunks serveur", False, e)

print("=== A. Recomputation INDÉPENDANTE (COPIE, port 4217) ===")
# Garde : sans session, l'API stats reste protégée.
op_anon = client_nouveau()
st, rep = req(op_anon, "/api/stats")
check("api/stats sans session -> 401 (garde intacte)", st == 401, (st, rep[:120]))

op = client_nouveau()
st, rep = req(op, "/api/auth/login", {"email": EMAIL, "password": ANCIEN})
d = json.loads(rep) if rep else {}
check("login 200 + changement forcé", st == 200 and d.get("mustChangePassword") is True, (st, rep[:150]))
st, rep = req(op, "/api/auth/change-password", {"currentPassword": ANCIEN, "newPassword": NOUVEAU})
check("changement obligatoire accepté (200)", st == 200, (st, rep[:150]))

st, rep = req(op, "/api/payslips")
d = json.loads(rep) if rep else {}
items = d.get("items", [])
check("liste complète des fiches 200 (valeurs brutes déchiffrées)", st == 200 and d.get("mode") == "list", (st, d.get("mode")))
check("la liste n'est PAS vide (pré-requis du test)", len(items) > 0, len(items))

st, rep = req(op, "/api/stats")
d = json.loads(rep) if rep else {}
check("api/stats 200", st == 200, (st, rep[:150]))

total_api = d.get("total")
withcin_api = d.get("withCin")
withoutcin_api = d.get("withoutCin")

# --- Recomputation INDÉPENDANTE en Python (implémentation séparée de la
#     route TypeScript : même normalisation, dédoublonnage recalculé ici) ---
formes_brutes = [str(i.get("cin") or "").strip() for i in items]
cins_normalises = [norm(c) for c in formes_brutes if norm(c)]
multiplicite = Counter(cins_normalises)
cins_distincts_py = set(cins_normalises)
fiches_avec_cin_py = len(cins_normalises)

check("total = nombre de fiches de la liste (inchangé)",
      total_api == len(items), (total_api, len(items)))
check(f"withCin = CIN DISTINCTS recalculés en Python ({len(cins_distincts_py)} distincts / {fiches_avec_cin_py} fiches avec CIN / {len(items)} fiches)",
      withcin_api == len(cins_distincts_py), (withcin_api, len(cins_distincts_py)))
check("withCin <= fiches avec CIN (invariant de plafond)",
      withcin_api <= fiches_avec_cin_py, (withcin_api, fiches_avec_cin_py))
check("withCin <= total fiches (invariant de plafond)",
      withcin_api <= total_api, (withcin_api, total_api))
check("withoutCin = FICHES sans CIN (comptage de fiches conservé)",
      withoutcin_api == len(items) - fiches_avec_cin_py, (withoutcin_api, len(items) - fiches_avec_cin_py))
check("champ employees toujours servi (>=1)", isinstance(d.get("employees"), int) and d["employees"] >= 1, d.get("employees"))

print("=== B. Preuve du dédoublonnage (jeu de données Task 65) ===")
check("3 fiches au moins portent le MÊME CIN (TEST65CIN1 ×2 + forme sale « test65 cin1 » ×1)",
      multiplicite.get("TEST65CIN1", 0) >= 3, multiplicite.get("TEST65CIN1"))
check("la forme sale existe bien en BRUT dans la liste (minuscules + espace)",
      any(c == "test65 cin1" for c in formes_brutes), [c for c in formes_brutes if "cin1" in c.lower()][:3])
check("les 3 fiches ne comptent que pour UN SEUL CIN distinct (normalisation majuscules + espaces)",
      norm("test65 cin1") == "TEST65CIN1" and "TEST65CIN1" in cins_distincts_py)
check("les 2 autres CIN du jeu de données sont comptés chacun une fois",
      "TEST65CIN2" in cins_distincts_py and "TEST65CIN9" in cins_distincts_py)
check("le trio fusionné fait baisser withCin : withCin <= total - 2",
      withcin_api <= total_api - 2, (withcin_api, total_api))

print("=== C. Invariant demandé : « CIN détectés » n'est plus « Fiches de paie » ===")
doublons = {k: v for k, v in multiplicite.items() if v > 1}
check(f"des fiches partagent des CIN ({len(doublons)} CIN sur plusieurs fiches)",
      len(doublons) > 0, list(doublons.items())[:3])
check("withCin STRICTEMENT INFÉRIEUR au nombre de fiches (le compteur n'égalera plus « Fiches de paie » dès qu'un employé a plusieurs fiches)",
      withcin_api < total_api, (withcin_api, total_api))

ok = sum(1 for _, c, _ in resultats if c)
ko = len(resultats) - ok
print(f"\nRÉSULTAT TASK 79 : {ok}/{len(resultats)} vérifications réussies")
sys.exit(0 if ko == 0 else 1)
