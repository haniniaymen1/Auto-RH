#!/usr/bin/env python3
"""Task 94 (20/09/2026) : politique de complexité — mots de passe ET code
d'activation à 8 caractères minimum (minuscule, majuscule, chiffre, symbole),
appliquée sur toutes les routes, le portail, les scripts et les interfaces.

CE PATCH (à exécuter AVANT bootstrap_zip_task94.py) :
  - ATTENDU 306 → 307 : Task 94 AJOUTE 1 fichier
    (scripts/test94_politique_complexite.py) — l'ATTENDU des maillons/suites
    qui portent un contrôle de comptage (38, 64-93 + task40/42) est porté à
    307 (l'état final est injecté au préalable par bootstrap_zip_task94.py) ;
  - RÉALIGNEMENT DES CONTRÔLES DE VERSION (convention établie : on réaligne
    les CONTRÔLES, jamais les fichiers pour « faire passer ») :
      * suites test74/75/76/78/80/81/82/83/84/85/86/87/88 : « version du
        produit = 0.2.23 (NOUVEAU Task 93) » → « 0.2.24 (NOUVEAU Task 94) » ;
      * suite test89 : contrôle « [VERSION] package.json en 0.2.23 » → 0.2.24 ;
      * suite test90 : contrôles de version 0.2.23 → 0.2.24 ;
      * suites test91/test92/test93 : contrôles « version 0.2.23 » → 0.2.24 ;
      * maillons update_zip_task74..93 : chaînes de contrôle « 0.2.23 » →
        « 0.2.24 ».
  - IDEMPOTENT : relancer ne change rien.

Historique : patch_attendu_task93.py (ATTENDU 304 → 306 + versions 0.2.22 →
0.2.23) reste en place comme trace historique.
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
TEST91 = "scripts/test91_code_hache_env.py"
TEST92 = "scripts/test92_send_mail.py"
TEST93 = "scripts/test93_code_activation_diag.py"
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
    "scripts/update_zip_task91.py",
    "scripts/update_zip_task92.py",
    "scripts/update_zip_task93.py",
]

REMPLACEMENTS_TESTS = [
    ('check("version du produit = 0.2.23 (NOUVEAU Task 93)"',
     'check("version du produit = 0.2.24 (NOUVEAU Task 94)"'),
    ('check("S19 version du produit = 0.2.23 (NOUVEAU Task 93)"',
     'check("S19 version du produit = 0.2.24 (NOUVEAU Task 94)"'),
    ('check("S01 version du produit = 0.2.23 (NOUVEAU Task 93)"',
     'check("S01 version du produit = 0.2.24 (NOUVEAU Task 94)"'),
    ('pkg.get("version") == "0.2.23"', 'pkg.get("version") == "0.2.24"'),
]
REMPLACEMENT_TEST89 = [
    ('check("[VERSION] package.json en 0.2.23", \'"version": "0.2.23"\' in pkg)',
     'check("[VERSION] package.json en 0.2.24", \'"version": "0.2.24"\' in pkg)'),
]
REMPLACEMENT_TEST91 = [
    ('check("package.json : version 0.2.23", pkg.get("version") == "0.2.23"',
     'check("package.json : version 0.2.24", pkg.get("version") == "0.2.24"'),
]
REMPLACEMENT_TEST92 = [
    ('check("S20 version 0.2.23 (package.json + package-lock.json)"',
     'check("S20 version 0.2.24 (package.json + package-lock.json)"'),
    ('pkg.get("version") == "0.2.23" and lock.get("packages", {}).get("", {}).get("version") == "0.2.23")',
     'pkg.get("version") == "0.2.24" and lock.get("packages", {}).get("", {}).get("version") == "0.2.24")'),
]
REMPLACEMENT_TEST93 = [
    ('check("version : package.json 0.2.23", pkg.get("version") == "0.2.23"',
     'check("version : package.json 0.2.24", pkg.get("version") == "0.2.24"'),
]

# --- ATTENDU 306 → 307 (maillons + suites task40/42) ---
# Task 94 AJOUTE 1 fichier (test94_politique_complexite) : 306 + 1 = 307.
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
    "scripts/update_zip_task91.py",
    "scripts/update_zip_task92.py",
    "scripts/update_zip_task93.py",
    "scripts/test_task40_securisation_auto.py",
    "scripts/test_task42_demarrage_unique.py",
]

_RX_ATTENDU = _re.compile(r"ATTENDU = 30[0-9](  #[^\n]*)?|ATTENDU = 29[78](  #[^\n]*)?")


def _normaliser(m):
    com = m.group(1) or ""
    if "étapes intermédiaires" in com:
        return ("ATTENDU = 307  # (NOUVEAU Task 94) chaîne idempotente : l'archive "
                "courante porte l'état FINAL Task 94 (307 fichiers) — étapes "
                "intermédiaires ne font que REMPLACER/CONSERVER leurs fichiers, sans en ajouter")
    if "chaîne idempotente" in com:
        return ("ATTENDU = 307  # (NOUVEAU Task 94) chaîne idempotente : l'archive "
                "courante porte l'état FINAL Task 94 (307 fichiers)")
    return ("ATTENDU = 307  # (MODIFIÉ Task 94) 306 (état Task 93) + 1 fichier "
            "Task 94 (test94_politique_complexite)")


ok = True
for chemin in TESTS:
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    avant = src
    for a, b in REMPLACEMENTS_TESTS:
        src = src.replace(a, b)
    deja = "0.2.24 (NOUVEAU Task 94)" in avant
    if src == avant and not deja:
        print(f"ATTENTION {chemin} : aucun remplacement effectué")
        ok = False
    open(p, "w", encoding="utf-8").write(src)
    reste = src.count("0.2.23")
    print(f"OK {chemin} : version réalignée 0.2.24 (mentions 0.2.23 restantes : {reste}, historiques acceptées)")

for nom, rempl, chemin in (("test89", REMPLACEMENT_TEST89, TEST89),
                           ("test90", REMPLACEMENTS_TESTS, TEST90),
                           ("test91", REMPLACEMENT_TEST91, TEST91),
                           ("test92", REMPLACEMENT_TEST92, TEST92),
                           ("test93", REMPLACEMENT_TEST93, TEST93)):
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    avant = src
    for a, b in rempl:
        src = src.replace(a, b)
    deja = "0.2.24" in avant
    if src == avant and not deja:
        print(f"ATTENTION {chemin} : aucun remplacement effectué")
        ok = False
    else:
        open(p, "w", encoding="utf-8").write(src)
        reste = src.count("0.2.23")
        print(f"OK {chemin} : contrôles de version réalignés 0.2.24 (mentions 0.2.23 restantes : {reste}, historiques acceptées)")

for chemin in MAILONS:
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    n = src.count("0.2.23")
    if n:
        src = src.replace("0.2.23", "0.2.24")
        open(p, "w", encoding="utf-8").write(src)
    elif "0.2.24" not in src:
        print(f"ATTENTION {chemin} : ni 0.2.23 ni 0.2.24 — à vérifier")
        ok = False
    print(f"OK {chemin} : {n} chaîne(s) de version réalignée(s) 0.2.23 → 0.2.24")

# Contrôle final : aucun maillon actif ne doit plus exiger 0.2.23
for chemin in MAILONS:
    src = open(os.path.join(BASE, chemin), encoding="utf-8").read()
    if "0.2.23" in src:
        print(f"ECHEC {chemin} : 0.2.23 encore présent")
        ok = False

# --- ATTENDU → 307 (normalisation regex, idempotent) ---
for chemin in FICHIERS_ATTENDU:
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    src2, n = _RX_ATTENDU.subn(_normaliser, src)
    if n == 0:
        print(f"ECHEC {chemin} : ATTENDU non porté à 307")
        ok = False
        continue
    open(p, "w", encoding="utf-8").write(src2)
    print(f"OK {chemin} : ATTENDU → 307 ({n} ligne(s) normalisée(s))")

print("\nPATCH TASK 94 :", "TOUT OK" if ok else "ÉCHECS À CORRIGER")
raise SystemExit(0 if ok else 1)
