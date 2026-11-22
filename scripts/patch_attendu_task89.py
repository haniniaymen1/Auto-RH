#!/usr/bin/env python3
"""Task 89 (19/09/2026) : démarrage local SANS npx — plus aucun prompt bloquant.

CE PATCH :
  - ATTENDU 292 → 294 : Task 89 AJOUTE 2 fichiers (test89_demarrage_sans_npx.py
    + test89_harnais.sh) — l'ATTENDU des 24 maillons/suites qui portent un
    contrôle de comptage (38, 64-67, 69-71, 73-88 + task40/42) est porté à 294
    (l'état final est injecté au préalable par bootstrap_zip_task89.py) ;
  - RÉALIGNEMENT DES CONTRÔLES DE VERSION (convention établie : on réaligne
    les CONTRÔLES, jamais les fichiers pour « faire passer ») :
      * suites test74/75/76/78/80/81/82/83/84/85/86/87/88 : « version du
        produit = 0.2.18 (NOUVEAU Task 88) » → « 0.2.19 (NOUVEAU Task 89) » ;
      * maillons update_zip_task74..88 : chaînes de contrôle « 0.2.18 » →
        « 0.2.19 ».
  - IDEMPOTENT : relancer ne change rien.

Historique : patch_attendu_task88.py (ATTENDU 292 + versions 0.2.17 → 0.2.18)
reste en place comme trace historique.
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
    "scripts/test88_nom_compte_authenticator.py",
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
    "scripts/update_zip_task88.py",
]

REMPLACEMENTS_TESTS = [
    ('check("version du produit = 0.2.18 (NOUVEAU Task 88)"',
     'check("version du produit = 0.2.19 (NOUVEAU Task 89)"'),
    ('check("S19 version du produit = 0.2.18 (NOUVEAU Task 88)"',
     'check("S19 version du produit = 0.2.19 (NOUVEAU Task 89)"'),
    ('check("S01 version du produit = 0.2.18 (NOUVEAU Task 88)"',
     'check("S01 version du produit = 0.2.19 (NOUVEAU Task 89)"'),
    ('pkg.get("version") == "0.2.18"', 'pkg.get("version") == "0.2.19"'),
]

# --- ATTENDU 292 → 294 (24 maillons + suites task40/42) ---
# Task 89 AJOUTE 2 fichiers (test89 ×2) : 292 (état Task 88) + 2 = 294.
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
    "scripts/update_zip_task88.py",
    "scripts/test_task40_securisation_auto.py",
    "scripts/test_task42_demarrage_unique.py",
]

import re as _re

_RX_ATTENDU = _re.compile(r"ATTENDU = 29[234](  #[^\n]*)?")


def _normaliser(m):
    com = m.group(1) or ""
    if "étapes intermédiaires" in com:
        return ("ATTENDU = 294  # (NOUVEAU Task 89) chaîne idempotente : l'archive "
                "courante porte l'état FINAL Task 89 (294 fichiers) — étapes "
                "intermédiaires 38/40/42 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter")
    if "chaîne idempotente" in com:
        return ("ATTENDU = 294  # (NOUVEAU Task 89) chaîne idempotente : l'archive "
                "courante porte l'état FINAL Task 89 (294 fichiers)")
    return ("ATTENDU = 294  # (MODIFIÉ Task 89) 292 (état Task 88) + 2 fichiers "
            "Task 89 (test89 démarrage sans npx ×2)")


ok = True
for chemin in TESTS:
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    avant = src
    for a, b in REMPLACEMENTS_TESTS:
        src = src.replace(a, b)
    deja = "0.2.19 (NOUVEAU Task 89)" in avant
    if src == avant and not deja:
        print(f"ATTENTION {chemin} : aucun remplacement effectué")
        ok = False
    open(p, "w", encoding="utf-8").write(src)
    reste = src.count("0.2.18")
    print(f"OK {chemin} : version réalignée 0.2.19 (mentions 0.2.18 restantes : {reste}, historiques acceptées)")

for chemin in MAILONS:
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    n = src.count("0.2.18")
    if n:
        src = src.replace("0.2.18", "0.2.19")
        open(p, "w", encoding="utf-8").write(src)
    elif "0.2.19" not in src:
        print(f"ATTENTION {chemin} : ni 0.2.18 ni 0.2.19 — à vérifier")
        ok = False
    print(f"OK {chemin} : {n} chaîne(s) de version réalignée(s) 0.2.18 → 0.2.19")

# Contrôle final : aucun maillon actif ne doit plus exiger 0.2.18
for chemin in MAILONS:
    src = open(os.path.join(BASE, chemin), encoding="utf-8").read()
    if "0.2.18" in src:
        print(f"ECHEC {chemin} : 0.2.18 encore présent")
        ok = False

# --- ATTENDU → 294 (normalisation regex, idempotent) ---
for chemin in FICHIERS_ATTENDU:
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    src2, n = _RX_ATTENDU.subn(_normaliser, src)
    if n == 0:
        print(f"ECHEC {chemin} : ATTENDU non porté à 294")
        ok = False
        continue
    open(p, "w", encoding="utf-8").write(src2)
    print(f"OK {chemin} : ATTENDU → 294 ({n} ligne(s) normalisée(s))")

print("\nPATCH TASK 89 :", "TOUT OK" if ok else "ÉCHECS À CORRIGER")
raise SystemExit(0 if ok else 1)
