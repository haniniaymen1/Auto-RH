#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 81 — mise en cohérence de la chaîne ZIP, des suites task40/task42 et
des maillons historiques :
  1. ATTENDU : 276 fichiers (état Task 80) -> 278 fichiers (état Task 81 =
     + scripts/test81_reconnexion_apres_scan.py + scripts/test81_harnais.sh)
     dans les maillons 38/64/65/66/67/69/70/71/73/74/75/76/77/78/79/80 +
     suites task40/42. Idempotent : relançable sans effet si déjà appliqué.
  2. Contrôles de version des maillons 74-80 : 0.2.10 -> 0.2.11 (convention :
     seuls les CONTRÔLES sont réalignés, jamais les fichiers pour « faire
     passer »).
"""
import os
import re

BASE = "/home/z/my-project"

MAILLONS_IDEMPOTENTS = {64: "64", 65: "65", 66: "66", 67: "67", 69: "69"}
MAILLONS_STANDARDS = [70, 71, 73, 74, 75, 76, 77, 78, 79, 80]
SUITES_STATIQUES = [
    "scripts/test_task40_securisation_auto.py",
    "scripts/test_task42_demarrage_unique.py",
]

NORME_81 = "ATTENDU = 278  # (MODIFIÉ Task 81) 276 (état Task 80) + 2 nouveaux fichiers Task 81"
IDEM_81 = (
    "ATTENDU = 278  # (MODIFIÉ Task 81) chaîne idempotente : l'archive courante "
    "porte l'état FINAL Task 81 (278 fichiers) à toutes les étapes — maillon "
    "{num} ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter"
)
IDEM_38 = (
    "ATTENDU = 278  # (MODIFIÉ Task 81) chaîne idempotente : l'archive courante "
    "porte l'état FINAL Task 81 (278 fichiers) à toutes les étapes — étapes "
    "intermédiaires 38/40/42 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter"
)
NORME_71 = NORME_81 + " — chaîne idempotente : l'état FINAL est porté à chaque étape"

FICHIERS = (
    [f"scripts/update_zip_task{num}.py" for num in MAILLONS_IDEMPOTENTS]
    + [f"scripts/update_zip_task{num}.py" for num in MAILLONS_STANDARDS]
    + ["scripts/update_zip_task38.py"]
    + SUITES_STATIQUES
)

# --- 1. ATTENDU 276 -> 278 ---
for chemin in FICHIERS:
    complet = os.path.join(BASE, chemin)
    with open(complet, encoding="utf-8") as f:
        texte = f.read()
    m = re.search(r"^ATTENDU = (\d+).*$", texte, re.M)
    if not m:
        print(f"ANOMALIE {chemin} : aucune ligne ATTENDU")
        continue
    if m.group(1) == "278":
        print(f"SKIPPED {chemin} (déjà à 278)")
        continue
    if m.group(1) != "276":
        print(f"ANOMALIE {chemin} : ATTENDU inattendu = {m.group(1)}")
        continue
    num = chemin.split("update_zip_task")[-1].replace(".py", "") if "update_zip_task" in chemin else ""
    if "task38" in chemin:
        nouvelle = IDEM_38
    elif num in MAILLONS_IDEMPOTENTS:
        nouvelle = IDEM_81.format(num=num)
    elif num == "71":
        nouvelle = NORME_71
    else:
        nouvelle = NORME_81
    texte = texte[: m.start()] + nouvelle + texte[m.end():]
    with open(complet, "w", encoding="utf-8") as f:
        f.write(texte)
    print(f"OK {chemin} : ATTENDU 276 -> 278")

# --- 2. Version 0.2.10 -> 0.2.11 dans les maillons 74-80 ---
VERSION_REALIGN = {
    "scripts/update_zip_task74.py": [
        ('check("package.json : version 0.2.10 (MODIFIÉ Task 80)", \'"version": "0.2.10"\' in pkg, pkg[:80])',
         'check("package.json : version 0.2.11 (MODIFIÉ Task 81)", \'"version": "0.2.11"\' in pkg, pkg[:80])'),
    ],
    "scripts/update_zip_task75.py": [
        ('check("package.json : version 0.2.10 (MODIFIÉ Task 80)", \'"version": "0.2.10"\' in pkg, pkg[:80])',
         'check("package.json : version 0.2.11 (MODIFIÉ Task 81)", \'"version": "0.2.11"\' in pkg, pkg[:80])'),
    ],
    "scripts/update_zip_task76.py": [
        ('check("package.json : version 0.2.10 (MODIFIÉ Task 80)", \'"version": "0.2.10"\' in pkg, pkg[:80])',
         'check("package.json : version 0.2.11 (MODIFIÉ Task 81)", \'"version": "0.2.11"\' in pkg, pkg[:80])'),
    ],
    "scripts/update_zip_task77.py": [
        ('check("test76 réaligné (version 0.2.10, MODIFIÉ Task 80)", \'"0.2.10"\' in t76)',
         'check("test76 réaligné (version 0.2.11, MODIFIÉ Task 81)", \'"0.2.11"\' in t76)'),
        ('check("package.json : version 0.2.10 (MODIFIÉ Task 80)", \'"version": "0.2.10"\' in pkg, pkg[:80])',
         'check("package.json : version 0.2.11 (MODIFIÉ Task 81)", \'"version": "0.2.11"\' in pkg, pkg[:80])'),
    ],
    "scripts/update_zip_task78.py": [
        ('check("test74 réaligné Task 80 (page QR seul + version 0.2.10)",\n          "MODIFIÉ Task 80" in t74 and "0.2.10" in t74)',
         'check("test74 réaligné Task 81 (bandeau échec expliqué + version 0.2.11)",\n          "Task 81" in t74 and "0.2.11" in t74)'),
        ('check("test75 réaligné Task 80 (page QR seul + version 0.2.10)",\n          "Task 80" in t75 and "0.2.10" in t75)',
         'check("test75 réaligné Task 81 (version 0.2.11)",\n          "Task 81" in t75 and "0.2.11" in t75)'),
        ('check("test76 réaligné Task 80 (page QR seul + otpHtml(defi) + version 0.2.10)",\n          "Task 80" in t76 and "function otpHtml(defi, svgQr)" in t76\n          and \'"0.2.10"\' in t76)',
         'check("test76 réaligné Task 81 (otpHtml(defi) + version 0.2.11)",\n          "Task 81" in t76 and "function otpHtml(defi, svgQr)" in t76\n          and \'"0.2.11"\' in t76)'),
        ('check("package.json : version 0.2.10", \'"version": "0.2.10"\' in pkg, pkg[:80])',
         'check("package.json : version 0.2.11", \'"version": "0.2.11"\' in pkg, pkg[:80])'),
    ],
    "scripts/update_zip_task79.py": [
        ('check("package.json : version 0.2.10", \'"version": "0.2.10"\' in pkg, pkg[:80])',
         'check("package.json : version 0.2.11", \'"version": "0.2.11"\' in pkg, pkg[:80])'),
        ('check("tests réalignés Task 79 : 74/75/76/78 en version 0.2.10",\n          \'"0.2.10"\' in t74 and \'"0.2.10"\' in t75 and \'"0.2.10"\' in t76 and \'"0.2.10"\' in t78)',
         'check("tests réalignés Task 81 : 74/75/76/78 en version 0.2.11",\n          \'"0.2.11"\' in t74 and \'"0.2.11"\' in t75 and \'"0.2.11"\' in t76 and \'"0.2.11"\' in t78)'),
    ],
    "scripts/update_zip_task80.py": [
        ('check("package.json : version 0.2.10", \'"version": "0.2.10"\' in pkg, pkg[:80])',
         'check("package.json : version 0.2.11", \'"version": "0.2.11"\' in pkg, pkg[:80])'),
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
        print(f"OK {chemin} : contrôles de version réalignés 0.2.11")

print("PATCH ATTENDU TASK 81 TERMINÉ")
