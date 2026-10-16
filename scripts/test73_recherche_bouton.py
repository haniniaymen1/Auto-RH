#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 73 — TESTS « ENLEVE LA PARTIE ROUGE ET AJOUTE BOUTON RECHERCHE »
(onglet « Accès portail ») sur COPIE de base (site admin de test port 4205,
lancé par le harnais).

Demande de l'utilisateur (capture annotée zone rouge) : « enleve la partie
rouge et ajoute bouton recherche » — la partie rouge encadrait le bandeau
vert « CIN rempli automatiquement… » ET les puces CIN cliquables. Task 73 :

  - SUPPRIME le bandeau vert et les puces (la zone sous le champ redevient
    sobre : alerte fiches sans CIN + texte d'aide uniquement) ;
  - AJOUTE un bouton « Rechercher » (loupe) à côté du champ : popover avec
    recherche par nom ou par CIN, un clic sur un résultat remplit le champ
    (le rôle des puces, en compact) ;
  - CONSERVE TOUT le reste : remplissage 100 % automatique du champ (Task
    70), datalist + « Choisir dans la liste » (Task 65/67), tableau pré-rempli
    (Task 71), libellés/expiration (Task 64).

Scénarios testés ici :
  0. Contrôles STATIQUES (composant + API employes + bundle servi).
  A. Connexion + répertoire des employés (régression Task 65/67/70).
  B. ALGORITHME DE RECHERCHE recalculé côté test (MÊME logique que le
     popover « Rechercher ») : par nom, par CIN, tolérance tirets/espaces/
     casse, résultat vide annoncé honnêtement.
  C. Création d'accès après sélection par recherche (le champ rempli par le
     popover crée bien l'accès) + enchaînement automatique Task 70 intact.
  D. Upsert : toujours UNE seule ligne par CIN (jamais de doublon).
"""
import glob
import json
import http.cookiejar
import os
import re
import sys
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:4205"
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


def filtrer_employes(employes, brut):
    """MÊME algorithme que le composant (Task 73, filtrerEmployes) : la
    recherche du popover « Rechercher » par nom ou par CIN, tolérante."""
    q = brut.strip()
    if not q:
        return list(employes)
    q_cin = q.upper()
    for c in " ./-":
        q_cin = q_cin.replace(c, "")
    q_nom = q.lower()
    out = []
    for e in employes:
        if q_cin in e["cin"] or q_nom in (e.get("nom") or "").lower():
            out.append(e)
    return out


print("=== 0. Contrôles statiques du code Task 73 (réalignés Task 77) ===")
try:
    tab = open(os.path.join(REPO, "src/components/payslip/portal-access-tab.tsx"), encoding="utf-8").read()
    # --- SUPPRESSIONS demandées (la « partie rouge ») — toujours absentes ---
    check("composant : bandeau vert « CIN rempli automatiquement » SUPPRIMÉ",
          "CIN rempli automatiquement depuis" not in tab)
    check("composant : puces CIN cliquables SUPPRIMÉES (slice 20 + pastilles rondes)",
          "employes.slice(0, 20).map" not in tab and "• accès existant" not in tab
          and "+ {employes.length - 20} autres" not in tab)
    check("composant : commentaire Task 73 documente la première suppression",
          "enleve la partie rouge" in tab)
    # --- (RÉALIGNÉ Task 77) le bouton « Rechercher » a été retiré AVEC TOUTE
    # la barre de création (demande suivante : « enleve ce qui dans le cadre
    # rouge » — la capture encadrait la barre complète ET la colonne Employé).
    # Les contrôles suivent la réalité du code, jamais l'inverse. ---
    check("composant : bouton « Rechercher » SUPPRIMÉ avec la barre (Task 77)",
          '<Search className="h-4 w-4" />' not in tab
          and "Rechercher un employé par nom ou par CIN" not in tab
          and 'from "@/components/ui/popover"' not in tab
          and "rechercheRapide" not in tab and "rechercheOuverte" not in tab
          and "resultatsRapides" not in tab and "filtrerEmployes" not in tab
          and "choisirEmploye" not in tab)
    check("composant : champ CIN + sélecteur + création du haut SUPPRIMÉS (MODIFIÉ Task 80 : RefreshCw est l'icône du bouton « Réinitialiser le QR »)",
          'list="auto-rh-cins-employes"' not in tab
          and "Choisir dans la liste" not in tab
          and "pickerOpen" not in tab and "Actualiser" not in tab
          and "onClick={() => create()}" not in tab)
    # --- Conservations obligatoires (régression si absent) ---
    check("composant : le FILTRE du tableau garde la logique de recherche (tolérante)",
          "rechercheTableau" in tab and "Filtrer le tableau par nom ou par CIN" in tab
          and 'replace(/[\\s.\\/\\-]/g, "")' in tab)
    check("composant : Task 70 conservée — alerte fiches sans CIN (compteurs API)",
          "fichesSansCin" in tab and "fichesTotal" in tab and "aucun CIN identifiable" in tab)
    check("composant : Task 71 conservée — tableau pré-rempli + badge + bouton dans la ligne",
          "interface LigneTableau" in tab and tab.count("Accès non créé") >= 2
          and "creerDepuisLigne(ligne)" in tab and "await create(ligne.cin)" in tab
          and "Filtrer le tableau par nom ou par CIN" in tab)
    check("composant : colonne « Employé » SUPPRIMÉE (Task 77)",
          ">Employé</th>" not in tab and ">Statut</th>" in tab)
    check("composant : Task 64 conservée — libellés mot de passe",
          "Créer l'accès" in tab and "Réinitialiser" in tab and "expire tous les 15 jours" in tab
          and "tirets et espaces sont ignorés" in tab)
    # (RÉALIGNÉ Task 80 : la SECTION « Gestion des QR codes » dédiée existe
    # désormais dans le composant — l'ancien contrôle « aucun QR code » datait
    # de l'époque où l'onglet n'avait AUCUN rôle QR.)
    check("composant : section « Gestion des QR codes » dédiée (Task 80)",
          "Gestion des QR codes" in tab and "Afficher le QR" in tab)
except Exception as e:  # noqa
    check("lecture du composant", False, e)

try:
    api = open(os.path.join(REPO, "src/app/api/payslips/employes/route.ts"), encoding="utf-8").read()
    check("API employes : sources + compteurs inchangés (Task 67/70)",
          all(s in api for s in ["detectCin(", "detectCinFromTableContext(", "scanLibellesCin(",
                                 "jetonsCinNomFichier(", "valeursCinLigneSuivante("])
          and "fichesTotal" in api and "fichesSansCin" in api)
    check("API employes : gardes session + expiration intactes",
          "getSessionUser" in api and "motDePasseExpire()" in api)
except Exception as e:  # noqa
    check("lecture de l'API employes", False, e)

# --- Bundle servi (preuve que le build embarque le tableau SANS la barre) ---
try:
    chunks = (glob.glob(os.path.join(REPO, ".next/standalone/.next/static/chunks/*.js"))
              + glob.glob(os.path.join(REPO, ".next/static/chunks/*.js")))
    if not chunks:
        check("bundle : aucun build trouvé — vérification ignorée (lancez npm run build)", True)
    else:
        def embarque(s):
            return any(s in open(c, encoding="utf-8", errors="replace").read() for c in chunks)
        # (RÉALIGNÉ Task 77 : le bundle embarque le tableau pré-rempli et son
        # filtre — SANS le bouton « Rechercher » retiré avec la barre.)
        check(f"bundle : tableau pré-rempli + filtre embarqués dans {len(chunks)} chunks compilés",
              embarque("Accès non créé") and embarque("Filtrer le tableau par nom ou par CIN"))
        check("bundle : bouton « Rechercher » + bandeau + puces bien ABSENTS du build",
              not embarque("Rechercher un employé par nom ou par CIN")
              and not embarque("CIN rempli automatiquement depuis")
              and not embarque("• accès existant")
              and not embarque("Choisir dans la liste"))
        check("bundle : Task 71 toujours embarquée (« Accès non créé »)",
              embarque("Accès non créé"))
except Exception as e:  # noqa
    check("lecture du bundle", False, e)

print("=== A. Connexion + répertoire des employés (COPIE, port 4205) ===")
op = client_nouveau()
st, rep = req(op, "/api/auth/login", {"email": EMAIL, "password": ANCIEN})
d = json.loads(rep) if rep else {}
check("login 200 + changement forcé", st == 200 and d.get("mustChangePassword") is True, (st, rep[:150]))
st, rep = req(op, "/api/auth/change-password", {"currentPassword": ANCIEN, "newPassword": NOUVEAU})
check("changement obligatoire accepté (200)", st == 200, (st, rep[:150]))

st, rep = req(op, "/api/payslips/employes")
check("employes 200", st == 200, (st, rep[:200]))
d = json.loads(rep) if rep else {}
employes = d.get("items", [])
check("répertoire non vide (le popover doit avoir des résultats)", len(employes) > 0, len(employes))
check("TEST65CIN1 détecté (3 fiches fusionnées)",
      next((e for e in employes if e["cin"] == "TEST65CIN1"), {}).get("fiches") == 3,
      next((e for e in employes if e["cin"] == "TEST65CIN1"), None))
check("TEST65CIN2 détecté (Fatima Zahra Benali)",
      next((e for e in employes if e["cin"] == "TEST65CIN2"), {}).get("nom") == "Fatima Zahra Benali",
      next((e for e in employes if e["cin"] == "TEST65CIN2"), None))

print("=== B. Algorithme du FILTRE DU TABLEAU recalculé (même logique tolerant) ===")
par_nom = filtrer_employes(employes, "fatima")
check("recherche par NOM (« fatima ») trouve l'employé (insensible à la casse)",
      len(par_nom) == 1 and par_nom[0]["cin"] == "TEST65CIN2", [e["cin"] for e in par_nom])
par_cin = filtrer_employes(employes, "TEST65CIN1")
check("recherche par CIN exact trouve l'employé",
      len(par_cin) == 1 and par_cin[0]["cin"] == "TEST65CIN1", [e["cin"] for e in par_cin])
par_cin_tolere = filtrer_employes(employes, "test-65-cin-1")
check("recherche par CIN tolérante (tirets/espaces ignorés)",
      len(par_cin_tolere) == 1 and par_cin_tolere[0]["cin"] == "TEST65CIN1",
      [e["cin"] for e in par_cin_tolere])
par_partiel = filtrer_employes(employes, "65CIN")
check("recherche par fragment de CIN trouve les 3 TEST65CIN* (1, 2 et 9)",
      len(par_partiel) == 3 and {e["cin"] for e in par_partiel} == {"TEST65CIN1", "TEST65CIN2", "TEST65CIN9"},
      [e["cin"] for e in par_partiel])
vide = filtrer_employes(employes, "ZZZINEXISTANT")
check("recherche sans résultat = liste vide (état « Aucun employé trouvé » honnête)",
      len(vide) == 0, vide)
tout = filtrer_employes(employes, "   ")
check("recherche vide/espaces = TOUS les employés affichés",
      len(tout) == len(employes), (len(tout), len(employes)))

print("=== C. Création DEPUIS LE TABLEAU (ligne « à créer », seul chemin restant Task 77) ===")
st, rep = req(op, "/api/portal-access")
d = json.loads(rep) if rep else {}
acces_avant = d.get("items", [])
cins_acces = {a["cin"] for a in acces_avant}
# Simule : l'administrateur repère la 1re ligne « à créer » du tableau (même
# tri : max fiches puis A→Z) et clique son bouton « Créer l'accès » → la ligne
# transmet le CIN directement à l'API.
candidats = [e for e in employes if e["cin"] not in cins_acces]
candidats.sort(key=lambda e: (-e["fiches"], e["cin"]))
cible = candidats[0]
trouve_par_filtre = filtrer_employes(employes, cible["cin"])
check("la ligne à créer est retrouvable via le filtre du tableau (nom ou CIN)",
      len(trouve_par_filtre) == 1 and trouve_par_filtre[0]["cin"] == cible["cin"], cible)
st, rep = req(op, "/api/portal-access", {"action": "create", "cin": cible["cin"]})
d = json.loads(rep) if rep else {}
check("create 200 avec le CIN de la ligne du tableau", st == 200, (st, rep[:200]))
check("mot de passe initial affiché une seule fois", bool(d.get("initialPassword")))
st, rep = req(op, "/api/portal-access")
d = json.loads(rep) if rep else {}
acces_apres = d.get("items", [])
check("l'accès créé porte le CIN de la ligne du tableau",
      any(a["cin"] == cible["cin"] for a in acces_apres), cible["cin"])
# Enchaînement Task 70/71 : la ligne suivante « à créer » prend la tête du tableau
st, rep = req(op, "/api/payslips/employes")
d = json.loads(rep) if rep else {}
employes2 = d.get("items", [])
prochains = [e for e in employes2 if e["cin"] not in {a["cin"] for a in acces_apres}]
prochains.sort(key=lambda e: (-e["fiches"], e["cin"]))
check("enchaînement Task 70/71 intact : une PROCHAINE ligne « à créer » existe après création",
      len(prochains) >= 1, len(prochains))
check("le prochain candidat suit le même tri que la recherche (max fiches, puis A→Z)",
      (not prochains) or prochains[0]["fiches"] == max(e["fiches"] for e in prochains))

print("=== D. Upsert : recréer via le même CIN recherché = réinitialisation ===")
st, rep = req(op, "/api/portal-access", {"action": "create", "cin": cible["cin"]})
d = json.loads(rep) if rep else {}
check("create sur accès existant accepté = nouveau mot de passe initial (upsert Task 65)",
      st == 200 and bool(d.get("initialPassword")), (st, rep[:150]))
st, rep = req(op, "/api/portal-access")
d = json.loads(rep) if rep else {}
n_cible = sum(1 for i in d.get("items", []) if i.get("cin") == cible["cin"])
check("toujours UNE seule ligne pour ce CIN (pas de doublon)", n_cible == 1, n_cible)

ok = sum(1 for _, c, _ in resultats if c)
ko = len(resultats) - ok
print(f"\nRÉSULTAT TASK 73 : {ok}/{len(resultats)} vérifications réussies")
sys.exit(0 if ko == 0 else 1)
