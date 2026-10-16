#!/usr/bin/env python3
"""Task 85 (19/09/2026) : la fenêtre de confirmation OTP n'affiche JAMAIS le
code — uniquement le QR code (expirant après 10 minutes).

DEMANDE UTILISATEUR : « jamais affiche le code otp comme ca / dans cette
fenetre n affiche que qr code qui expire apres 10 minute » (capture du code
« 963 903 » affiché en clair).

CE PATCH :
  - ATTENDU 284 → 286 : Task 85 AJOUTE 2 fichiers (test85_fenetre_qr_seul.py
    + test85_harnais.sh) — l'ATTENDU des 19 maillons qui portent un contrôle
    de comptage (38, 64-67, 69-71, 73-81, 83, 84) + des 2 suites task40/42
    est porté à 286 (l'état final est injecté au préalable par
    bootstrap_zip_task85.py, chaque maillon voit donc 286 fichiers) ;
  - RÉALIGNEMENT DES CONTRÔLES DE VERSION (convention établie : on réaligne
    les CONTRÔLES, jamais les fichiers pour « faire passer ») :
      * suites test74/75/76/78/80/81/82/83/84 : « version du produit =
        0.2.14 (MODIFIÉ Task 84) » → « 0.2.15 (MODIFIÉ Task 85) » ;
      * maillons update_zip_task74..84 : chaînes de contrôle « 0.2.14 » →
        « 0.2.15 » (package.json + tests embarqués).
  - IDEMPOTENT : relancer ne change rien.

Historique : patch_attendu_task84.py (ATTENDU 282 → 284 + versions
0.2.13 → 0.2.14) reste en place comme trace historique.
"""
import os

BASE = "/home/z/my-project"

# Suites dont le contrôle de version doit passer à 0.2.15
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
]

REMPLACEMENTS_TESTS = [
    ('check("version du produit = 0.2.14 (MODIFIÉ Task 84)"',
     'check("version du produit = 0.2.15 (MODIFIÉ Task 85)"'),
    ('check("version du produit = 0.2.14 (MODIFIÉ Task 84",',
     'check("version du produit = 0.2.15 (MODIFIÉ Task 85",'),
    ('check("S19 version du produit = 0.2.14 (MODIFIÉ Task 84)"',
     'check("S19 version du produit = 0.2.15 (MODIFIÉ Task 85)"'),
    ('pkg.get("version") == "0.2.14"', 'pkg.get("version") == "0.2.15"'),
]
REMPLACEMENTS_MAILLONS = [
    ("0.2.14", "0.2.15"),  # toutes les occurrences = chaînes de contrôle de version
]

# --- ATTENDU 284 → 286 (19 maillons + 2 suites task40/42) ---
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
    "scripts/test_task40_securisation_auto.py",
    "scripts/test_task42_demarrage_unique.py",
]
REMPLACEMENTS_ATTENDU = [
    # nombre + commentaire standard
    ("ATTENDU = 284  # (MODIFIÉ Task 84) 282 (état Task 83) + 2 fichiers Task 84 (test84 cercles verts ×2)",
     "ATTENDU = 286  # (MODIFIÉ Task 85) 284 (état Task 84) + 2 fichiers Task 85 (test85 fenêtre QR seul ×2)"),
    # commentaire spécial du maillon 38
    ("ATTENDU = 284  # (MODIFIÉ Task 84) chaîne idempotente : l'archive courante porte l'état FINAL Task 84 (284 fichiers)",
     "ATTENDU = 286  # (MODIFIÉ Task 85) chaîne idempotente : l'archive courante porte l'état FINAL Task 85 (286 fichiers)"),
    # secours : tout ATTENDU = 284 restant (commentaire non standard)
    ("ATTENDU = 284", "ATTENDU = 286"),
]

ok = True
for chemin in TESTS:
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    avant = src
    for a, b in REMPLACEMENTS_TESTS:
        src = src.replace(a, b)
    deja = "0.2.15 (MODIFIÉ Task 85)" in avant
    if src == avant and not deja:
        print(f"ATTENTION {chemin} : aucun remplacement effectué")
        ok = False
    open(p, "w", encoding="utf-8").write(src)
    reste = src.count("0.2.14")
    print(f"OK {chemin} : version réalignée 0.2.15 (mentions 0.2.14 restantes : {reste}, historiques acceptées)")

for chemin in MAILONS:
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    n = src.count("0.2.14")
    if n:
        src = src.replace("0.2.14", "0.2.15")
        open(p, "w", encoding="utf-8").write(src)
    elif "0.2.15" not in src:
        print(f"ATTENTION {chemin} : ni 0.2.14 ni 0.2.15 — à vérifier")
        ok = False
    print(f"OK {chemin} : {n} chaîne(s) de version réalignée(s) 0.2.14 → 0.2.15")

# Contrôle final : aucun maillon actif ne doit plus exiger 0.2.14
for chemin in MAILONS:
    src = open(os.path.join(BASE, chemin), encoding="utf-8").read()
    if "0.2.14" in src:
        print(f"ECHEC {chemin} : 0.2.14 encore présent")
        ok = False

# --- ATTENDU 284 → 286 ---
for chemin in FICHIERS_ATTENDU:
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    avant = src
    if "ATTENDU = 286" in avant and "ATTENDU = 284" not in avant:
        print(f"OK {chemin} : ATTENDU déjà à 286 (idempotent)")
        continue
    for a, b in REMPLACEMENTS_ATTENDU:
        src = src.replace(a, b)
    if src == avant:
        print(f"ECHEC {chemin} : ATTENDU 284 non trouvé")
        ok = False
    else:
        open(p, "w", encoding="utf-8").write(src)
        print(f"OK {chemin} : ATTENDU 284 → 286")

print("\n" + ("PATCH ATTENDU TASK85 : TOUT OK" if ok else "PATCH ATTENDU TASK85 : ECHEC"))
sys_exit = 0 if ok else 1
raise SystemExit(sys_exit)
