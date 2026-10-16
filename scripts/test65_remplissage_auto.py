#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 65 — TESTS REMPLISSAGE AUTOMATIQUE DU CIN sur COPIE de base
(site admin de test port 4201, lancé par le harnais de test).

Scénario :
  0. Contrôles STATIQUES du code (composant + nouvelle API).
  A. Connexion d'un compte EXPIRÉ → la NOUVELLE API /api/payslips/employes
     est bien refusée (403 MOT_DE_PASSE_EXPIRE) comme toutes les API de
     données (garde Task 64 présente dès la création, Task 65).
  B. Après changement de mot de passe obligatoire :
     - /api/payslips/employes 200 avec le répertoire des employés ;
     - DÉDOUBLONNAGE : TEST65CIN1 + « test65 cin1 » (forme sale) fusionnent
       en UNE entrée de 3 fiches, nom le plus récent « Karim El Alami » ;
     - TEST65CIN2 → « Fatima Zahra Benali » ; TEST65CIN9 → nom absent ;
     - ordre par nom (Fatima avant Karim, sans nom en dernier) ;
     - aucun doublon de CIN normalisé.
  C. REMPLISSAGE AUTOMATIQUE → CRÉATION : POST /api/portal-access avec le CIN
     EXACT renvoyé par le répertoire (comme si l'administrateur avait cliqué
     sur l'employé) → 200 + mot de passe initial ; l'accès existe.
  D. Cas limite : CIN « sale » passé au create (espaces/minuscules) →
     normalisé et fusionné sur l'accès existant (upsert, pas de doublon).
"""
import json
import http.cookiejar
import os
import re
import sys
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:4201"
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


print("=== 0. Contrôles statiques du code Task 65 ===")
try:
    tab = open(os.path.join(REPO, "src/components/payslip/portal-access-tab.tsx"), encoding="utf-8").read()
    # (RÉALIGNÉ Task 77 : la barre de création — champ CIN, datalist,
    # sélecteur, recherche — a été SUPPRIMÉE à la demande de l'utilisateur
    # (« enleve ce qui dans le cadre rouge ») ; le répertoire des employés
    # alimente désormais le TABLEAU pré-rempli Task 71, seule surface de
    # création. Les contrôles suivent la réalité du code, jamais l'inverse.)
    check("composant : fetch /api/payslips/employes présent", "/api/payslips/employes" in tab)
    check("composant : ancienne barre de création ABSENTE (Task 77 — datalist + sélecteur retirés)",
          'list="auto-rh-cins-employes"' not in tab and 'id="auto-rh-cins-employes"' not in tab
          and "Choisir dans la liste" not in tab
          and "function choisirEmploye" not in tab)
    check("composant : le répertoire alimente le tableau pré-rempli (Task 71/77)",
          "interface LigneTableau" in tab and "creerDepuisLigne(ligne)" in tab
          and "await create(ligne.cin)" in tab)
    check("composant : filtre du tableau par nom ou CIN conservé (service du sélecteur)",
          "Filtrer le tableau par nom ou par CIN" in tab)
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
    check("API employes : normalisation identique au portail", "normalizeQuery" in api)
    # MODIFIÉ Task 67 : le contenu des fiches est désormais LU par l'API pour
    # le scan interne (relance de détection sur les fiches sans colonne cin),
    # mais la RÉPONSE reste limitée à CIN/nom/fiches — vérification de la
    # liste blanche exacte des champs renvoyés.
    # MODIFIÉ Task 70 : la réponse ajoute les compteurs de diagnostic
    # fichesTotal / fichesSansCin (rétrocompatibles) — le return est multi-ligne.
    m_objet = re.search(r"repertoire\.set\(cle, \{(.*?)\}\);", api, re.S)
    champs = set(re.findall(r"(\w+):", m_objet.group(1))) if m_objet else set()
    check("API employes : réponse limitée à CIN/nom/fiches + compteurs Task 70 (contenu = scan interne uniquement)",
          m_objet is not None and champs == {"cin", "cinAffiche", "nom", "fiches", "derniereFiche"}
          and "total: items.length," in api
          and "fichesTotal" in api and "fichesSansCin" in api,
          champs)
except Exception as e:  # noqa
    check("lecture de l'API employes", False, e)

print("=== A. Compte expiré : la nouvelle API est gardée comme les autres ===")
op = client_nouveau()
st, rep = req(op, "/api/auth/login", {"email": EMAIL, "password": ANCIEN})
d = json.loads(rep) if rep else {}
check("login 200 + changement forcé", st == 200 and d.get("mustChangePassword") is True, (st, rep[:200]))
st, rep = req(op, "/api/payslips/employes")
check("employes 403 pendant l'expiration", st == 403, st)
check("code MOT_DE_PASSE_EXPIRE", "MOT_DE_PASSE_EXPIRE" in rep, rep[:200])

print("=== B. Changement obligatoire puis répertoire des employés ===")
st, rep = req(op, "/api/auth/change-password", {"currentPassword": ANCIEN, "newPassword": NOUVEAU})
check("changement accepté (200)", st == 200, (st, rep[:200]))
st, rep = req(op, "/api/payslips/employes")
check("employes 200 après changement", st == 200, (st, rep[:300]))
d = json.loads(rep) if rep else {}
items = d.get("items", [])
par_cin = {i.get("cin"): i for i in items}
check("TEST65CIN1 présent", "TEST65CIN1" in par_cin, sorted(par_cin)[:6])
check("TEST65CIN2 présent", "TEST65CIN2" in par_cin, sorted(par_cin)[:6])
check("TEST65CIN9 présent (sans nom)", "TEST65CIN9" in par_cin, sorted(par_cin)[:6])
k = par_cin.get("TEST65CIN1", {})
check("dédoublonnage : 3 fiches fusionnées pour TEST65CIN1", k.get("fiches") == 3, k)
check("nom le plus récent : Karim El Alami", k.get("nom") == "Karim El Alami", k.get("nom"))
check("cinAffiche = forme détectée", k.get("cinAffiche") in ("TEST65CIN1", "test65 cin1"), k.get("cinAffiche"))
f = par_cin.get("TEST65CIN2", {})
check("TEST65CIN2 → Fatima Zahra Benali (1 fiche)",
      f.get("nom") == "Fatima Zahra Benali" and f.get("fiches") == 1, f)
s = par_cin.get("TEST65CIN9", {})
check("TEST65CIN9 → nom absent (null) et fiches >= 1", s.get("nom") is None and s.get("fiches") == 1, s)
cles = [i["cin"] for i in items]
check("aucun doublon de CIN normalisé", len(cles) == len(set(cles)), len(cles) - len(set(cles)))
if "TEST65CIN2" in par_cin and "TEST65CIN1" in par_cin and "TEST65CIN9" in par_cin:
    i_f, i_k, i_s = cles.index("TEST65CIN2"), cles.index("TEST65CIN1"), cles.index("TEST65CIN9")
    check("tri par nom : Fatima < Karim < (sans nom)", i_f < i_k < i_s, (i_f, i_k, i_s))
else:
    check("tri par nom : Fatima < Karim < (sans nom)", False, "CIN de test absents")

print("=== C. Remplissage automatique → création de l'accès ===")
cinChoisi = par_cin.get("TEST65CIN2", {}).get("cin", "TEST65CIN2")
st, rep = req(op, "/api/portal-access", {"action": "create", "cin": cinChoisi})
d = json.loads(rep) if rep else {}
check("create 200 avec le CIN sélectionné", st == 200, (st, rep[:300]))
check("mot de passe initial affiché une fois", bool(d.get("initialPassword")), d.get("initialPassword"))
check("l'accès créé porte le CIN normalisé", d.get("access", {}).get("cin") == "TEST65CIN2", d.get("access"))
st, rep = req(op, "/api/portal-access")
d = json.loads(rep) if rep else {}
lignes = {i.get("cin"): i for i in d.get("items", [])}
ligne = lignes.get("TEST65CIN2", {})
check("l'accès apparaît dans la liste", bool(ligne), sorted(lignes)[:6])
check("hasPassword + changement requis", ligne.get("hasPassword") is True and ligne.get("mustChangePassword") is True, ligne)

print("=== D. Cas limite : CIN « sale » = upsert, jamais de doublon ===")
st, rep = req(op, "/api/portal-access", {"action": "create", "cin": "  test65 cin2 "})
check("create accepté même avec une forme sale", st == 200, (st, rep[:200]))
st, rep = req(op, "/api/portal-access")
d = json.loads(rep) if rep else {}
n_test65 = sum(1 for i in d.get("items", []) if i.get("cin") == "TEST65CIN2")
check("toujours UNE seule ligne TEST65CIN2 (upsert)", n_test65 == 1, n_test65)

ok = sum(1 for _, c, _ in resultats if c)
ko = len(resultats) - ok
print(f"\nRÉSULTAT REMPLISSAGE AUTO : {ok}/{len(resultats)} vérifications réussies")
sys.exit(0 if ko == 0 else 1)
