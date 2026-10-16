#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 77 — TESTS « ENLEVE CE QUI DANS LE CADRE ROUGE » (onglet « Accès portail »)
sur COPIE de base (site admin de test port 4214, lancé par le harnais).

Demande de l'utilisateur (capture annotée, DEUX cadres rouges) :
  1. la BARRE DE CRÉATION complète : champ CIN (« 140006377 ») + « Choisir
     dans la liste » + « Rechercher » + « Créer l'accès » + bouton actualiser ;
  2. la COLONNE « Employé » du tableau (nom + « Détecté dans 1 fiche
     importée » — affichait « PRENOM » sur toutes les lignes).

Réponse Task 77 :
  - barre de création SUPPRIMÉE (avec le datalist, le paragraphe « Remplissage
    100 % automatique » et le sélecteur dialogué qui ne servaient qu'à remplir
    le champ) : la création passe EXCLUSIVEMENT par le bouton « Créer l'accès »
    de chaque ligne du tableau pré-rempli (Task 71) ;
  - colonne « Employé » SUPPRIMÉE du tableau desktop ET des cartes mobiles ;
    le nom reste dans les DONNÉES (le filtre « par nom ou par CIN » marche
    toujours), il n'est simplement plus affiché ;
  - TOUT le reste conservé : tableau pré-rempli, badge « Accès non créé »,
    compteurs, filtre, alerte « fiches sans CIN », mot de passe initial
    affiché une seule fois, Réinitialiser, expiration 15 jours.

Scénarios testés ici :
  0. Contrôles STATIQUES (composant + route API + bundle servi).
  A. Connexion admin + répertoire des employés (la source du tableau).
  B. CRÉATION DEPUIS LA LIGNE (le seul chemin restant, exactement ce que fait
     le bouton de la ligne) : candidat = 1re ligne « à créer » (même tri que
     le tableau : max fiches puis A→Z), create 200, la ligne passe dans le
     groupe « avec accès », compteur -1, aucun doublon.
  C. Upsert : recréer sur un CIN autorisé = réinitialisation, jamais de
     doublon.
