#!/usr/bin/env python3
"""Task 87 (19/09/2026) : après « Configuration réussie », retour à la
fenêtre initiale de connexion (« apres cette fenetre derige vers fenetre
initial (cin, mot de passe, otp) »).

CE PATCH :
  - ATTENDU 288 → 289 : Task 87 AJOUTE 2 fichiers (test87_redirection_
    connexion_initiale.py + test87_harnais.sh) — l'ATTENDU des 22 maillons
    qui portent un contrôle de comptage (38, 64-67, 69-71, 73-86) + des 2
    suites task40/42 est porté à 289 (l'état final est injecté au préalable
    par bootstrap_zip_task87.py) ;
  - RÉALIGNEMENT DES CONTRÔLES DE VERSION (convention établie : on réaligne
    les CONTRÔLES, jamais les fichiers pour « faire passer ») :
      * suites test74/75/76/78/80/81/82/83/84/85/86 : « version du produit =
        0.2.16 (MODIFIÉ Task 86) » → « 0.2.17 (MODIFIÉ Task 87) » ;
      * maillons update_zip_task74..86 : chaînes de contrôle « 0.2.16 » →
        « 0.2.17 » (package.json + tests embarqués).
  - IDEMPOTENT : relancer ne change rien.

Historique : patch_attendu_task86.py (ATTENDU 288 + versions 0.2.15 →
0.2.16) reste en place comme trace historique.
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
]

REMPLACEMENTS_TESTS = [
    ('check("version du produit = 0.2.16 (MODIFIÉ Task 86)"',
     'check("version du produit = 0.2.17 (MODIFIÉ Task 87)"'),
    ('check("S19 version du produit = 0.2.16 (MODIFIÉ Task 86)"',
     'check("S19 version du produit = 0.2.17 (MODIFIÉ Task 87)"'),
    ('check("S01 version du produit = 0.2.16 (MODIFIÉ Task 86)"',
     'check("S01 version du produit = 0.2.17 (MODIFIÉ Task 87)"'),
    ('pkg.get("version") == "0.2.16"', 'pkg.get("version") == "0.2.17"'),
]
REMPLACEMENTS_MAILLONS = [
    ("0.2.16", "0.2.17"),  # toutes les occurrences = chaînes de contrôle de version
]

# --- ATTENDU 288 → 290 (23 maillons + 2 suites task40/42) ---
# Task 87 AJOUTE 2 fichiers (test87 ×2) : 288 (état Task 86) + 2 = 290.
# Normalisation par regex des commentaires (standard, maillon 38, variantes
# avec suffixe « étapes intermédiaires ») — tolère aussi un ATTENDU = 289
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
    "scripts/test_task40_securisation_auto.py",
    "scripts/test_task42_demarrage_unique.py",
]

import re as _re

_RX_ATTENDU = _re.compile(r"ATTENDU = 28[89](  #[^\n]*)?")


def _normaliser(m):
    com = m.group(1) or ""
    if "étapes intermédiaires" in com:
        return ("ATTENDU = 290  # (MODIFIÉ Task 87) chaîne idempotente : l'archive "
                "courante porte l'état FINAL Task 87 (290 fichiers) — étapes "
                "intermédiaires 38/40/42 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter")
    if "chaîne idempotente" in com:
        return ("ATTENDU = 290  # (MODIFIÉ Task 87) chaîne idempotente : l'archive "
                "courante porte l'état FINAL Task 87 (290 fichiers)")
    return ("ATTENDU = 290  # (MODIFIÉ Task 87) 288 (état Task 86) + 2 fichiers "
            "Task 87 (test87 redirection connexion ×2)")


ok = True
for chemin in TESTS:
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    avant = src
    for a, b in REMPLACEMENTS_TESTS:
        src = src.replace(a, b)
    deja = "0.2.17 (MODIFIÉ Task 87)" in avant
    if src == avant and not deja:
        print(f"ATTENTION {chemin} : aucun remplacement effectué")
        ok = False
    open(p, "w", encoding="utf-8").write(src)
    reste = src.count("0.2.16")
    print(f"OK {chemin} : version réalignée 0.2.17 (mentions 0.2.16 restantes : {reste}, historiques acceptées)")

for chemin in MAILONS:
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    n = src.count("0.2.16")
    if n:
        src = src.replace("0.2.16", "0.2.17")
        open(p, "w", encoding="utf-8").write(src)
    elif "0.2.17" not in src:
        print(f"ATTENTION {chemin} : ni 0.2.16 ni 0.2.17 — à vérifier")
        ok = False
    print(f"OK {chemin} : {n} chaîne(s) de version réalignée(s) 0.2.16 → 0.2.17")

# Contrôle final : aucun maillon actif ne doit plus exiger 0.2.16
for chemin in MAILONS:
    src = open(os.path.join(BASE, chemin), encoding="utf-8").read()
    if "0.2.16" in src:
        print(f"ECHEC {chemin} : 0.2.16 encore présent")
        ok = False

# --- ATTENDU → 290 (normalisation regex, idempotent) ---
for chemin in FICHIERS_ATTENDU:
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    src2, n = _RX_ATTENDU.subn(_normaliser, src)
    if n == 0:
        print(f"ECHEC {chemin} : ATTENDU non porté à 290")
        ok = False
        continue
    open(p, "w", encoding="utf-8").write(src2)
    print(f"OK {chemin} : ATTENDU → 290 ({n} ligne(s) normalisée(s))")

print("\nPATCH TASK 87 :", "TOUT OK" if ok else "ÉCHECS À CORRIGER")
raise SystemExit(0 if ok else 1)
