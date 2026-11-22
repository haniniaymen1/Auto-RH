#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 79 — mise en cohérence de la chaîne ZIP et des suites task40/task42 :
  1. ATTENDU : 272 fichiers (état Task 78) -> 274 fichiers (état Task 79 =
     + scripts/test79_cin_distincts.py + scripts/test79_harnais.sh) dans les
     maillons 38/64/65/66/67/69/70/71/73/74/75/76/77/78 + suites task40/42.
     Les maillons intermédiaires restent idempotents : chaque étape porte
     l'état FINAL. Idempotent : relançable sans effet si déjà appliqué.
  2. Contrôles de version des maillons 74/75/76/77/78 : 0.2.8 -> 0.2.9
     (convention : seuls les CONTRÔLES sont réalignés, jamais les fichiers
     pour « faire passer »).
"""
import os
import re

BASE = "/home/z/my-project"

MAILLONS_IDEMPOTENTS = {64: "64", 65: "65", 66: "66", 67: "67", 69: "69"}
MAILLONS_STANDARDS = [70, 71, 73, 74, 75, 76, 77, 78]
SUITES_STATIQUES = [
    "scripts/test_task40_securisation_auto.py",
    "scripts/test_task42_demarrage_unique.py",
]

NORME_79 = "ATTENDU = 274  # (MODIFIÉ Task 79) 272 (état Task 78) + 2 nouveaux fichiers Task 79"
IDEM_79 = (
    "ATTENDU = 274  # (MODIFIÉ Task 79) chaîne idempotente : l'archive courante "
    "porte l'état FINAL Task 79 (274 fichiers) à toutes les étapes — maillon "
    "{num} ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter"
)
IDEM_38 = (
    "ATTENDU = 274  # (MODIFIÉ Task 79) chaîne idempotente : l'archive courante "
    "porte l'état FINAL Task 79 (274 fichiers) à toutes les étapes — étapes "
    "intermédiaires 38/40/42 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter"
)
NORME_71 = NORME_79 + " — chaîne idempotente : l'état FINAL est porté à chaque étape"

FICHIERS = (
    [f"scripts/update_zip_task{num}.py" for num in MAILLONS_IDEMPOTENTS]
    + [f"scripts/update_zip_task{num}.py" for num in MAILLONS_STANDARDS]
    + ["scripts/update_zip_task38.py"]
    + SUITES_STATIQUES
)

# --- 1. ATTENDU 272 -> 274 ---
for chemin in FICHIERS:
    complet = os.path.join(BASE, chemin)
    with open(complet, encoding="utf-8") as f:
        texte = f.read()
    m = re.search(r"^ATTENDU = (\d+).*$", texte, re.M)
    if not m:
        print(f"ANOMALIE {chemin} : aucune ligne ATTENDU")
        continue
    if m.group(1) == "274":
        print(f"SKIPPED {chemin} (déjà à 274)")
        continue
    if m.group(1) != "272":
        print(f"ANOMALIE {chemin} : ATTENDU inattendu = {m.group(1)}")
        continue
    num = chemin.split("update_zip_task")[-1].replace(".py", "") if "update_zip_task" in chemin else ""
    if "task38" in chemin:
        nouvelle = IDEM_38
    elif num in MAILLONS_IDEMPOTENTS:
        nouvelle = IDEM_79.format(num=num)
    elif num == "71":
        nouvelle = NORME_71
    else:
        nouvelle = NORME_79
    texte = texte[: m.start()] + nouvelle + texte[m.end():]
    with open(complet, "w", encoding="utf-8") as f:
        f.write(texte)
    print(f"OK {chemin} : ATTENDU 272 -> 274")

# --- 2. Contrôles de version des maillons 74-78 : 0.2.8 -> 0.2.9 ---
REALIGNEMENTS = {
    "scripts/update_zip_task74.py": [
        (
            'check("package.json : version 0.2.8 (MODIFIÉ Task 78)", \'"version": "0.2.8"\' in pkg, pkg[:80])',
            'check("package.json : version 0.2.9 (MODIFIÉ Task 79)", \'"version": "0.2.9"\' in pkg, pkg[:80])',
        )
    ],
    "scripts/update_zip_task75.py": [
        (
            'check("package.json : version 0.2.8 (MODIFIÉ Task 78)", \'"version": "0.2.8"\' in pkg, pkg[:80])',
            'check("package.json : version 0.2.9 (MODIFIÉ Task 79)", \'"version": "0.2.9"\' in pkg, pkg[:80])',
        )
    ],
    "scripts/update_zip_task76.py": [
        (
            'check("package.json : version 0.2.8 (MODIFIÉ Task 78)", \'"version": "0.2.8"\' in pkg, pkg[:80])',
            'check("package.json : version 0.2.9 (MODIFIÉ Task 79)", \'"version": "0.2.9"\' in pkg, pkg[:80])',
        )
    ],
    "scripts/update_zip_task77.py": [
        (
            'check("test76 réaligné (version 0.2.8, MODIFIÉ Task 78)", \'"0.2.8"\' in t76)',
            'check("test76 réaligné (version 0.2.9, MODIFIÉ Task 79)", \'"0.2.9"\' in t76)',
        ),
        (
            'check("package.json : version 0.2.8 (MODIFIÉ Task 78)", \'"version": "0.2.8"\' in pkg, pkg[:80])',
            'check("package.json : version 0.2.9 (MODIFIÉ Task 79)", \'"version": "0.2.9"\' in pkg, pkg[:80])',
        ),
    ],
    "scripts/update_zip_task78.py": [
        (
            'check("test74 réaligné Task 78 (payload otpauth + version 0.2.8)",\n          "RÉALIGNÉ Task 78" in t74 and "0.2.8" in t74)',
            'check("test74 réaligné Task 79 (payload otpauth + version 0.2.9)",\n          "RÉALIGNÉ Task 78" in t74 and "0.2.9" in t74)',
        ),
        (
            'check("test75 réaligné Task 78 (creerDefiOtp à 4 arguments + version 0.2.8)",\n          "4 arguments" in t75 and "0.2.8" in t75)',
            'check("test75 réaligné Task 79 (creerDefiOtp à 4 arguments + version 0.2.9)",\n          "4 arguments" in t75 and "0.2.9" in t75)',
        ),
        (
            'check("test76 réaligné Task 78 (payload otpauth + otpHtml(defi) + version 0.2.8)",\n          "RÉALIGNÉ Task 78" in t76 and "function otpHtml(defi, svgQr)" in t76\n          and \'"0.2.8"\' in t76)',
            'check("test76 réaligné Task 79 (payload otpauth + otpHtml(defi) + version 0.2.9)",\n          "RÉALIGNÉ Task 78" in t76 and "function otpHtml(defi, svgQr)" in t76\n          and \'"0.2.9"\' in t76)',
        ),
        (
            'check("package.json : version 0.2.8", \'"version": "0.2.8"\' in pkg, pkg[:80])',
            'check("package.json : version 0.2.9", \'"version": "0.2.9"\' in pkg, pkg[:80])',
        ),
    ],
}

for chemin, paires in REALIGNEMENTS.items():
    complet = os.path.join(BASE, chemin)
    with open(complet, encoding="utf-8") as f:
        texte = f.read()
    for ancien, nouveau in paires:
        if ancien in texte:
            texte = texte.replace(ancien, nouveau)
            print(f"OK {chemin} : contrôle de version réaligné 0.2.8 -> 0.2.9")
        elif nouveau in texte:
            print(f"SKIPPED {chemin} : contrôle déjà à 0.2.9")
        else:
            print(f"ANOMALIE {chemin} : contrôle introuvable -> {ancien[:70]}…")
    with open(complet, "w", encoding="utf-8") as f:
        f.write(texte)

print("PATCH ATTENDU + VERSIONS TASK 79 TERMINÉ")
