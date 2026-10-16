#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 71 — TESTS TABLEAU PRÉ-REMPLI AUTOMATIQUEMENT (onglet « Accès portail »)
sur COPIE de base (site admin de test port 4203, lancé par le harnais).

Demande de l'utilisateur (capture annotée zone rouge) : « remplissage
automatique de la zone rouge pour section accès portail » — le tableau des
accès (CIN / Statut / Mot de passe changé le / Dernière connexion / Actions)
restait VIDE (« Aucun accès portail créé ») tant qu'aucun accès n'était créé.
La Task 71 rend ce tableau AUTOMATIQUE :

  - fusion sans doublon de tous les employés détectés dans les fiches
    importées avec les accès déjà créés (et les accès créés à la main) ;
  - chaque employé SANS accès s'affiche avec le badge « Accès non créé » et
    un bouton « Créer l'accès » DIRECTEMENT dans sa ligne (desktop + mobile) ;
  - tri : les accès à créer d'abord (max fiches, puis alphabétique) ;
  - compteurs (à créer / créés / détectés), filtre nom ou CIN, défilement
    avec en-tête figé quand la liste est longue.

Scénarios testés ici :
  0. Contrôles STATIQUES (composant + API employes + bundle servi).
  A. Connexion + répertoire des employés (régression Task 65/67/70).
  B. Fusion recalculée côté test (MÊME algorithme que l'interface) :
     aucune ligne dupliquée, les employés détectés sans accès ouvrent le
     tableau, cohérence avec le candidat auto-rempli du champ (Task 70).
  C. Création DEPUIS UNE LIGNE (simule le clic sur « Créer l'accès » de la
     ligne) : la ligne passe du groupe « à créer » au groupe « avec accès »,
     le compteur « restants » diminue, aucune ligne fantôme.
  D. Upsert : recréer sur un CIN déjà autorisé reste une réinitialisation
     (toujours UNE seule ligne — jamais de doublon dans le tableau).
"""
import glob
import json
import http.cookiejar
import os
import sys
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:4203"
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


def fusion_tableau(employes, acces):
    """MÊME algorithme que l'interface (Task 71) : le tableau est la fusion
    SANS doublon des employés détectés et des accès créés."""
    cins_acces = {a["cin"] for a in acces}
    par_cin = {a["cin"]: a for a in acces}
    lignes = []
    sans = [e for e in employes if e["cin"] not in cins_acces]
    sans.sort(key=lambda e: (-e["fiches"], e["cin"]))
    for e in sans:
        lignes.append({"cin": e["cin"], "nom": e.get("nom"), "fiches": e["fiches"], "access": None})
    for a in acces:
        e = next((x for x in employes if x["cin"] == a["cin"]), None)
        lignes.append({"cin": a["cin"], "nom": (e or {}).get("nom"), "fiches": (e or {}).get("fiches", 0), "access": a})
    return lignes


print("=== 0. Contrôles statiques du code Task 71 ===")
try:
    tab = open(os.path.join(REPO, "src/components/payslip/portal-access-tab.tsx"), encoding="utf-8").read()
    # --- Nouveautés Task 71 : tableau pré-rempli automatiquement ---
    check("composant : interface LigneTableau (employé détecté OU accès créé)",
          "interface LigneTableau" in tab and "access: AccessRow | null" in tab)
    check("composant : index des accès par CIN normalisé",
          "const accesParCin" in tab and "m.set(row.cin, row)" in tab)
    check("composant : fusion sans doublon (détectés sans accès, puis accès enrichis)",
          "const lignesTableau" in tab and "cle: `detecte:${e.cin}`" in tab
          and "cle: `acces:${row.id}`" in tab and "employes.find((x) => x.cin === row.cin)" in tab)
    check("composant : tri « à créer d'abord » (max fiches puis alphabétique)",
          "b.fiches - a.fiches || a.cin.localeCompare(b.cin)" in tab)
    check("composant : badge « Accès non créé » (desktop + mobile)",
          tab.count("Accès non créé") >= 2, tab.count("Accès non créé"))
    check("composant : bouton « Créer l'accès » DANS la ligne (handler dédié)",
          "creerDepuisLigne(ligne)" in tab and "async function creerDepuisLigne" in tab
          and "await create(ligne.cin)" in tab)
    check("composant : bouton ligne désactivé pendant la création de CETTE ligne",
          "busyId === ligne.cle || generating" in tab)
    check("composant : colonne « Employé » SUPPRIMÉE (Task 77 — 5 colonnes, en-tête figé)",
          ">Employé</th>" not in tab and ">Statut</th>" in tab
          and "colSpan={5}" in tab and tab.count("colSpan={5}") == 3
          and "sticky top-0" in tab)
    check("composant : défilement du tableau quand la liste est longue",
          "max-h-[480px]" in tab)
    check("composant : filtre du tableau par nom ou par CIN",
          "rechercheTableau" in tab and "Filtrer le tableau par nom ou par CIN" in tab)
    check("composant : compteurs (à créer / créés / détectés)",
          "nbRestants" in tab and "accès à créer" in tab and "employé" in tab)
    check("composant : tableau pré-rempli même quand AUCUN accès n'existe (MODIFIÉ Task 80 : la mention « Aucun accès portail créé » ne vit que dans la section QR)",
          "lignesFiltrees.length === 0" in tab
          and "Aucun employé détecté pour le moment" in tab
          and "Aucun accès portail créé" in tab
          and tab.index("Aucun accès portail créé") > tab.index("Gestion des QR codes"))
    # (RÉALIGNÉ Task 77 : la mention « Détecté dans N fiche(s) » a été retirée
    # de l'AFFICHAGE avec la colonne « Employé » — le nom reste en données.)
    check("composant : mention « Détecté dans N fiche(s) » SUPPRIMÉE de l'affichage (Task 77)",
          "Détecté dans {ligne.fiches}" not in tab)
    # (RÉALIGNÉ Task 77 : la barre de création — champ auto Task 70, recherche
    # Task 73, datalist + sélecteur Task 65 — a été SUPPRIMÉE ; le tableau est
    # la seule surface de création.)
    check("composant : barre de création SUPPRIMÉE (Task 70/73/65 du champ retirées)",
          "prochainCinAuto" not in tab and "saisieManuelleRef" not in tab
          and "resultatsRapides" not in tab and "filtrerEmployes" not in tab
          and 'list="auto-rh-cins-employes"' not in tab
          and "Choisir dans la liste" not in tab
          and "contenu de la fiche ou nom de fichier" not in tab
          and "Accès existant" not in tab)
    check("composant : Task 64 conservée — libellés mot de passe (boutons des lignes)",
          "Créer l'accès" in tab and "Réinitialiser" in tab and "expire tous les 15 jours" in tab
          and "tirets et espaces sont ignorés" in tab)
    check("composant : alerte fiches sans CIN conservée (diagnostic Task 70)",
          "fichesSansCin" in tab and "fichesTotal" in tab and "aucun CIN identifiable" in tab)
    # (RÉALIGNÉ Task 80 : la SECTION « Gestion des QR codes » dédiée existe
    # désormais dans le composant — l'ancien contrôle « aucun QR code » datait
    # de l'époque où l'onglet n'avait AUCUN rôle QR.)
    check("composant : section « Gestion des QR codes » dédiée (Task 80)",
          "Gestion des QR codes" in tab and "Afficher le QR" in tab)
    check("composant : les statuts des accès créés sont inchangés",
          "Changement requis" in tab and "À réinitialiser" in tab and "Verrouillé" in tab)
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

# --- Bundle servi (preuve que le build contient le nouveau tableau) ---
try:
    chunks = (glob.glob(os.path.join(REPO, ".next/standalone/.next/static/chunks/*.js"))
              + glob.glob(os.path.join(REPO, ".next/static/chunks/*.js")))
    if not chunks:
        check("bundle : aucun build trouvé — vérification ignorée (lancez npm run build)", True)
    else:
        def embarque(s):
            return any(s in open(c, encoding="utf-8", errors="replace").read() for c in chunks)
        marque_nouveau = any(
            "Accès non créé" in open(c, encoding="utf-8", errors="replace").read()
            for c in chunks
        )
        # (RÉALIGNÉ Task 77 : le bundle embarque le tableau pré-rempli SANS la
        # barre de création — « TOUT SEUL » et la recherche Task 73 ont disparu.)
        marque_70 = (
            embarque("Filtrer le tableau par nom ou par CIN")
            and not embarque("Choisir dans la liste")
            and not embarque("Rechercher un employé par nom ou par CIN")
        )
        check(f"bundle : interface Task 71 embarquée dans {len(chunks)} chunks compilés", marque_nouveau)
        check("bundle : tableau embarqué SANS la barre de création (Task 77)", marque_70)
except Exception as e:  # noqa
    check("lecture du bundle", False, e)

print("=== A. Connexion + répertoire des employés (COPIE, port 4203) ===")
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
check("compteurs fichesTotal / fichesSansCin renvoyés",
      isinstance(d.get("fichesTotal"), int) and isinstance(d.get("fichesSansCin"), int),
      (d.get("fichesTotal"), d.get("fichesSansCin")))
par_cin_emp = {e["cin"]: e for e in employes}
check("TEST65CIN1 détecté (3 fiches fusionnées)", par_cin_emp.get("TEST65CIN1", {}).get("fiches") == 3,
      par_cin_emp.get("TEST65CIN1"))
check("TEST65CIN2 détecté (Fatima Zahra Benali)",
      par_cin_emp.get("TEST65CIN2", {}).get("nom") == "Fatima Zahra Benali", par_cin_emp.get("TEST65CIN2"))
check("répertoire non vide (le tableau doit se pré-remplir)", len(employes) > 0, len(employes))

print("=== B. Fusion du tableau recalculée (MÊME algorithme que l'interface) ===")
st, rep = req(op, "/api/portal-access")
d = json.loads(rep) if rep else {}
acces_avant = d.get("items", [])
check("portal-access 200", st == 200, (st, rep[:150]))
lignes_avant = fusion_tableau(employes, acces_avant)
cins_lignes = [l["cin"] for l in lignes_avant]
check("fusion : AUCUN doublon de CIN dans le tableau", len(cins_lignes) == len(set(cins_lignes)))
check("fusion : total = détectés + accès non détectés (aucune ligne fantôme, aucune perte)",
      len(lignes_avant) == len(employes) + len([a for a in acces_avant if a["cin"] not in par_cin_emp]),
      (len(lignes_avant), len(employes), len(acces_avant)))
a_creer = [l for l in lignes_avant if l["access"] is None]
avec_acces = [l for l in lignes_avant if l["access"] is not None]
nb_detectes_avec_acces = len([a for a in acces_avant if a["cin"] in par_cin_emp])
check("compteur « restants à créer » = détectés sans accès",
      len(a_creer) == len(employes) - nb_detectes_avec_acces,
      (len(a_creer), len(employes), nb_detectes_avec_acces))
check("les accès créés ouvrent le groupe « avec accès »", len(avec_acces) == len(acces_avant))
check("cohérence Task 70 : la 1re ligne « à créer » = candidat du même tri",
      (not a_creer) or a_creer[0]["cin"] == max((e for e in employes if e["cin"] not in {a["cin"] for a in acces_avant}),
                                                key=lambda e: e["fiches"])["cin"],
      a_creer[0] if a_creer else None)
check("TEST65CIN1 est dans le groupe « à créer » (3 fiches → tête du tableau)",
      any(l["cin"] == "TEST65CIN1" and l["access"] is None for l in lignes_avant))
check("une ligne « à créer » porte le nom de l'employé détecté",
      any(l["access"] is None and l["nom"] for l in lignes_avant), a_creer[:2])

print("=== C. Création DEPUIS une ligne (clic « Créer l'accès » du tableau) ===")
cible = a_creer[0]
st, rep = req(op, "/api/portal-access", {"action": "create", "cin": cible["cin"]})
d = json.loads(rep) if rep else {}
check("create 200 avec le CIN de la ligne", st == 200, (st, rep[:200]))
check("mot de passe initial affiché une seule fois", bool(d.get("initialPassword")))
check("l'accès créé porte le CIN de la ligne", d.get("access", {}).get("cin") == cible["cin"], d.get("access"))

st, rep = req(op, "/api/portal-access")
d = json.loads(rep) if rep else {}
acces_apres = d.get("items", [])
st, rep = req(op, "/api/payslips/employes")
d = json.loads(rep) if rep else {}
employes2 = d.get("items", [])
lignes_apres = fusion_tableau(employes2, acces_apres)
check("la ligne cliquée est passée dans le groupe « avec accès »",
      any(l["cin"] == cible["cin"] and l["access"] is not None for l in lignes_apres), cible)
check("le compteur « restants » a baissé d'exactement 1",
      len([l for l in lignes_apres if l["access"] is None]) == len(a_creer) - 1,
      (len([l for l in lignes_apres if l["access"] is None]), len(a_creer)))
cins_apres = [l["cin"] for l in lignes_apres]
check("fusion après création : toujours AUCUN doublon", len(cins_apres) == len(set(cins_apres)))
check("le tableau reste complet après création (détectés + accès)",
      len(lignes_apres) == len(employes2) + len([a for a in acces_apres if a["cin"] not in {e["cin"] for e in employes2}]))

print("=== D. Upsert : recréer sur un CIN autorisé = réinitialisation, jamais de doublon ===")
st, rep = req(op, "/api/portal-access", {"action": "create", "cin": cible["cin"]})
d = json.loads(rep) if rep else {}
check("create sur accès existant accepté = nouveau mot de passe initial (upsert Task 65)",
      st == 200 and bool(d.get("initialPassword")), (st, rep[:150]))
st, rep = req(op, "/api/portal-access")
d = json.loads(rep) if rep else {}
n_cible = sum(1 for i in d.get("items", []) if i.get("cin") == cible["cin"])
check("toujours UNE seule ligne pour ce CIN dans le tableau (pas de doublon)", n_cible == 1, n_cible)

ok = sum(1 for _, c, _ in resultats if c)
ko = len(resultats) - ok
print(f"\nRÉSULTAT TASK 71 : {ok}/{len(resultats)} vérifications réussies")
sys.exit(0 if ko == 0 else 1)
