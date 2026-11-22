#!/usr/bin/env python3
"""Task 84 (19/09/2026) : cercles du portail employés passés du BLEU au VERT.

DEMANDE UTILISATEUR : « change le de ces cercle vers vert » (+ capture du
cercle bleu « 2 » de la page /otp — badge d'étape .etq-etape).

CE PATCH :
  - ATTENDU 282 → 284 : Task 84 AJOUTE 2 fichiers (test84_cercles_verts.py
    + test84_harnais.sh) — l'ATTENDU des 18 maillons qui portent un contrôle
    de comptage (38, 64-67, 69-71, 73-81, 83) + des 2 suites task40/42 est
    porté à 284 (l'état final est injecté au préalable par
    bootstrap_zip_task84.py, chaque maillon voit donc 284 fichiers) ;
  - RÉALIGNEMENT DES CONTRÔLES DE VERSION (convention établie : on réaligne
    les CONTRÔLES, jamais les fichiers pour « faire passer ») :
      * suites test74/75/76/78/80/81/82/83 : « version du produit =
        0.2.13 (MODIFIÉ Task 83) » → « 0.2.14 (MODIFIÉ Task 84) » ;
      * maillons update_zip_task74..81 + update_zip_task83 : chaînes de
        contrôle « 0.2.13 » → « 0.2.14 » (package.json + tests embarqués).
  - IDEMPOTENT : relancer ne change rien.

Historique : patch_attendu_task83.py (ATTENDU 278 → 282 + versions
0.2.11 → 0.2.13) reste en place comme trace historique.
"""
import os, sys

BASE = "/home/z/my-project"

# (fichier, remplacements) — chaque remplacement : (avant, après)
TESTS = [
    "scripts/test74_otp_qr.py",
    "scripts/test75_otp_premiere_connexion.py",
    "scripts/test76_otp_qr_chaque_connexion.py",
    "scripts/test78_totp_authenticator.py",
    "scripts/test80_qr_seul.py",
    "scripts/test81_reconnexion_apres_scan.py",
    "scripts/test82_champ_otp_connexion.py",
    "scripts/test83_premiere_connexion_moderne.py",
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
]

REMPLACEMENTS_TESTS = [
    ('check("version du produit = 0.2.13 (MODIFIÉ Task 83)"',
     'check("version du produit = 0.2.14 (MODIFIÉ Task 84)"'),
    ('check("version du produit = 0.2.13 (MODIFIÉ Task 83",',
     'check("version du produit = 0.2.14 (MODIFIÉ Task 84",'),
    ('pkg.get("version") == "0.2.13"', 'pkg.get("version") == "0.2.14"'),
]
REMPLACEMENTS_MAILLONS = [
    ("0.2.13", "0.2.14"),  # toutes les occurrences = chaînes de contrôle de version
]

# --- ATTENDU 282 → 284 (18 maillons + 2 suites task40/42) ---
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
    "scripts/test_task40_securisation_auto.py",
    "scripts/test_task42_demarrage_unique.py",
]
REMPLACEMENTS_ATTENDU = [
    # nombre + commentaire standard
    ("ATTENDU = 282  # (MODIFIÉ Task 83) 278 (état Task 81) + 2 fichiers Task 82 + 2 fichiers Task 83",
     "ATTENDU = 284  # (MODIFIÉ Task 84) 282 (état Task 83) + 2 fichiers Task 84 (test84 cercles verts ×2)"),
    # commentaire spécial du maillon 38
    ("ATTENDU = 282  # (MODIFIÉ Task 83) chaîne idempotente : l'archive courante porte l'état FINAL Task 83 (282 fichiers)",
     "ATTENDU = 284  # (MODIFIÉ Task 84) chaîne idempotente : l'archive courante porte l'état FINAL Task 84 (284 fichiers)"),
    # secours : tout ATTENDU = 282 restant (commentaire non standard)
    ("ATTENDU = 282", "ATTENDU = 284"),
]

ok = True
for chemin in TESTS:
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    avant = src
    for a, b in REMPLACEMENTS_TESTS:
        src = src.replace(a, b)
    deja = "0.2.14 (MODIFIÉ Task 84)" in avant and "0.2.13" not in avant.replace("v0.2.13", "")
    if src == avant and not deja:
        print(f"ATTENTION {chemin} : aucun remplacement effectué")
        ok = False
    open(p, "w", encoding="utf-8").write(src)
    reste = src.count("0.2.13")
    print(f"OK {chemin} : version réalignée 0.2.14 (mentions 0.2.13 restantes : {reste}, historiques acceptées)")

for chemin in MAILONS:
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    n = src.count("0.2.13")
    if n:
        src = src.replace("0.2.13", "0.2.14")
        open(p, "w", encoding="utf-8").write(src)
    elif "0.2.14" not in src:
        print(f"ATTENTION {chemin} : ni 0.2.13 ni 0.2.14 — à vérifier")
        ok = False
    print(f"OK {chemin} : {n} chaîne(s) de version réalignée(s) 0.2.13 → 0.2.14")

# Contrôle final : aucun maillon actif ne doit plus exiger 0.2.13
for chemin in MAILONS:
    src = open(os.path.join(BASE, chemin), encoding="utf-8").read()
    if "0.2.13" in src:
        print(f"ECHEC {chemin} : 0.2.13 encore présent")
        ok = False

# --- ATTENDU 282 → 284 ---
for chemin in FICHIERS_ATTENDU:
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    avant = src
    for a, b in REMPLACEMENTS_ATTENDU:
        src = src.replace(a, b)
    if src != avant:
        open(p, "w", encoding="utf-8").write(src)
        print(f"OK {chemin} : ATTENDU porté à 284")
    elif "ATTENDU = 284" in src:
        print(f"OK {chemin} : ATTENDU déjà à 284 (idempotent)")
    else:
        print(f"ATTENTION {chemin} : ATTENDU ni 282 ni 284 — à vérifier")
        ok = False

# Contrôle final : plus aucun ATTENDU = 282 actif
import glob
for p in sorted(glob.glob(os.path.join(BASE, "scripts/update_zip_task*.py"))) + [
    os.path.join(BASE, "scripts/test_task40_securisation_auto.py"),
    os.path.join(BASE, "scripts/test_task42_demarrage_unique.py"),
]:
    src = open(p, encoding="utf-8").read()
    if "ATTENDU = 282" in src:
        print(f"ECHEC {os.path.basename(p)} : ATTENDU = 282 encore présent")
        ok = False

print("PATCH_VERSION_TASK84:", "TOUT OK" if ok else "ECHEC")
sys.exit(0 if ok else 1)
