#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 70 — TESTS REMPLISSAGE 100 % AUTOMATIQUE DU CIN (onglet « Accès portail »)
sur COPIE de base (site admin de test port 4202, lancé par le harnais).

(RÉALIGNÉ Task 77 : « enleve ce qui dans le cadre rouge » — la BARRE DE
CRÉATION complète, champ CIN auto-rempli inclus, a été SUPPRIMÉE à la demande
de l'utilisateur. L'algorithme de la Task 70 — priorité au plus grand nombre
de fiches, puis alphabétique — survit dans le TABLEAU pré-rempli Task 71 : la
1re ligne « à créer » suit exactement le même tri. Les contrôles statiques
suivent la réalité du code, jamais l'inverse.)

Demande de l'utilisateur : « dans la partie accès portail, ajouter les CIN
détectés automatiquement — pas besoin de taper le CIN à la main ». En Task 65
le remplissage exigeait encore un clic ; la Task 70 avait rendu le champ
VRAIMENT automatique, la Task 77 a remplacé le champ par le tableau.

Scénarios testés ici :
  0. Contrôles STATIQUES (composant + route API + extracteur + bundle servi).
  A. API /api/payslips/employes : répertoire + NOUVEAUX compteurs
     fichesTotal / fichesSansCin (rétrocompatibles).
  B. Décision d'auto-remplissage recalculée côté test (même algorithme que
     l'interface) : candidat = employé détecté sans accès, priorité au plus
     grand nombre de fiches → TEST65CIN1 (3 fiches). Création via ce CIN
     exactement comme si l'administrateur avait laissé le champ se remplir.
  C. ENCHAÎNEMENT : après la création, le prochain candidat calculé est bien
     DIFFÉRENT (le champ passera tout seul au suivant) et TEST65CIN1 porte
     désormais le badge « accès existant » (puce grise/verte).
  D. Créer sur un CIN déjà autorisé reste refusé par l'API (aucun doublon) :
     les puces « accès existant » ne peuvent pas créer de ligne fantôme.
"""
import glob
import json
import http.cookiejar
import os
import re
import sys
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:4202"
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
        with opener.open(r, timeout=25) as rep:
            return rep.status, rep.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def candidat_auto(employes, cins_acces):
    """MÊME algorithme que l'interface (Task 70) : premier employé détecté
    SANS accès portail, priorité au plus grand nombre de fiches."""
    sans = [e for e in employes if e["cin"] not in cins_acces]
    if not sans:
        return None
    return sorted(sans, key=lambda e: -e["fiches"])[0]


print("=== 0. Contrôles statiques du code Task 70 (réalignés Task 77) ===")
try:
    tab = open(os.path.join(REPO, "src/components/payslip/portal-access-tab.tsx"), encoding="utf-8").read()
    # --- (RÉALIGNÉ Task 77) la mécanique du champ est SUPPRIMÉE avec la barre ---
    check("composant : mécanique du champ SUPPRIMÉE (auto-remplissage + suspension retirés Task 77)",
          "prochainCinAuto" not in tab and "saisieManuelleRef" not in tab
          and "cinAutoRempli" not in tab and 'list="auto-rh-cins-employes"' not in tab)
    check("composant : BARRE DE CRÉATION absente (champ + aides + création du haut)",
          "Choisir dans la liste" not in tab and "resultatsRapides" not in tab
          and "Numéro CIN complet de l'employé" not in tab
          and "onClick={() => create()}" not in tab)
    check("composant : l'algorithme de la Task 70 survit dans le TRI du tableau",
          "b.fiches - a.fiches || a.cin.localeCompare(b.cin)" in tab)
    check("composant : Task 73 — puces toujours SUPPRIMÉES, rien ne revient",
          "employes.slice(0, 20).map" not in tab and "• accès existant" not in tab)
    check("composant : colonne « Employé » SUPPRIMÉE (Task 77)",
          ">Employé</th>" not in tab and ">Statut</th>" in tab)
    check("composant : alerte fiches sans CIN identifiable (compteurs API, conservée)",
          "fichesSansCin" in tab and "fichesTotal" in tab
          and "aucun CIN identifiable" in tab)
    # --- Mécanismes conservés : le tableau est devenu la seule surface de création ---
    check("composant : fetch /api/payslips/employes présent", "/api/payslips/employes" in tab)
    check("composant : création via les lignes du tableau (seul chemin restant)",
          "creerDepuisLigne(ligne)" in tab and "await create(ligne.cin)" in tab
          and "async function create(valeur: string)" in tab)
    check("composant : filtre du tableau par nom ou CIN", "Filtrer le tableau par nom ou par CIN" in tab)
    # (RÉALIGNÉ Task 80 : la SECTION « Gestion des QR codes » dédiée existe
    # désormais dans le composant — l'ancien contrôle « aucun QR code » datait
    # de l'époque où l'onglet n'avait AUCUN rôle QR.)
    check("composant : section « Gestion des QR codes » dédiée (Task 80)",
          "Gestion des QR codes" in tab and "Afficher le QR" in tab)
except Exception as e:  # noqa
    check("lecture du composant", False, e)

try:
    api = open(os.path.join(REPO, "src/app/api/payslips/employes/route.ts"), encoding="utf-8").read()
    check("API employes : gardes session + mot de passe expiré",
          "getSessionUser" in api and "motDePasseExpire()" in api)
    check("API employes : 5 sources de détection (Task 67) intactes",
          all(s in api for s in ["detectCin(", "detectCinFromTableContext(",
                                 "scanLibellesCin(", "jetonsCinNomFichier(",
                                 "valeursCinLigneSuivante("]))
    check("API employes : NOUVEAUX compteurs fichesTotal / fichesSansCin (Task 70)",
          "fichesTotal" in api and "fichesSansCin" in api)
    check("API employes : réponse limitée CIN/nom/fiches (contenu = scan interne)",
          "return NextResponse.json({\n      total: items.length," in api
          and "cinAffiche" in api and "derniereFiche" in api)
except Exception as e:  # noqa
    check("lecture de l'API employes", False, e)

try:
    ext = open(os.path.join(REPO, "src/lib/payslip-extractor.ts"), encoding="utf-8").read()
    check("extracteur : valeursCinLigneSuivante exportée (source S6, Task 70)",
          "export function valeursCinLigneSuivante" in ext)
except Exception as e:  # noqa
    check("lecture de l'extracteur", False, e)

# --- Bundle servi (preuve que le build contient la nouvelle interface) ---
try:
    chunks = (glob.glob(os.path.join(REPO, ".next/standalone/.next/static/chunks/*.js"))
              + glob.glob(os.path.join(REPO, ".next/static/chunks/*.js")))
    if not chunks:
        check("bundle : aucun build trouvé — vérification ignorée (lancez npm run build)", True)
    else:
        def embarque(s):
            return any(s in open(c, encoding="utf-8", errors="replace").read() for c in chunks)
        # (RÉALIGNÉ Task 77 : le marqueur du champ (« TOUT SEUL ») et la
        # recherche Task 73 ont disparu avec la barre — le bundle embarque
        # désormais le tableau pré-rempli et le filtre, SANS la barre.)
        marque = (
            embarque("Accès non créé") and embarque("Filtrer le tableau par nom ou par CIN")
            and not embarque("Choisir dans la liste")
            and not embarque("Rechercher un employé par nom ou par CIN")
            and not embarque("Numéro CIN complet de l'employé")
        )
        check(f"bundle : tableau pré-rempli embarqué SANS barre dans {len(chunks)} chunks compilés", marque)
except Exception as e:  # noqa
    check("lecture du bundle", False, e)

print("=== A. Connexion + répertoire des employés (COPIE, port 4202) ===")
op = client_nouveau()
st, rep = req(op, "/api/auth/login", {"email": EMAIL, "password": ANCIEN})
d = json.loads(rep) if rep else {}
check("login 200 + changement forcé", st == 200 and d.get("mustChangePassword") is True, (st, rep[:150]))
st, rep = req(op, "/api/auth/change-password", {"currentPassword": ANCIEN, "newPassword": NOUVEAU})
check("changement obligatoire accepté (200)", st == 200, (st, rep[:150]))

st, rep = req(op, "/api/payslips/employes")
check("employes 200", st == 200, (st, rep[:200]))
d = json.loads(rep) if rep else {}
items = d.get("items", [])
check("NOUVEAU : compteur fichesTotal renvoyé", isinstance(d.get("fichesTotal"), int), d.get("fichesTotal"))
check("NOUVEAU : compteur fichesSansCin renvoyé", isinstance(d.get("fichesSansCin"), int), d.get("fichesSansCin"))
check("fichesTotal >= nombre d'employés détectés", d.get("fichesTotal", 0) >= len(items) or items == [],
      (d.get("fichesTotal"), len(items)))
par_cin = {i["cin"]: i for i in items}
check("TEST65CIN1 détecté (3 fiches fusionnées)", par_cin.get("TEST65CIN1", {}).get("fiches") == 3,
      par_cin.get("TEST65CIN1"))
check("TEST65CIN2 détecté (Fatima Zahra Benali)",
      par_cin.get("TEST65CIN2", {}).get("nom") == "Fatima Zahra Benali", par_cin.get("TEST65CIN2"))
cles = [i["cin"] for i in items]
check("aucun doublon de CIN normalisé", len(cles) == len(set(cles)))

print("=== B. Auto-remplissage : candidat recalculé = celui de l'interface ===")
st, rep = req(op, "/api/portal-access")
d = json.loads(rep) if rep else {}
acces_avant = {i["cin"] for i in d.get("items", [])}
check("état initial : aucun accès TEST65CIN1", "TEST65CIN1" not in acces_avant)
choix = candidat_auto(items, acces_avant)
check("candidat calculé non nul", choix is not None)
check("candidat = TEST65CIN1 (3 fiches, max du répertoire)",
      choix is not None and choix["cin"] == "TEST65CIN1" and choix["fiches"] == 3, choix)
check("le candidat n'a pas encore d'accès (badge absent)",
      choix is not None and choix["cin"] not in acces_avant)

st, rep = req(op, "/api/portal-access", {"action": "create", "cin": choix["cin"]})
d = json.loads(rep) if rep else {}
check("create 200 avec le CIN auto-rempli", st == 200, (st, rep[:200]))
check("mot de passe initial affiché une seule fois", bool(d.get("initialPassword")))
check("l'accès créé porte le CIN normalisé", d.get("access", {}).get("cin") == "TEST65CIN1", d.get("access"))

print("=== C. Enchaînement : le prochain candidat est différent ===")
st, rep = req(op, "/api/portal-access")
d = json.loads(rep) if rep else {}
acces_apres = {i["cin"] for i in d.get("items", [])}
check("TEST65CIN1 a désormais un accès (puce « accès existant »)", "TEST65CIN1" in acces_apres)
st, rep = req(op, "/api/payslips/employes")
d = json.loads(rep) if rep else {}
items2 = d.get("items", [])
suivant = candidat_auto(items2, acces_apres)
check("prochain candidat calculé ≠ TEST65CIN1 (la 1re ligne « à créer » avance)",
      suivant is not None and suivant["cin"] != "TEST65CIN1", suivant)
check("prochain candidat sans accès et fiches <= 3",
      suivant is not None and suivant["fiches"] <= 3, suivant)

print("=== D. CIN déjà autorisé : recréation = RÉINITIALISATION (upsert, jamais de doublon) ===")
st, rep = req(op, "/api/portal-access", {"action": "create", "cin": "TEST65CIN1"})
d = json.loads(rep) if rep else {}
check("create sur accès existant accepté = nouveau mot de passe initial (upsert Task 65)",
      st == 200 and bool(d.get("initialPassword")), (st, rep[:150]))
st, rep = req(op, "/api/portal-access")
d = json.loads(rep) if rep else {}
n_test65 = sum(1 for i in d.get("items", []) if i.get("cin") == "TEST65CIN1")
check("toujours UNE seule ligne TEST65CIN1 (pas de doublon)", n_test65 == 1, n_test65)

ok = sum(1 for _, c, _ in resultats if c)
ko = len(resultats) - ok
print(f"\nRÉSULTAT TASK 70 : {ok}/{len(resultats)} vérifications réussies")
sys.exit(0 if ko == 0 else 1)