"""
import glob
import json
import http.cookiejar
import os
import re
import sys
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:4214"
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


print("=== 0. Contrôles statiques du code Task 77 ===")
try:
    tab = open(os.path.join(REPO, "src/components/payslip/portal-access-tab.tsx"), encoding="utf-8").read()
    # --- SUPPRESSIONS demandées (les deux cadres rouges) ---
    check("composant : commentaire Task 77 documente la demande",
          "enleve ce qui dans le cadre rouge" in tab)
    check("composant : champ CIN de création SUPPRIMÉ (placeholder + état cin)",
          "Numéro CIN complet de l'employé" not in tab
          and "const [cin, setCin]" not in tab)
    check("composant : datalist d'autocomplétion SUPPRIMÉ",
          'list="auto-rh-cins-employes"' not in tab
          and 'id="auto-rh-cins-employes"' not in tab
          and "<datalist" not in tab)
    check("composant : bouton « Choisir dans la liste » + sélecteur dialogué SUPPRIMÉS",
          "Choisir dans la liste" not in tab and "Choisir un employé" not in tab
          and "pickerOpen" not in tab)
    check("composant : bouton « Rechercher » + popover Task 73 SUPPRIMÉS",
          "rechercheRapide" not in tab and "rechercheOuverte" not in tab
          and "resultatsRapides" not in tab and "filtrerEmployes" not in tab
          and 'from "@/components/ui/popover"' not in tab
          and "<Popover" not in tab)
    check("composant : « Créer l'accès » du HAUT supprimé (create() sans argument)",
          "onClick={() => create()}" not in tab
          and re.search(r">\s*Création…\s*:\s*", tab) is None)
    check("composant : bouton ACTUALISER supprimé (MODIFIÉ Task 80 : RefreshCw est l'icône du bouton « Réinitialiser le QR »)",
          "Actualiser la liste" not in tab and "Actualiser" not in tab)
    check("composant : mécanique Task 70 du champ SUPPRIMÉE (auto-remplissage, suspension, indice)",
          "prochainCinAuto" not in tab and "saisieManuelleRef" not in tab
          and "cinAutoRempli" not in tab)
    check("composant : fonction choisirEmploye SUPPRIMÉE (plus de champ à remplir)",
          "choisirEmploye" not in tab and "cinsAvecAcces" not in tab)
    check("composant : paragraphe « Remplissage 100 % automatique » SUPPRIMÉ",
          "s'écrit TOUT SEUL" not in tab
          and "contenu de la fiche ou nom de fichier" not in tab)
    check("composant : COLONNE « Employé » SUPPRIMÉE (desktop)",
          ">Employé</th>" not in tab and ">Statut</th>" in tab
          and "Détecté dans {ligne.fiches}" not in tab)
    check("composant : cartes mobiles SANS nom ni « Détecté dans N fiche(s) »",
          tab.count("colSpan={5}") == 3, tab.count("colSpan={5}"))
    # --- Task 71 conservée : le tableau pré-rempli devient la SEULE surface de création ---
    check("composant : Task 71 conservée — fusion LigneTableau sans doublon",
          "interface LigneTableau" in tab and "cle: `detecte:${e.cin}`" in tab
          and "cle: `acces:${row.id}`" in tab and "const accesParCin" in tab)
    check("composant : Task 71 conservée — badge « Accès non créé » + bouton dans la ligne",
          tab.count("Accès non créé") >= 2 and "creerDepuisLigne(ligne)" in tab
          and "await create(ligne.cin)" in tab
          and "busyId === ligne.cle || generating" in tab)
    check("composant : Task 71 conservée — tri « à créer d'abord » + compteurs + filtre",
          "b.fiches - a.fiches || a.cin.localeCompare(b.cin)" in tab
          and "nbRestants" in tab and "Filtrer le tableau par nom ou par CIN" in tab
          and "sticky top-0" in tab and "max-h-[480px]" in tab)
    check("composant : create() exige désormais un CIN passé en argument (venu de la ligne)",
          "async function create(valeur: string)" in tab
          and "const v = valeur.trim()" in tab)
    check("composant : le nom reste en DONNÉES (filtre par nom opérationnel) mais plus affiché",
          "nom: string | null;" in tab
          and '(l.nom ?? "").toLowerCase().includes(qNom)' in tab
          and "Accès existant" not in tab)
    check("composant : états vides honnêtes conservés (MODIFIÉ Task 80 : la mention « Aucun accès portail créé » ne vit que dans la section QR)",
          "Aucun employé détecté pour le moment" in tab
          and "Aucune ligne ne correspond à ce filtre" in tab
          and "Aucun accès portail créé" in tab
          and tab.index("Aucun accès portail créé") > tab.index("Gestion des QR codes"))
    # --- Conservations obligatoires (régression si absent) ---
    check("composant : Task 70 conservée — alerte fiches sans CIN identifiable",
          "fichesSansCin" in tab and "fichesTotal" in tab
          and "aucun CIN identifiable" in tab)
    check("composant : Task 64 conservée — libellés mot de passe (boutons des lignes)",
          "Créer l'accès" in tab and "Réinitialiser" in tab
          and "expire tous les 15 jours" in tab
          and "Changement requis" in tab and "À réinitialiser" in tab
          and "Verrouillé" in tab)
    check("composant : Task 66 conservée — consigne tirets/espaces",
          "tirets et espaces sont ignorés" in tab)
    # (RÉALIGNÉ Task 80 : la SECTION « Gestion des QR codes » dédiée existe
    # désormais dans le composant.)
    check("composant : section « Gestion des QR codes » dédiée (Task 80)",
          "Gestion des QR codes" in tab and "Afficher le QR" in tab)
except Exception as e:  # noqa
    check("lecture du composant", False, e)

try:
    api = open(os.path.join(REPO, "src/app/api/payslips/employes/route.ts"), encoding="utf-8").read()
    check("API employes : sources + compteurs inchangés (Task 67/70) — le tableau continue de s'alimenter",
          all(s in api for s in ["detectCin(", "detectCinFromTableContext(", "scanLibellesCin(",
                                 "jetonsCinNomFichier(", "valeursCinLigneSuivante("])
          and "fichesTotal" in api and "fichesSansCin" in api)
    check("API employes : gardes session + expiration intactes",
          "getSessionUser" in api and "motDePasseExpire()" in api)
except Exception as e:  # noqa
    check("lecture de l'API employes", False, e)

# --- Bundle servi (preuve que le build embarque Task 77 sans la barre) ---
try:
    chunks = (glob.glob(os.path.join(REPO, ".next/standalone/.next/static/chunks/*.js"))
              + glob.glob(os.path.join(REPO, ".next/static/chunks/*.js")))
    if not chunks:
        check("bundle : aucun build trouvé — vérification ignorée (lancez npm run build)", True)
    else:
        def embarque(s):
            return any(s in open(c, encoding="utf-8", errors="replace").read() for c in chunks)
        check(f"bundle : Task 71 embarquée (« Accès non créé » + filtre) dans {len(chunks)} chunks",
              embarque("Accès non créé") and embarque("Filtrer le tableau par nom ou par CIN"))
        check("bundle : BARRE DE CRÉATION bien ABSENTE du build",
              not embarque("Choisir dans la liste")
              and not embarque("Rechercher un employé par nom ou par CIN")
              and not embarque("Numéro CIN complet de l'employé"))
        check("bundle : COLONNE « Employé » bien ABSENTE du build",
              not embarque("Détecté dans") and not embarque("Accès existant"))
        check("bundle : compteurs guidant vers les lignes toujours embarqués",
              embarque("pré-rempli tout seul")
              and embarque("Créer l'accès"))
except Exception as e:  # noqa
    check("lecture du bundle", False, e)

print("=== A. Connexion + répertoire des employés (COPIE, port 4214) ===")
op = client_nouveau()
st, rep = req(op, "/api/auth/login", {"email": EMAIL, "password": ANCIEN})
d = json.loads(rep) if rep else {}
check("login 200 + changement forcé", st == 200 and d.get("mustChangePassword") is True, (st, rep[:150]))
st, rep = req(op, "/api/auth/change-password", {"currentPassword": ANCIEN, "newPassword": NOUVEAU})
check("changement obligatoire accepté (200)", st == 200, (st, rep[:150]))

st, rep = req(op, "/api/payslips/employes")
check("employes 200 (la source du tableau pré-rempli)", st == 200, (st, rep[:200]))
d = json.loads(rep) if rep else {}
employes = d.get("items", [])
check("compteurs fichesTotal / fichesSansCin toujours renvoyés",
      isinstance(d.get("fichesTotal"), int) and isinstance(d.get("fichesSansCin"), int),
      (d.get("fichesTotal"), d.get("fichesSansCin")))
check("TEST65CIN1 détecté (3 fiches fusionnées)",
      next((e for e in employes if e["cin"] == "TEST65CIN1"), {}).get("fiches") == 3,
      next((e for e in employes if e["cin"] == "TEST65CIN1"), None))
check("répertoire non vide (le tableau doit proposer des lignes à créer)", len(employes) > 0, len(employes))

print("=== B. Création DEPUIS LA LIGNE (seul chemin restant, Task 77) ===")
st, rep = req(op, "/api/portal-access")
d = json.loads(rep) if rep else {}
acces_avant = d.get("items", [])
check("portal-access 200", st == 200, (st, rep[:150]))
cins_acces = {a["cin"] for a in acces_avant}
# MÊME TRI que le tableau (Task 71) : les « à créer » d'abord, max fiches puis A→Z.
candidats = [e for e in employes if e["cin"] not in cins_acces]
candidats.sort(key=lambda e: (-e["fiches"], e["cin"]))
cible = candidats[0] if candidats else None
check("une ligne « à créer » existe (tableau pré-rempli)", cible is not None, len(candidats))
st, rep = req(op, "/api/portal-access", {"action": "create", "cin": cible["cin"]})
d = json.loads(rep) if rep else {}
check("create 200 avec le CIN de la ligne (bouton « Créer l'accès »)", st == 200, (st, rep[:200]))
check("mot de passe initial affiché une seule fois", bool(d.get("initialPassword")))
check("l'accès créé porte le CIN normalisé de la ligne", d.get("access", {}).get("cin") == cible["cin"], d.get("access"))

st, rep = req(op, "/api/portal-access")
d = json.loads(rep) if rep else {}
acces_apres = d.get("items", [])
check("la ligne cliquée est passée dans le groupe « avec accès »",
      any(a["cin"] == cible["cin"] for a in acces_apres), cible["cin"])
check("AUCUN doublon après création (fusion Task 71 sans ligne fantôme)",
      len([a["cin"] for a in acces_apres]) == len({a["cin"] for a in acces_apres}))
st, rep = req(op, "/api/payslips/employes")
d = json.loads(rep) if rep else {}
employes2 = d.get("items", [])
restants = [e for e in employes2 if e["cin"] not in {a["cin"] for a in acces_apres}]
check("le compteur « accès à créer » baisse d'exactement 1 après la création",
      len(restants) == len(candidats) - 1, (len(restants), len(candidats)))

print("=== C. Upsert : recréer sur un CIN autorisé = réinitialisation, jamais de doublon ===")
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
print(f"\nRÉSULTAT TASK 77 : {ok}/{len(resultats)} vérifications réussies")
sys.exit(0 if ko == 0 else 1)
