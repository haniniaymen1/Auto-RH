#!/usr/bin/env python3
"""Task 90 (19/09/2026) : après le scan du QR code, retour à la fenêtre
initiale de connexion (CIN + mot de passe + OTP) — même quand la
confirmation termine l'inscription sur un défi NON « premiere » (QR expiré
puis re-scanné à la reconnexion) ; l'employé ne aboutit plus directement
sur « Vos fiches de paie ».

CE PATCH :
  - ATTENDU 294 → 296 : Task 90 AJOUTE 2 fichiers
    (test90_redirection_apres_scan.py + test90_harnais.sh) — l'ATTENDU des
    maillons/suites qui portent un contrôle de comptage (38, 64-67, 69-71,
    73-89 + task40/42) est porté à 296 (l'état final est injecté au
    préalable par bootstrap_zip_task90.py) ;
  - RÉALIGNEMENT DES CONTRÔLES DE VERSION (convention établie : on
    réaligne les CONTRÔLES, jamais les fichiers pour « faire passer ») :
      * suites test74/75/76/78/80/81/82/83/84/85/86/87/88 : « version du
        produit = 0.2.19 (NOUVEAU Task 89) » → « 0.2.20 (NOUVEAU Task 90) » ;
      * suite test89 : contrôle « [VERSION] package.json en 0.2.19 » →
        « 0.2.20 » ;
      * maillons update_zip_task74..89 : chaînes de contrôle « 0.2.19 » →
        « 0.2.20 ».
  - IDEMPOTENT : relancer ne change rien.

Historique : patch_attendu_task89.py (ATTENDU 294 + versions 0.2.18 →
0.2.19) reste en place comme trace historique.
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
TEST89 = "scripts/test89_demarrage_sans_npx.py"
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
    "scripts/update_zip_task89.py",
]

REMPLACEMENTS_TESTS = [
    ('check("version du produit = 0.2.19 (NOUVEAU Task 89)"',
     'check("version du produit = 0.2.20 (NOUVEAU Task 90)"'),
    ('check("S19 version du produit = 0.2.19 (NOUVEAU Task 89)"',
     'check("S19 version du produit = 0.2.20 (NOUVEAU Task 90)"'),
    ('check("S01 version du produit = 0.2.19 (NOUVEAU Task 89)"',
     'check("S01 version du produit = 0.2.20 (NOUVEAU Task 90)"'),
    ('pkg.get("version") == "0.2.19"', 'pkg.get("version") == "0.2.20"'),
]
REMPLACEMENT_TEST89 = [
    ('check("[VERSION] package.json en 0.2.19", \'"version": "0.2.19"\' in pkg)',
     'check("[VERSION] package.json en 0.2.20", \'"version": "0.2.20"\' in pkg)'),
]

# --- ATTENDU 294 → 296 (maillons + suites task40/42) ---
# Task 90 AJOUTE 2 fichiers (test90 ×2) : 294 (état Task 89) + 2 = 296.
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
    "scripts/update_zip_task89.py",
    "scripts/test_task40_securisation_auto.py",
    "scripts/test_task42_demarrage_unique.py",
]

import re as _re

_RX_ATTENDU = _re.compile(r"ATTENDU = 29[46](  #[^\n]*)?")


def _normaliser(m):
    com = m.group(1) or ""
    if "étapes intermédiaires" in com:
        return ("ATTENDU = 296  # (NOUVEAU Task 90) chaîne idempotente : l'archive "
                "courante porte l'état FINAL Task 90 (296 fichiers) — étapes "
                "intermédiaires 38/40/42 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter")
    if "chaîne idempotente" in com:
        return ("ATTENDU = 296  # (NOUVEAU Task 90) chaîne idempotente : l'archive "
                "courante porte l'état FINAL Task 90 (296 fichiers)")
    return ("ATTENDU = 296  # (MODIFIÉ Task 90) 294 (état Task 89) + 2 fichiers "
            "Task 90 (test90 redirection après scan ×2)")


ok = True
for chemin in TESTS:
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    avant = src
    for a, b in REMPLACEMENTS_TESTS:
        src = src.replace(a, b)
    deja = "0.2.20 (NOUVEAU Task 90)" in avant
    if src == avant and not deja:
        print(f"ATTENTION {chemin} : aucun remplacement effectué")
        ok = False
    open(p, "w", encoding="utf-8").write(src)
    reste = src.count("0.2.19")
    print(f"OK {chemin} : version réalignée 0.2.20 (mentions 0.2.19 restantes : {reste}, historiques acceptées)")

p = os.path.join(BASE, TEST89)
src = open(p, encoding="utf-8").read()
avant = src
for a, b in REMPLACEMENT_TEST89:
    src = src.replace(a, b)
deja = '"[VERSION] package.json en 0.2.20"' in avant
if src == avant and not deja:
    print(f"ATTENTION {TEST89} : aucun remplacement effectué")
    ok = False
else:
    open(p, "w", encoding="utf-8").write(src)
    print(f"OK {TEST89} : contrôle [VERSION] réaligné 0.2.20 (docstring v0.2.19 historique conservée)")

for chemin in MAILONS:
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    n = src.count("0.2.19")
    if n:
        src = src.replace("0.2.19", "0.2.20")
        open(p, "w", encoding="utf-8").write(src)
    elif "0.2.20" not in src:
        print(f"ATTENTION {chemin} : ni 0.2.19 ni 0.2.20 — à vérifier")
        ok = False
    print(f"OK {chemin} : {n} chaîne(s) de version réalignée(s) 0.2.19 → 0.2.20")

# Contrôle final : aucun maillon actif ne doit plus exiger 0.2.19
for chemin in MAILONS:
    src = open(os.path.join(BASE, chemin), encoding="utf-8").read()
    if "0.2.19" in src:
        print(f"ECHEC {chemin} : 0.2.19 encore présent")
        ok = False

# --- ATTENDU → 296 (normalisation regex, idempotent) ---
for chemin in FICHIERS_ATTENDU:
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    src2, n = _RX_ATTENDU.subn(_normaliser, src)
    if n == 0:
        print(f"ECHEC {chemin} : ATTENDU non porté à 296")
        ok = False
        continue
    open(p, "w", encoding="utf-8").write(src2)
    print(f"OK {chemin} : ATTENDU → 296 ({n} ligne(s) normalisée(s))")

print("\nPATCH TASK 90 :", "TOUT OK" if ok else "ÉCHECS À CORRIGER")
raise SystemExit(0 if ok else 1)
