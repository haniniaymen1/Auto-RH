#!/usr/bin/env python3
"""Task 92 (19/09/2026) : « Send Mail » — service d'envoi d'e-mails
(bouton « Send Mail » par ligne dans « Accès Portail », popup destinataire +
Send, e-mail CIN/mot de passe initial/serveur/port/URL, panneau SMTP avec
test Gmail, nodemailer).

CE PATCH (à exécuter AVANT bootstrap_zip_task92.py) :
  - ATTENDU 297 → 304 : Task 92 AJOUTE 7 fichiers
    (src/app/api/mail-config/route.ts, src/lib/mailer.ts,
    src/components/payslip/mail-panel.tsx, scripts/test92_send_mail.py,
    scripts/test92_serveur_smtp.py, scripts/test92_inserer.js,
    scripts/test92_harnais.sh) — l'ATTENDU des maillons/suites qui portent un
    contrôle de comptage (38, 64-91 + task40/42) est porté à 304 (l'état
    final est injecté au préalable par bootstrap_zip_task92.py) ;
  - RÉALIGNEMENT DES CONTRÔLES DE VERSION (convention établie : on réaligne
    les CONTRÔLES, jamais les fichiers pour « faire passer ») :
      * suites test74/75/76/78/80/81/82/83/84/85/86/87/88 : « version du
        produit = 0.2.21 (NOUVEAU Task 91) » → « 0.2.22 (NOUVEAU Task 92) » ;
      * suite test89 : contrôle « [VERSION] package.json en 0.2.21 » → 0.2.22 ;
      * suite test90 : contrôles de version 0.2.21 → 0.2.22 ;
      * suite test91 : contrôle « package.json : version 0.2.21 » → 0.2.22 ;
      * maillons update_zip_task74..91 : chaînes de contrôle « 0.2.21 » →
        « 0.2.22 ».
  - IDEMPOTENT : relancer ne change rien.

Historique : patch_attendu_task91.py (ATTENDU 296 → 297 + versions 0.2.20 →
0.2.21) reste en place comme trace historique.
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
]

REMPLACEMENTS_TESTS = [
    ('check("version du produit = 0.2.21 (NOUVEAU Task 91)"',
     'check("version du produit = 0.2.22 (NOUVEAU Task 92)"'),
    ('check("S19 version du produit = 0.2.21 (NOUVEAU Task 91)"',
     'check("S19 version du produit = 0.2.22 (NOUVEAU Task 92)"'),
    ('check("S01 version du produit = 0.2.21 (NOUVEAU Task 91)"',
     'check("S01 version du produit = 0.2.22 (NOUVEAU Task 92)"'),
    ('pkg.get("version") == "0.2.21"', 'pkg.get("version") == "0.2.22"'),
]
REMPLACEMENT_TEST89 = [
    ('check("[VERSION] package.json en 0.2.21", \'"version": "0.2.21"\' in pkg)',
     'check("[VERSION] package.json en 0.2.22", \'"version": "0.2.22"\' in pkg)'),
]
REMPLACEMENT_TEST91 = [
    ('check("package.json : version 0.2.21", pkg.get("version") == "0.2.21"',
     'check("package.json : version 0.2.22", pkg.get("version") == "0.2.22"'),
]

# --- ATTENDU 297 → 304 (maillons + suites task40/42) ---
# Task 92 AJOUTE 7 fichiers (3 sources + 4 scripts test92) : 297 + 7 = 304.
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
    "scripts/test_task40_securisation_auto.py",
    "scripts/test_task42_demarrage_unique.py",
]

_RX_ATTENDU = _re.compile(r"ATTENDU = 29[78](  #[^\n]*)?|ATTENDU = 30[0-4](  #[^\n]*)?")


def _normaliser(m):
    com = m.group(1) or ""
    if "étapes intermédiaires" in com:
        return ("ATTENDU = 304  # (NOUVEAU Task 92) chaîne idempotente : l'archive "
                "courante porte l'état FINAL Task 92 (304 fichiers) — étapes "
                "intermédiaires ne font que REMPLACER/CONSERVER leurs fichiers, sans en ajouter")
    if "chaîne idempotente" in com:
        return ("ATTENDU = 304  # (NOUVEAU Task 92) chaîne idempotente : l'archive "
                "courante porte l'état FINAL Task 92 (304 fichiers)")
    return ("ATTENDU = 304  # (MODIFIÉ Task 92) 297 (état Task 91) + 7 fichiers "
            "Task 92 (mail-config + mailer + mail-panel + test92 ×4)")


ok = True
for chemin in TESTS:
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    avant = src
    for a, b in REMPLACEMENTS_TESTS:
        src = src.replace(a, b)
    deja = "0.2.22 (NOUVEAU Task 92)" in avant
    if src == avant and not deja:
        print(f"ATTENTION {chemin} : aucun remplacement effectué")
        ok = False
    open(p, "w", encoding="utf-8").write(src)
    reste = src.count("0.2.21")
    print(f"OK {chemin} : version réalignée 0.2.22 (mentions 0.2.21 restantes : {reste}, historiques acceptées)")

for nom, rempl in (("test89", REMPLACEMENT_TEST89), ("test90", REMPLACEMENTS_TESTS), ("test91", REMPLACEMENT_TEST91)):
    chemin = {"test89": TEST89, "test90": TEST90, "test91": TEST91}[nom]
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    avant = src
    for a, b in rempl:
        src = src.replace(a, b)
    deja = "0.2.22" in avant and nom != "test90"
    if src == avant and not deja:
        print(f"ATTENTION {chemin} : aucun remplacement effectué")
        ok = False
    else:
        open(p, "w", encoding="utf-8").write(src)
        reste = src.count("0.2.21")
        print(f"OK {chemin} : contrôles de version réalignés 0.2.22 (mentions 0.2.21 restantes : {reste}, historiques acceptées)")

for chemin in MAILONS:
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    n = src.count("0.2.21")
    if n:
        src = src.replace("0.2.21", "0.2.22")
        open(p, "w", encoding="utf-8").write(src)
    elif "0.2.22" not in src:
        print(f"ATTENTION {chemin} : ni 0.2.21 ni 0.2.22 — à vérifier")
        ok = False
    print(f"OK {chemin} : {n} chaîne(s) de version réalignée(s) 0.2.21 → 0.2.22")

# Contrôle final : aucun maillon actif ne doit plus exiger 0.2.21
for chemin in MAILONS:
    src = open(os.path.join(BASE, chemin), encoding="utf-8").read()
    if "0.2.21" in src:
        print(f"ECHEC {chemin} : 0.2.21 encore présent")
        ok = False

# --- ATTENDU → 304 (normalisation regex, idempotent) ---
for chemin in FICHIERS_ATTENDU:
    p = os.path.join(BASE, chemin)
    src = open(p, encoding="utf-8").read()
    src2, n = _RX_ATTENDU.subn(_normaliser, src)
    if n == 0:
        print(f"ECHEC {chemin} : ATTENDU non porté à 304")
        ok = False
        continue
    open(p, "w", encoding="utf-8").write(src2)
    print(f"OK {chemin} : ATTENDU → 304 ({n} ligne(s) normalisée(s))")

print("\nPATCH TASK 92 :", "TOUT OK" if ok else "ÉCHECS À CORRIGER")
raise SystemExit(0 if ok else 1)
