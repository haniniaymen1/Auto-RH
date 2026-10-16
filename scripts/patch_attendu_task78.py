#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 78 — mise en cohérence des ATTENDU de la chaîne ZIP et des suites
task40/task42 : 270 fichiers (état Task 77) -> 272 fichiers (état Task 78 =
+ scripts/test78_totp_authenticator.py + scripts/test78_harnais.sh).
Les maillons intermédiaires restent idempotents : chaque étape porte l'état
FINAL. Idempotent : relançable sans effet si déjà appliqué.
"""
import os
import re

BASE = "/home/z/my-project"

MAILLONS_IDEMPOTENTS = {64: "64", 65: "65", 66: "66", 67: "67", 69: "69"}
MAILLONS_STANDARDS = [70, 71, 73, 74, 75, 76, 77]
SUITES_STATIQUES = [
    "scripts/test_task40_securisation_auto.py",
    "scripts/test_task42_demarrage_unique.py",
]

NORME_78 = "ATTENDU = 272  # (MODIFIÉ Task 78) 270 (état Task 77) + 2 nouveaux fichiers Task 78"
IDEM_78 = (
    "ATTENDU = 272  # (MODIFIÉ Task 78) chaîne idempotente : l'archive courante "
    "porte l'état FINAL Task 78 (272 fichiers) à toutes les étapes — maillon "
    "{num} ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter"
)
IDEM_38 = (
    "ATTENDU = 272  # (MODIFIÉ Task 78) chaîne idempotente : l'archive courante "
    "porte l'état FINAL Task 78 (272 fichiers) à toutes les étapes — étapes "
    "intermédiaires 38/40/42 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter"
)
NORME_71 = NORME_78 + " — chaîne idempotente : l'état FINAL est porté à chaque étape"

FICHIERS = (
    [f"scripts/update_zip_task{num}.py" for num in MAILLONS_IDEMPOTENTS]
    + [f"scripts/update_zip_task{num}.py" for num in MAILLONS_STANDARDS]
    + ["scripts/update_zip_task38.py"]
    + SUITES_STATIQUES
)

for chemin in FICHIERS:
    complet = os.path.join(BASE, chemin)
    with open(complet, encoding="utf-8") as f:
        texte = f.read()
    m = re.search(r"^ATTENDU = (\d+).*$", texte, re.M)
    if not m:
        print(f"ANOMALIE {chemin} : aucune ligne ATTENDU")
        continue
    if m.group(1) == "272":
        print(f"SKIPPED {chemin} (déjà à 272)")
        continue
    if m.group(1) != "270":
        print(f"ANOMALIE {chemin} : ATTENDU inattendu = {m.group(1)}")
        continue
    num = chemin.split("update_zip_task")[-1].replace(".py", "") if "update_zip_task" in chemin else ""
    if "task38" in chemin:
        nouvelle = IDEM_38
    elif num in MAILLONS_IDEMPOTENTS:
        nouvelle = IDEM_78.format(num=num)
    elif num == "71":
        nouvelle = NORME_71
    else:
        nouvelle = NORME_78
    texte = texte[: m.start()] + nouvelle + texte[m.end():]
    with open(complet, "w", encoding="utf-8") as f:
        f.write(texte)
    print(f"OK {chemin} : ATTENDU 270 -> 272")

print("PATCH ATTENDU TASK 78 TERMINÉ")
