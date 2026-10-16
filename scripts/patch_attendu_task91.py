#!/usr/bin/env python3
"""Task 91 (19/09/2026) : « Je veux que ces deux lignes soient hachées » —
le code d'inscription n'est plus JAMAIS écrit en clair dans .env (conversion
automatique en SIGNUP_CODE_HASH au démarrage, génération hash-only).

CE PATCH :
  - ATTENDU 296 → 297 : Task 91 AJOUTE 1 fichier
    (scripts/test91_code_hache_env.py) — l'ATTENDU des maillons/suites qui
    portent un contrôle de comptage (38, 64-71, 73-89 + task40/42 + task90)
    est porté à 297 (l'état final est injecté au préalable par
    bootstrap_zip_task91.py) ;
  - RÉALIGNEMENT DES CONTRÔLES DE VERSION (convention établie : on
    réaligne les CONTRÔLES, jamais les fichiers pour « faire passer ») :
      * suites test74/75/76/78/80/81/82/83/84/85/86/87/88 : « version du
        produit = 0.2.20 (NOUVEAU Task 90) » → « 0.2.21 (NOUVEAU Task 91) » ;
      * suite test89 : contrôle « [VERSION] package.json en 0.2.20 » →
        « 0.2.21 » ;
      * suite test90 : contrôles de version 0.2.20 → 0.2.21 (docstrings
        historiques conservées) ;
      * maillons update_zip_task74..90 : chaînes de contrôle « 0.2.20 » →
        « 0.2.21 ».
  - IDEMPOTENT : relancer ne change rien.

Historique : patch_attendu_task90.py (ATTENDU 294 → 296 + versions 0.2.19 →
0.2.20) reste en place comme trace historique.
"""
import os
import re as _re

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
TEST90 = "scripts/test90_redirection_apres_scan.py"
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
    "scripts/update_zip_task90.py",
]

REMPLACEMENTS_TESTS = [
    ('check("version du produit = 0.2.20 (NOUVEAU Task 90)"',
     'check("version du produit = 0.2.21 (NOUVEAU Task 91)"'),
    ('check("S19 version du produit = 0.2.20 (NOUVEAU Task 90)"',
     'check("S19 version du produit = 0.2.21 (NOUVEAU Task 91)"'),
    ('check("S01 version du produit = 0.2.20 (NOUVEAU Task 90)"',
     'check("S01 version du produit = 0.2.21 (NOUVEAU Task 91)"'),
    ('pkg.get("version") == "0.2.20"', 'pkg.get("version") == "0.2.21"'),
]
REMPLACEMENT_TEST89 = [
    ('check("[VERSION] package.json en 0.2.20", \'"version": "0.2.20"\' in pkg)',
     'check("[VERSION] package.json en 0.2.21", \'"version": "0.2.21"\' in pkg)'),
]

# --- ATTENDU 296 → 297 (maillons + suites task40/42) ---
# Task 91 AJOUTE 1 fichier (test91 code haché) : 296 (état Task 90) + 1 = 297.
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
    "scripts/update_zip_task90.py",
    "scripts/test_task40_securisation_auto.py",
    "scripts/test_task42_demarrage_unique.py",
]

_RX_ATTENDU = _re.compile(r"ATTENDU = 29[67](  #[^\n]*)?")


def _normaliser(m):
    com = m.group(1) or ""
    if "étapes intermédiaires" in com:
        return ("ATTENDU = 297  # (NOUVEAU Task 91) chaîne idempotente : l'archive "
                "courante porte l'état FINAL Task 91 (297 fichiers) — étapes "
                "intermédiaires ne font que REMPLACER/CONSERVER leurs fichiers, sans en ajouter")
    if "chaîne idempotente" in com:
        return ("ATTENDU = 297  # (NOUVEAU Task 91) chaîne idempotente : l'archive "
                "courante porte l'état FINAL Task 91 (297 fichiers)")
    return ("ATTENDU = 297  # (MODIFIÉ Task 91) 296 (état Task 90) + 1 fichier "
            "Task 91 (test91 code d'inscription haché)")


ok = True
for chemin in TESTS:
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    avant = src
    for a, b in REMPLACEMENTS_TESTS:
        src = src.replace(a, b)
    deja = "0.2.21 (NOUVEAU Task 91)" in avant
    if src == avant and not deja:
        print(f"ATTENTION {chemin} : aucun remplacement effectué")
        ok = False
    open(p, "w", encoding="utf-8").write(src)
    reste = src.count("0.2.20")
    print(f"OK {chemin} : version réalignée 0.2.21 (mentions 0.2.20 restantes : {reste}, historiques acceptées)")

p = os.path.join(BASE, TEST89)
src = open(p, encoding="utf-8").read()
avant = src
for a, b in REMPLACEMENT_TEST89:
    src = src.replace(a, b)
deja = '"[VERSION] package.json en 0.2.21"' in avant
if src == avant and not deja:
    print(f"ATTENTION {TEST89} : aucun remplacement effectué")
    ok = False
else:
    open(p, "w", encoding="utf-8").write(src)
    print(f"OK {TEST89} : contrôle [VERSION] réaligné 0.2.21 (docstring v0.2.20 historique conservée)")

p = os.path.join(BASE, TEST90)
src = open(p, encoding="utf-8").read()
avant = src
for a, b in REMPLACEMENTS_TESTS:
    src = src.replace(a, b)
deja = 'pkg.get("version") == "0.2.21"' in avant
if src == avant and not deja:
    print(f"ATTENTION {TEST90} : aucun remplacement effectué")
    ok = False
else:
    open(p, "w", encoding="utf-8").write(src)
    reste90 = src.count("0.2.20")
    print(f"OK {TEST90} : contrôles de version réalignés 0.2.21 (mentions 0.2.20 restantes : {reste90}, historiques acceptées)")

for chemin in MAILONS:
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    n = src.count("0.2.20")
    if n:
        src = src.replace("0.2.20", "0.2.21")
        open(p, "w", encoding="utf-8").write(src)
    elif "0.2.21" not in src:
        print(f"ATTENTION {chemin} : ni 0.2.20 ni 0.2.21 — à vérifier")
        ok = False
    print(f"OK {chemin} : {n} chaîne(s) de version réalignée(s) 0.2.20 → 0.2.21")

# Contrôle final : aucun maillon actif ne doit plus exiger 0.2.20
for chemin in MAILONS:
    src = open(os.path.join(BASE, chemin), encoding="utf-8").read()
    if "0.2.20" in src:
        print(f"ECHEC {chemin} : 0.2.20 encore présent")
        ok = False

# --- ATTENDU → 297 (normalisation regex, idempotent) ---
for chemin in FICHIERS_ATTENDU:
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    src2, n = _RX_ATTENDU.subn(_normaliser, src)
    if n == 0:
        print(f"ECHEC {chemin} : ATTENDU non porté à 297")
        ok = False
        continue
    open(p, "w", encoding="utf-8").write(src2)
    print(f"OK {chemin} : ATTENDU → 297 ({n} ligne(s) normalisée(s))")

print("\nPATCH TASK 91 :", "TOUT OK" if ok else "ÉCHECS À CORRIGER")
raise SystemExit(0 if ok else 1)
