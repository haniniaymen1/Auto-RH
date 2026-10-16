#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 83 — mise en cohérence de la chaîne ZIP et des maillons historiques :
  1. ATTENDU : 278 fichiers (état Task 81) -> 282 fichiers (état Task 83 =
     + test82_champ_otp_connexion.py + test82_harnais.sh + 
     test83_premiere_connexion_moderne.py + test83_harnais.sh) dans les
     maillons 38/64/65/66/67/69/70/71/73/74/75/76/77/78/79/80/81 + suites
     task40/42. Idempotent : relançable sans effet si déjà appliqué.
  2. Contrôles de version des maillons 74-81 : 0.2.11 -> 0.2.13 (convention :
     seuls les CONTRÔLES sont réalignés, jamais les fichiers pour « faire
     passer »).
  3. Contrôles de contenu portail des maillons 76/78/80/81 : la page
     d'inscription est « Configuration OTP » (otpPremiereHtml — QR + champ
     Code OTP, maquette Task 83) ; le refus OTP_QR_A_SCANNER Task 80 est
     SUPPRIMÉ du portail (le code est accepté pendant l'inscription).
"""
import os
import re

BASE = "/home/z/my-project"

MAILLONS_IDEMPOTENTS = {64: "64", 65: "65", 66: "66", 67: "67", 69: "69"}
MAILLONS_STANDARDS = [70, 71, 73, 74, 75, 76, 77, 78, 79, 80, 81]
SUITES_STATIQUES = [
    "scripts/test_task40_securisation_auto.py",
    "scripts/test_task42_demarrage_unique.py",
]

NORME_83 = "ATTENDU = 282  # (MODIFIÉ Task 83) 278 (état Task 81) + 2 fichiers Task 82 + 2 fichiers Task 83"
IDEM_83 = (
    "ATTENDU = 282  # (MODIFIÉ Task 83) chaîne idempotente : l'archive courante "
    "porte l'état FINAL Task 83 (282 fichiers) à toutes les étapes — maillon "
    "{num} ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter"
)
IDEM_38 = (
    "ATTENDU = 282  # (MODIFIÉ Task 83) chaîne idempotente : l'archive courante "
    "porte l'état FINAL Task 83 (282 fichiers) à toutes les étapes — étapes "
    "intermédiaires 38/40/42 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter"
)
NORME_71 = NORME_83 + " — chaîne idempotente : l'état FINAL est porté à chaque étape"

FICHIERS = (
    [f"scripts/update_zip_task{num}.py" for num in MAILLONS_IDEMPOTENTS]
    + [f"scripts/update_zip_task{num}.py" for num in MAILLONS_STANDARDS]
    + ["scripts/update_zip_task38.py"]
    + SUITES_STATIQUES
)

# --- 1. ATTENDU 278 -> 282 ---
for chemin in FICHIERS:
    complet = os.path.join(BASE, chemin)
    with open(complet, encoding="utf-8") as f:
        texte = f.read()
    m = re.search(r"^ATTENDU = (\d+).*$", texte, re.M)
    if not m:
        print(f"ANOMALIE {chemin} : aucune ligne ATTENDU")
        continue
    if m.group(1) == "282":
        print(f"SKIPPED {chemin} (déjà à 282)")
        continue
    if m.group(1) != "278":
        print(f"ANOMALIE {chemin} : ATTENDU inattendu = {m.group(1)}")
        continue
    num = chemin.split("update_zip_task")[-1].replace(".py", "") if "update_zip_task" in chemin else ""
    if "task38" in chemin:
        nouvelle = IDEM_38
    elif num in MAILLONS_IDEMPOTENTS:
        nouvelle = IDEM_83.format(num=num)
    elif num == "71":
        nouvelle = NORME_71
    else:
        nouvelle = NORME_83
    texte = texte[: m.start()] + nouvelle + texte[m.end():]
    with open(complet, "w", encoding="utf-8") as f:
        f.write(texte)
    print(f"OK {chemin} : ATTENDU 278 -> 282")

# --- 2. Versions 0.2.11 -> 0.2.13 dans les maillons 74-81 ---
VERSION_REALIGN = {
    "scripts/update_zip_task74.py": [
        ('check("package.json : version 0.2.11 (MODIFIÉ Task 81)", \'"version": "0.2.11"\' in pkg, pkg[:80])',
         'check("package.json : version 0.2.13 (MODIFIÉ Task 83)", \'"version": "0.2.13"\' in pkg, pkg[:80])'),
    ],
    "scripts/update_zip_task75.py": [
        ('check("package.json : version 0.2.11 (MODIFIÉ Task 81)", \'"version": "0.2.11"\' in pkg, pkg[:80])',
         'check("package.json : version 0.2.13 (MODIFIÉ Task 83)", \'"version": "0.2.13"\' in pkg, pkg[:80])'),
    ],
    "scripts/update_zip_task76.py": [
        ('check("package.json : version 0.2.11 (MODIFIÉ Task 81)", \'"version": "0.2.11"\' in pkg, pkg[:80])',
         'check("package.json : version 0.2.13 (MODIFIÉ Task 83)", \'"version": "0.2.13"\' in pkg, pkg[:80])'),
    ],
    "scripts/update_zip_task77.py": [
        ('check("test76 réaligné (version 0.2.11, MODIFIÉ Task 81)", \'"0.2.11"\' in t76)',
         'check("test76 réaligné (version 0.2.13, MODIFIÉ Task 83)", \'"0.2.13"\' in t76)'),
        ('check("package.json : version 0.2.11 (MODIFIÉ Task 81)", \'"version": "0.2.11"\' in pkg, pkg[:80])',
         'check("package.json : version 0.2.13 (MODIFIÉ Task 83)", \'"version": "0.2.13"\' in pkg, pkg[:80])'),
    ],
    "scripts/update_zip_task78.py": [
        ('"Task 81" in t74 and "0.2.11" in t74)',
         '"Task 83" in t74 and "0.2.13" in t74)'),
        ('"Task 81" in t75 and "0.2.11" in t75)',
         '"Task 83" in t75 and "0.2.13" in t75)'),
        ('and \'"0.2.11"\' in t76)',
         'and \'"0.2.13"\' in t76)'),
        ('check("package.json : version 0.2.11", \'"version": "0.2.11"\' in pkg, pkg[:80])',
         'check("package.json : version 0.2.13", \'"version": "0.2.13"\' in pkg, pkg[:80])'),
    ],
    "scripts/update_zip_task79.py": [
        ('check("package.json : version 0.2.11", \'"version": "0.2.11"\' in pkg, pkg[:80])',
         'check("package.json : version 0.2.13", \'"version": "0.2.13"\' in pkg, pkg[:80])'),
        ('\'"0.2.11"\' in t74 and \'"0.2.11"\' in t75 and \'"0.2.11"\' in t76 and \'"0.2.11"\' in t78)',
         '\'"0.2.13"\' in t74 and \'"0.2.13"\' in t75 and \'"0.2.13"\' in t76 and \'"0.2.13"\' in t78)'),
    ],
    "scripts/update_zip_task80.py": [
        ('check("package.json : version 0.2.11", \'"version": "0.2.11"\' in pkg, pkg[:80])',
         'check("package.json : version 0.2.13", \'"version": "0.2.13"\' in pkg, pkg[:80])'),
    ],
    "scripts/update_zip_task81.py": [
        ('check("package.json : version 0.2.11", \'"version": "0.2.11"\' in pkg, pkg[:80])',
         'check("package.json : version 0.2.13", \'"version": "0.2.13"\' in pkg, pkg[:80])'),
        ('"0.2.11" in t74 and "Task 81" in t74)',
         '"0.2.13" in t74 and "Task 83" in t74)'),
        ('"0.2.11" in t80)',
         '"0.2.13" in t80)'),
    ],
}

for chemin, paires in VERSION_REALIGN.items():
    complet = os.path.join(BASE, chemin)
    with open(complet, encoding="utf-8") as f:
        texte = f.read()
    change = False
    for ancien, nouveau in paires:
        if nouveau in texte:
            continue  # déjà appliqué (idempotence)
        if ancien in texte:
            texte = texte.replace(ancien, nouveau)
            change = True
        else:
            print(f"ANOMALIE {chemin} : motif de version introuvable -> {ancien[:70]}…")
    if change:
        with open(complet, "w", encoding="utf-8") as f:
            f.write(texte)
        print(f"OK {chemin} : contrôles de version réalignés 0.2.13")

# --- 3. Contenu portail : otpQrSeulHtml -> otpPremiereHtml + refus supprimé ---
CONTENU_REALIGN = {
    "scripts/update_zip_task76.py": [
        ('and "function otpQrSeulHtml(defi, svgQr)" in portail',
         'and "function otpPremiereHtml(defi, svgQr)" in portail'),
    ],
    "scripts/update_zip_task78.py": [
        ('and "function otpQrSeulHtml(defi, svgQr)" in portail',
         'and "function otpPremiereHtml(defi, svgQr)" in portail'),
    ],
    "scripts/update_zip_task80.py": [
        ('''    # --- Contrôles Task 80 : page « UNIQUEMENT le QR code » ---
    check("portail : page d'inscription otpQrSeulHtml(defi, svgQr) présente",
          "function otpQrSeulHtml(defi, svgQr)" in portail)
    i0 = portail.index("function otpQrSeulHtml")
    i1 = portail.index("function otpExpireHtml", i0)
    corps_qr = portail[i0:i1]
    check("portail : la fenêtre QR contient le BLOC QR et RIEN d'autre (ni code affiché, ni formulaire, ni boutons, ni compte à rebours)",
          'class="otp-qr otp-qr-seul"' in corps_qr and 'data-payload="' in corps_qr
          and 'id="otp-affiche"' not in corps_qr and "Confirmez le code OTP" not in corps_qr
          and "Valider le code" not in corps_qr and "Générer un nouveau code" not in corps_qr
          and "Se déconnecter" not in corps_qr and 'id="compte"' not in corps_qr)''',
         '''    # --- Contrôles Task 80 (MODIFIÉ Task 83) : page « Configuration OTP » ---
    check("portail : page d'inscription otpPremiereHtml(defi, svgQr) présente (MODIFIÉ Task 83)",
          "function otpPremiereHtml(defi, svgQr)" in portail)
    i0 = portail.index("function otpPremiereHtml")
    i1 = portail.index("function otpExpireHtml", i0)
    corps_qr = portail[i0:i1]
    check("portail : la fenêtre d'inscription contient le BLOC QR + le champ « Code OTP » + le bouton « Valider » (maquette Task 83), sans code affiché ni compte à rebours",
          'class="otp-qr otp-premiere"' in corps_qr and 'data-payload="' in corps_qr
          and 'id="otp-saisie"' in corps_qr and 'id="btn-otp"' in corps_qr
          and 'id="otp-affiche"' not in corps_qr and "Confirmez le code OTP" not in corps_qr
          and "Générer un nouveau code" not in corps_qr
          and "Se déconnecter" not in corps_qr and 'id="compte"' not in corps_qr)'''),
        ('''    check("portail : refus 403 OTP_QR_A_SCANNER pendant le défi QR (sans consommer de tentative)",
          'code: "OTP_QR_A_SCANNER"' in portail and "defi.premiere" in portail)''',
         '''    check("portail : refus Task 80 OTP_QR_A_SCANNER SUPPRIMÉ (MODIFIÉ Task 83 : le code est accepté dans la fenêtre d'inscription)",
          'code: "OTP_QR_A_SCANNER"' not in portail and "defi.premiere" in portail)'''),
        ('"RESULTAT TASK 80" in t80 and "OTP_QR_A_SCANNER" in t80',
         '"RÉSULTAT TASK 80" in t80 and "OTP_QR_A_SCANNER" in t80 and "0.2.13" in t80'),
    ],
    "scripts/update_zip_task81.py": [
        ('''    check("invariant Task 80 : page QR seul + verrou qrPresente toujours dans le portail embarqué",
          "function otpQrSeulHtml(defi, svgQr)" in portail
          and "const premiereConnexion = !acc.lastLoginAt && !acc.qrPresente" in portail
          and 'code: "OTP_QR_A_SCANNER"' in portail)''',
         '''    check("invariant Task 80/83 : page « Configuration OTP » + verrou qrPresente toujours dans le portail embarqué",
          "function otpPremiereHtml(defi, svgQr)" in portail
          and "const premiereConnexion = !acc.lastLoginAt && !acc.qrPresente" in portail
          and 'code: "OTP_QR_A_SCANNER"' not in portail)'''),
    ],
}

for chemin, paires in CONTENU_REALIGN.items():
    complet = os.path.join(BASE, chemin)
    with open(complet, encoding="utf-8") as f:
        texte = f.read()
    change = False
    for ancien, nouveau in paires:
        if nouveau in texte:
            continue  # déjà appliqué
        if ancien in texte:
            texte = texte.replace(ancien, nouveau)
            change = True
        else:
            print(f"ANOMALIE {chemin} : motif de contenu introuvable -> {ancien[:70]}…")
    if change:
        with open(complet, "w", encoding="utf-8") as f:
            f.write(texte)
        print(f"OK {chemin} : contrôles de contenu réalignés Task 83")

print("PATCH ATTENDU TASK 83 TERMINÉ")
