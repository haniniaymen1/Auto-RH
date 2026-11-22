#!/usr/bin/env python3
"""Task 88 (19/09/2026) : Authenticator — l'« Account Name » affiche
« Fiche de paie » au lieu du CIN.

CE PATCH :
  - ATTENDU 290 → 292 : Task 88 AJOUTE 2 fichiers (test88_nom_compte_
    authenticator.py + test88_harnais.sh) — l'ATTENDU des 23 maillons qui
    portent un contrôle de comptage (38, 64-67, 69-71, 73-87) + des 2
    suites task40/42 est porté à 292 (l'état final est injecté au préalable
    par bootstrap_zip_task88.py) ;
  - RÉALIGNEMENT DES CONTRÔLES DE VERSION (convention établie : on réaligne
    les CONTRÔLES, jamais les fichiers pour « faire passer ») :
      * suites test74/75/76/78/80/81/82/83/84/85/86/87 : « version du
        produit = 0.2.17 (MODIFIÉ Task 87) » → « 0.2.18 (NOUVEAU Task 88) » ;
      * maillons update_zip_task74..87 : chaînes de contrôle « 0.2.17 » →
        « 0.2.18 » (package.json + tests embarqués).
  - IDEMPOTENT : relancer ne change rien.

Historique : patch_attendu_task87.py (ATTENDU 290 + versions 0.2.16 →
0.2.17) reste en place comme trace historique.
"""
import os

BASE = "/home/z/my-project"

TESTS = [
    "scripts/test74_otp_qr.py",
    "scripts/test75_otp_premiere_connexion.py",
    "scripts/test76_otp_qr_chaque_connexion.py",
    "scripts/test78_totp_authenticator.py",
    "scripts/test80_qr_seul.py",
    "scripts/test81_reconnexion_apres_scan.py",
    "scripts/test82_champ_otp_connexion.py",
    "scripts/test83_premiere_connexion_moderne.py",
    "scripts/test84_cercles_verts.py",
    "scripts/test85_fenetre_qr_seul.py",
    "scripts/test86_expiration_qr.py",
    "scripts/test87_redirection_connexion_initiale.py",
]
MAILONS = [
    "scripts/update_zip_task74.py",
    "scripts/update_zip_task75.py",
    "scripts/update_zip_task76.py",
    "scripts/update_zip_task77.py",
    "scripts/update_zip_task78.py",
    "scripts/update_zip_task79.py",
    "scripts/update_zip_task80.py",
    "scripts/update_zip_task81.py",
    "scripts/update_zip_task83.py",
    "scripts/update_zip_task84.py",
    "scripts/update_zip_task85.py",
    "scripts/update_zip_task86.py",
    "scripts/update_zip_task87.py",
]

REMPLACEMENTS_TESTS = [
    ('check("version du produit = 0.2.17 (MODIFIÉ Task 87)"',
     'check("version du produit = 0.2.18 (NOUVEAU Task 88)"'),
    ('check("S19 version du produit = 0.2.17 (MODIFIÉ Task 87)"',
     'check("S19 version du produit = 0.2.18 (NOUVEAU Task 88)"'),
    ('check("S01 version du produit = 0.2.17 (MODIFIÉ Task 87)"',
     'check("S01 version du produit = 0.2.18 (NOUVEAU Task 88)"'),
    ('pkg.get("version") == "0.2.17"', 'pkg.get("version") == "0.2.18"'),
]
REMPLACEMENTS_MAILLONS = [
    ("0.2.17", "0.2.18"),  # toutes les occurrences = chaînes de contrôle de version
]

