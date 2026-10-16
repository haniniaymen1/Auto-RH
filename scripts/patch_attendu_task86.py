#!/usr/bin/env python3
"""Task 86 (19/09/2026) : le QR code d'inscription EXPIRE VRAIMENT après
10 minutes (« Qr code n'expire pas apres 10 minute vérifier »).

CAUSE RÉELLE (v0.2.15) : la fenêtre /otp expirait, mais le secret TOTP encodé
par le QR était PERSISTANT dès la première validation CIN + mot de passe — le
même QR revenait à chaque reconnexion et son code restait accepté à vie.

CE PATCH :
  - ATTENDU 286 → 288 : Task 86 AJOUTE 2 fichiers (test86_expiration_qr.py +
    test86_harnais.sh) — l'ATTENDU des 21 maillons qui portent un contrôle de
    comptage (38, 64-67, 69-71, 73-85) + des 2 suites task40/42 est porté à
    288 (l'état final est injecté au préalable par bootstrap_zip_task86.py) ;
  - RÉALIGNEMENT DES CONTRÔLES DE VERSION (convention établie : on réaligne
    les CONTRÔLES, jamais les fichiers pour « faire passer ») :
      * suites test74/75/76/78/80/81/82/83/84/85 : « version du produit =
        0.2.15 (MODIFIÉ Task 85) » → « 0.2.16 (MODIFIÉ Task 86) » ;
      * maillons update_zip_task74..85 : chaînes de contrôle « 0.2.15 » →
        « 0.2.16 » (package.json + tests embarqués).
  - IDEMPOTENT : relancer ne change rien.

Historique : patch_attendu_task85.py (ATTENDU 284 → 286 + versions
0.2.14 → 0.2.15) reste en place comme trace historique.
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
]

REMPLACEMENTS_TESTS = [
    ('check("version du produit = 0.2.15 (MODIFIÉ Task 85)"',
     'check("version du produit = 0.2.16 (MODIFIÉ Task 86)"'),
    ('check("version du produit = 0.2.15 (MODIFIÉ Task 85",',
     'check("version du produit = 0.2.16 (MODIFIÉ Task 86",'),
    ('check("S19 version du produit = 0.2.15 (MODIFIÉ Task 85)"',
     'check("S19 version du produit = 0.2.16 (MODIFIÉ Task 86)"'),
    ('check("S01 version du produit = 0.2.15 (MODIFIÉ Task 85)"',
     'check("S01 version du produit = 0.2.16 (MODIFIÉ Task 86)"'),
    ('pkg.get("version") == "0.2.15"', 'pkg.get("version") == "0.2.16"'),
]
REMPLACEMENTS_MAILLONS = [
    ("0.2.15", "0.2.16"),  # toutes les occurrences = chaînes de contrôle de version
]

# --- ATTENDU 286 → 288 (21 maillons + 2 suites task40/42) ---
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
    "scripts/test_task40_securisation_auto.py",
    "scripts/test_task42_demarrage_unique.py",
]
REMPLACEMENTS_ATTENDU = [
    # nombre + commentaire standard
    ("ATTENDU = 286  # (MODIFIÉ Task 85) 284 (état Task 84) + 2 fichiers Task 85 (test85 fenêtre QR seul ×2)",
     "ATTENDU = 288  # (MODIFIÉ Task 86) 286 (état Task 85) + 2 fichiers Task 86 (test86 expiration QR ×2)"),
    # commentaire spécial du maillon 38
    ("ATTENDU = 286  # (MODIFIÉ Task 85) chaîne idempotente : l'archive courante porte l'état FINAL Task 85 (286 fichiers)",
     "ATTENDU = 288  # (MODIFIÉ Task 86) chaîne idempotente : l'archive courante porte l'état FINAL Task 86 (288 fichiers)"),
    # secours : tout ATTENDU = 286 restant (commentaire non standard)
    ("ATTENDU = 286", "ATTENDU = 288"),
]

ok = True
for chemin in TESTS:
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    avant = src
    for a, b in REMPLACEMENTS_TESTS:
        src = src.replace(a, b)
    deja = "0.2.16 (MODIFIÉ Task 86)" in avant
    if src == avant and not deja:
        print(f"ATTENTION {chemin} : aucun remplacement effectué")
        ok = False
    open(p, "w", encoding="utf-8").write(src)
    reste = src.count("0.2.15")
    print(f"OK {chemin} : version réalignée 0.2.16 (mentions 0.2.15 restantes : {reste}, historiques acceptées)")

for chemin in MAILONS:
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    n = src.count("0.2.15")
    if n:
        src = src.replace("0.2.15", "0.2.16")
        open(p, "w", encoding="utf-8").write(src)
    elif "0.2.16" not in src:
        print(f"ATTENTION {chemin} : ni 0.2.15 ni 0.2.16 — à vérifier")
        ok = False
    print(f"OK {chemin} : {n} chaîne(s) de version réalignée(s) 0.2.15 → 0.2.16")

# Contrôle final : aucun maillon actif ne doit plus exiger 0.2.15
for chemin in MAILONS:
    src = open(os.path.join(BASE, chemin), encoding="utf-8").read()
    if "0.2.15" in src:
        print(f"ECHEC {chemin} : 0.2.15 encore présent")
        ok = False

# --- ATTENDU 286 → 288 ---
for chemin in FICHIERS_ATTENDU:
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    avant = src
    if "ATTENDU = 288" in avant and "ATTENDU = 286" not in avant:
        print(f"OK {chemin} : ATTENDU déjà à 288 (idempotent)")
        continue
    for a, b in REMPLACEMENTS_ATTENDU:
        src = src.replace(a, b)
    if src == avant:
        print(f"ECHEC {chemin} : ATTENDU 286 non trouvé")
        ok = False
    else:
        open(p, "w", encoding="utf-8").write(src)
        print(f"OK {chemin} : ATTENDU 286 → 288")

print("\n" + ("PATCH ATTENDU TASK86 : TOUT OK" if ok else "PATCH ATTENDU TASK86 : ECHEC"))
raise SystemExit(0 if ok else 1)
