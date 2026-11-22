#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 80 — mise en cohérence de la chaîne ZIP, des suites task40/task42 et
des maillons historiques :
  1. ATTENDU : 274 fichiers (état Task 79) -> 276 fichiers (état Task 80 =
     + scripts/test80_qr_seul.py + scripts/test80_harnais.sh) dans les
     maillons 38/64/65/66/67/69/70/71/73/74/75/76/77/78/79 + suites
     task40/42. Idempotent : relançable sans effet si déjà appliqué.
  2. Contrôles de version des maillons 74-79 : 0.2.9 -> 0.2.10 (convention :
     seuls les CONTRÔLES sont réalignés, jamais les fichiers pour « faire
     passer »).
  3. Contrôles de composant des maillons 64/65/67/70/71/73/77 : les demandes
     Task 80 ajoutent légitimement la SECTION « Gestion des QR codes » dans
     l'onglet « Accès portail » (icônes QrCode/RefreshCw, mention « Aucun
     accès portail créé » dans l'état vide de la section) — les anciens
     contrôles « aucun QR code » / « plus aucun message » / « RefreshCw »
     datent de l'époque où l'onglet n'avait AUCUN rôle QR : ils sont
     réorientés sur l'état FINAL (section dédiée présente, chaîne intacte).
"""
import os
import re

BASE = "/home/z/my-project"

MAILLONS_IDEMPOTENTS = {64: "64", 65: "65", 66: "66", 67: "67", 69: "69"}
MAILLONS_STANDARDS = [70, 71, 73, 74, 75, 76, 77, 78, 79]
SUITES_STATIQUES = [
    "scripts/test_task40_securisation_auto.py",
    "scripts/test_task42_demarrage_unique.py",
]

NORME_80 = "ATTENDU = 276  # (MODIFIÉ Task 80) 274 (état Task 79) + 2 nouveaux fichiers Task 80"
IDEM_80 = (
    "ATTENDU = 276  # (MODIFIÉ Task 80) chaîne idempotente : l'archive courante "
    "porte l'état FINAL Task 80 (276 fichiers) à toutes les étapes — maillon "
    "{num} ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter"
)
IDEM_38 = (
    "ATTENDU = 276  # (MODIFIÉ Task 80) chaîne idempotente : l'archive courante "
    "porte l'état FINAL Task 80 (276 fichiers) à toutes les étapes — étapes "
    "intermédiaires 38/40/42 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter"
)
NORME_71 = NORME_80 + " — chaîne idempotente : l'état FINAL est porté à chaque étape"

FICHIERS = (
    [f"scripts/update_zip_task{num}.py" for num in MAILLONS_IDEMPOTENTS]
    + [f"scripts/update_zip_task{num}.py" for num in MAILLONS_STANDARDS]
    + ["scripts/update_zip_task38.py"]
    + SUITES_STATIQUES
)

# --- 1. ATTENDU 274 -> 276 ---
for chemin in FICHIERS:
    complet = os.path.join(BASE, chemin)
    with open(complet, encoding="utf-8") as f:
        texte = f.read()
    m = re.search(r"^ATTENDU = (\d+).*$", texte, re.M)
    if not m:
        print(f"ANOMALIE {chemin} : aucune ligne ATTENDU")
        continue
    if m.group(1) == "276":
        print(f"SKIPPED {chemin} (déjà à 276)")
        continue
    if m.group(1) != "274":
        print(f"ANOMALIE {chemin} : ATTENDU inattendu = {m.group(1)}")
        continue
    num = chemin.split("update_zip_task")[-1].replace(".py", "") if "update_zip_task" in chemin else ""
    if "task38" in chemin:
        nouvelle = IDEM_38
    elif num in MAILLONS_IDEMPOTENTS:
        nouvelle = IDEM_80.format(num=num)
    elif num == "71":
        nouvelle = NORME_71
    else:
        nouvelle = NORME_80
    texte = texte[: m.start()] + nouvelle + texte[m.end():]
    with open(complet, "w", encoding="utf-8") as f:
        f.write(texte)
    print(f"OK {chemin} : ATTENDU 274 -> 276")

# --- 2. Version 0.2.9 -> 0.2.10 dans les maillons 74-79 ---
VERSION_REALIGN = {
    "scripts/update_zip_task74.py": [
        ('check("package.json : version 0.2.9 (MODIFIÉ Task 79)", \'"version": "0.2.9"\' in pkg, pkg[:80])',
         'check("package.json : version 0.2.10 (MODIFIÉ Task 80)", \'"version": "0.2.10"\' in pkg, pkg[:80])'),
    ],
    "scripts/update_zip_task75.py": [
        ('check("package.json : version 0.2.9 (MODIFIÉ Task 79)", \'"version": "0.2.9"\' in pkg, pkg[:80])',
         'check("package.json : version 0.2.10 (MODIFIÉ Task 80)", \'"version": "0.2.10"\' in pkg, pkg[:80])'),
    ],
    "scripts/update_zip_task76.py": [
        ('check("package.json : version 0.2.9 (MODIFIÉ Task 79)", \'"version": "0.2.9"\' in pkg, pkg[:80])',
         'check("package.json : version 0.2.10 (MODIFIÉ Task 80)", \'"version": "0.2.10"\' in pkg, pkg[:80])'),
    ],
    "scripts/update_zip_task77.py": [
        ('check("test76 réaligné (version 0.2.9, MODIFIÉ Task 79)", \'"0.2.9"\' in t76)',
         'check("test76 réaligné (version 0.2.10, MODIFIÉ Task 80)", \'"0.2.10"\' in t76)'),
        ('check("package.json : version 0.2.9 (MODIFIÉ Task 79)", \'"version": "0.2.9"\' in pkg, pkg[:80])',
         'check("package.json : version 0.2.10 (MODIFIÉ Task 80)", \'"version": "0.2.10"\' in pkg, pkg[:80])'),
    ],
    "scripts/update_zip_task78.py": [
        ('check("test74 réaligné Task 79 (payload otpauth + version 0.2.9)",\n          "RÉALIGNÉ Task 78" in t74 and "0.2.9" in t74)',
         'check("test74 réaligné Task 80 (page QR seul + version 0.2.10)",\n          "RÉALIGNÉ Task 80" in t74 and "0.2.10" in t74)'),
        ('check("test75 réaligné Task 79 (creerDefiOtp à 4 arguments + version 0.2.9)",\n          "4 arguments" in t75 and "0.2.9" in t75)',
         'check("test75 réaligné Task 80 (page QR seul + version 0.2.10)",\n          "Task 80" in t75 and "0.2.10" in t75)'),
        ('check("test76 réaligné Task 79 (payload otpauth + otpHtml(defi) + version 0.2.9)",\n          "RÉALIGNÉ Task 78" in t76 and "function otpHtml(defi, svgQr)" in t76\n          and \'"0.2.9"\' in t76)',
         'check("test76 réaligné Task 80 (page QR seul + otpHtml(defi) + version 0.2.10)",\n          "Task 80" in t76 and "function otpHtml(defi, svgQr)" in t76\n          and \'"0.2.10"\' in t76)'),
        ('check("package.json : version 0.2.9", \'"version": "0.2.9"\' in pkg, pkg[:80])',
         'check("package.json : version 0.2.10", \'"version": "0.2.10"\' in pkg, pkg[:80])'),
    ],
    "scripts/update_zip_task79.py": [
        ('check("package.json : version 0.2.9", \'"version": "0.2.9"\' in pkg, pkg[:80])',
         'check("package.json : version 0.2.10", \'"version": "0.2.10"\' in pkg, pkg[:80])'),
        ('check("tests réalignés Task 79 : 74/75/76/78 en version 0.2.9",\n          \'"0.2.9"\' in t74 and \'"0.2.9"\' in t75 and \'"0.2.9"\' in t76 and \'"0.2.9"\' in t78)',
         'check("tests réalignés Task 79 : 74/75/76/78 en version 0.2.10",\n          \'"0.2.10"\' in t74 and \'"0.2.10"\' in t75 and \'"0.2.10"\' in t76 and \'"0.2.10"\' in t78)'),
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
        print(f"OK {chemin} : contrôles de version réalignés 0.2.10")

# --- 3. Contrôles de composant des maillons 64/65/67/70/71/73/77 ---
COMPONENT_REALIGN = {
    "scripts/update_zip_task64.py": [
        ('check("onglet accès portail : mot de passe initial + réinitialiser (plus de QR)",\n          "Créer l\'accès" in tab and "Réinitialiser" in tab and "Changement requis" in tab\n          and "QrCode" not in tab)',
         'check("onglet accès portail : mot de passe initial + réinitialiser (MODIFIÉ Task 80 : section « Gestion des QR codes » dédiée)",\n          "Créer l\'accès" in tab and "Réinitialiser" in tab and "Changement requis" in tab\n          and "Gestion des QR codes" in tab)'),
    ],
    "scripts/update_zip_task65.py": [
        ('check("onglet : toujours aucun QR code", "QrCode" not in tab and "qrcode" not in tab.lower())',
         'check("onglet : section « Gestion des QR codes » dédiée (MODIFIÉ Task 80)",\n          "Gestion des QR codes" in tab and "Afficher le QR" in tab)'),
    ],
    "scripts/update_zip_task67.py": [
        ('check("onglet : Task 66 conservée (consigne tirets) + aucun QR code",\n          "tirets et espaces sont ignorés" in tab and "QrCode" not in tab\n          and "qrcode" not in tab.lower())',
         'check("onglet : Task 66 conservée (consigne tirets) + section QR dédiée (MODIFIÉ Task 80)",\n          "tirets et espaces sont ignorés" in tab and "Gestion des QR codes" in tab)'),
    ],
    "scripts/update_zip_task70.py": [
        ('check("composant : aucun QR code", "QrCode" not in tab and "qrcode" not in tab.lower())',
         'check("composant : section « Gestion des QR codes » dédiée (MODIFIÉ Task 80)",\n          "Gestion des QR codes" in tab and "Réinitialiser le QR" in tab)'),
    ],
    "scripts/update_zip_task71.py": [
        ('check("composant : plus aucun message « Aucun accès portail créé »",\n          "Aucun accès portail créé" not in tab\n          and "Aucun employé détecté pour le moment" in tab)',
         'check("composant : la mention « Aucun accès portail créé » ne vit que dans la section QR (MODIFIÉ Task 80)",\n          "Aucun accès portail créé" in tab\n          and "Aucun employé détecté pour le moment" in tab\n          and tab.index("Aucun accès portail créé") > tab.index("Gestion des QR codes"))'),
    ],
    "scripts/update_zip_task73.py": [
        ('and "pickerOpen" not in tab and "RefreshCw" not in tab',
         'and "pickerOpen" not in tab and "Actualiser" not in tab'),
    ],
    "scripts/update_zip_task77.py": [
        ('and "Choisir dans la liste" not in tab and "pickerOpen" not in tab\n          and "RefreshCw" not in tab and "onClick={() => create()}" not in tab)',
         'and "Choisir dans la liste" not in tab and "pickerOpen" not in tab\n          and "Actualiser" not in tab and "onClick={() => create()}" not in tab)'),
    ],
}

for chemin, paires in COMPONENT_REALIGN.items():
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
            print(f"ANOMALIE {chemin} : motif composant introuvable -> {ancien[:70]}…")
    if change:
        with open(complet, "w", encoding="utf-8") as f:
            f.write(texte)
        print(f"OK {chemin} : contrôles de composant réalignés Task 80")

print("PATCH ATTENDU TASK 80 TERMINÉ")