# --- ATTENDU 290 → 292 (23 maillons + 2 suites task40/42) ---
# Task 88 AJOUTE 2 fichiers (test88 ×2) : 290 (état Task 87) + 2 = 292.
# Normalisation par regex des commentaires (standard, maillon 38, variantes
# avec suffixe « étapes intermédiaires ») — tolère aussi un ATTENDU = 291
# résiduel (valeur intermédiaire erronée d'une première passe).
FICHIERS_ATTENDU = [
    "scripts/update_zip_task38.py",
    "scripts/update_zip_task64.py",
    "scripts/update_zip_task65.py",
    "scripts/update_zip_task66.py",
    "scripts/update_zip_task67.py",
    "scripts/update_zip_task69.py",
    "scripts/update_zip_task70.py",
    "scripts/update_zip_task71.py",
    "scripts/update_zip_task73.py",
    "scripts/update_zip_task74.py",
    "scripts/update_zip_task75.py",
    "scripts/update_zip_task76.py",
    "scripts/update_zip_task77.py",
    "scripts/update_zip_task78.py",
    "scripts/update_zip_task79.py",
    "scripts/update_zip_task80.py",
    "scripts/update_zip_task81.py",
    "scripts/update_zip_task83.py",
    "scripts/update_zip_task84.py",
    "scripts/update_zip_task85.py",
    "scripts/update_zip_task86.py",
    "scripts/update_zip_task87.py",
    "scripts/test_task40_securisation_auto.py",
    "scripts/test_task42_demarrage_unique.py",
]

import re as _re

_RX_ATTENDU = _re.compile(r"ATTENDU = 29[012](  #[^\n]*)?")


def _normaliser(m):
    com = m.group(1) or ""
    if "étapes intermédiaires" in com:
        return ("ATTENDU = 292  # (NOUVEAU Task 88) chaîne idempotente : l'archive "
                "courante porte l'état FINAL Task 88 (292 fichiers) — étapes "
                "intermédiaires 38/40/42 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter")
    if "chaîne idempotente" in com:
        return ("ATTENDU = 292  # (NOUVEAU Task 88) chaîne idempotente : l'archive "
                "courante porte l'état FINAL Task 88 (292 fichiers)")
    return ("ATTENDU = 292  # (MODIFIÉ Task 88) 290 (état Task 87) + 2 fichiers "
            "Task 88 (test88 nom compte authenticator ×2)")


ok = True
for chemin in TESTS:
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    avant = src
    for a, b in REMPLACEMENTS_TESTS:
        src = src.replace(a, b)
    deja = "0.2.18 (NOUVEAU Task 88)" in avant
    if src == avant and not deja:
        print(f"ATTENTION {chemin} : aucun remplacement effectué")
        ok = False
    open(p, "w", encoding="utf-8").write(src)
    reste = src.count("0.2.17")
    print(f"OK {chemin} : version réalignée 0.2.18 (mentions 0.2.17 restantes : {reste}, historiques acceptées)")

for chemin in MAILONS:
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    n = src.count("0.2.17")
    if n:
        src = src.replace("0.2.17", "0.2.18")
        open(p, "w", encoding="utf-8").write(src)
    elif "0.2.18" not in src:
        print(f"ATTENTION {chemin} : ni 0.2.17 ni 0.2.18 — à vérifier")
        ok = False
    print(f"OK {chemin} : {n} chaîne(s) de version réalignée(s) 0.2.17 → 0.2.18")

# Contrôle final : aucun maillon actif ne doit plus exiger 0.2.17
for chemin in MAILONS:
    src = open(os.path.join(BASE, chemin), encoding="utf-8").read()
    if "0.2.17" in src:
        print(f"ECHEC {chemin} : 0.2.17 encore présent")
        ok = False

# --- ATTENDU → 292 (normalisation regex, idempotent) ---
for chemin in FICHIERS_ATTENDU:
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    src2, n = _RX_ATTENDU.subn(_normaliser, src)
    if n == 0:
        print(f"ECHEC {chemin} : ATTENDU non porté à 292")
        ok = False
        continue
    open(p, "w", encoding="utf-8").write(src2)
    print(f"OK {chemin} : ATTENDU → 292 ({n} ligne(s) normalisée(s))")

print("\nPATCH TASK 88 :", "TOUT OK" if ok else "ÉCHECS À CORRIGER")
raise SystemExit(0 if ok else 1)
