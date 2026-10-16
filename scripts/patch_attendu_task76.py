#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 76 — mise en cohérence des ATTENDU de la chaîne ZIP et des suites
task40/task42 : 266 fichiers (état Task 75) -> 268 fichiers (état Task 76 =
+ scripts/test76_otp_qr_chaque_connexion.py + scripts/test76_harnais.sh).
Les maillons intermédiaires restent idempotents : chaque étape porte l'état
FINAL. Idempotent : relançable sans effet si déjà appliqué.
"""
import os

BASE = "/home/z/my-project"
IDEMPOTENTE_TPL = (
    "ATTENDU = 268  # (MODIFIÉ Task 76) chaîne idempotente : l'archive courante "
    "porte l'état FINAL Task 76 (268 fichiers) à toutes les étapes — maillon "
    "{num} ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter"
)
STANDARD = "ATTENDU = 268  # (MODIFIÉ Task 76) 266 (état Task 75) + 2 nouveaux fichiers Task 76"

# (fichier, ligne actuelle attendue, nouvelle ligne)
PATCHES = {
    "scripts/update_zip_task38.py": [
        (
            "ATTENDU = 266  # (MODIFIÉ Task 75) chaîne idempotente : l'archive courante porte l'état FINAL Task 75 (266 fichiers) à toutes les étapes — étapes intermédiaires 38/40/42 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter",
            "ATTENDU = 268  # (MODIFIÉ Task 76) chaîne idempotente : l'archive courante porte l'état FINAL Task 76 (268 fichiers) à toutes les étapes — étapes intermédiaires 38/40/42 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter",
        ),
    ],
    "scripts/update_zip_task64.py": [
        (
            "ATTENDU = 266  # (MODIFIÉ Task 75) chaîne idempotente : l'archive courante porte l'état FINAL Task 75 (266 fichiers) à toutes les étapes — maillon 64 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter",
            IDEMPOTENTE_TPL.format(num=64),
        ),
    ],
    "scripts/update_zip_task65.py": [
        (
            "ATTENDU = 266  # (MODIFIÉ Task 75) chaîne idempotente : l'archive courante porte l'état FINAL Task 75 (266 fichiers) à toutes les étapes — maillon 65 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter",
            IDEMPOTENTE_TPL.format(num=65),
        ),
    ],
    "scripts/update_zip_task66.py": [
        (
            "ATTENDU = 266  # (MODIFIÉ Task 75) chaîne idempotente : l'archive courante porte l'état FINAL Task 75 (266 fichiers) à toutes les étapes — maillon 66 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter",
            IDEMPOTENTE_TPL.format(num=66),
        ),
    ],
    "scripts/update_zip_task67.py": [
        (
            "ATTENDU = 266  # (MODIFIÉ Task 75) chaîne idempotente : l'archive courante porte l'état FINAL Task 75 (266 fichiers) à toutes les étapes — maillon 67 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter",
            IDEMPOTENTE_TPL.format(num=67),
        ),
    ],
    "scripts/update_zip_task69.py": [
        (
            "ATTENDU = 266  # (MODIFIÉ Task 75) chaîne idempotente : l'archive courante porte l'état FINAL Task 75 (266 fichiers) à toutes les étapes — maillon 69 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter",
            IDEMPOTENTE_TPL.format(num=69),
        ),
    ],
    "scripts/update_zip_task70.py": [
        (
            "ATTENDU = 266  # (MODIFIÉ Task 75) 263 (état Task 74) + 3 nouveaux fichiers Task 75",
            STANDARD,
        ),
    ],
    "scripts/update_zip_task71.py": [
        (
            "ATTENDU = 266  # (MODIFIÉ Task 75) 263 (état Task 74) + 3 nouveaux fichiers Task 75 — chaîne idempotente : l'état FINAL est porté à chaque étape",
            "ATTENDU = 268  # (MODIFIÉ Task 76) 266 (état Task 75) + 2 nouveaux fichiers Task 76 — chaîne idempotente : l'état FINAL est porté à chaque étape",
        ),
    ],
    "scripts/update_zip_task73.py": [
        (
            "ATTENDU = 266  # (MODIFIÉ Task 75) 263 (état Task 74) + 3 nouveaux fichiers Task 75",
            STANDARD,
        ),
    ],
    "scripts/update_zip_task74.py": [
        (
            "ATTENDU = 266  # (MODIFIÉ Task 75) 263 (état Task 74) + 3 nouveaux fichiers Task 75",
            STANDARD,
        ),
    ],
    "scripts/update_zip_task75.py": [
        (
            "ATTENDU = 266  # (MODIFIÉ Task 75) 263 (état Task 74) + 3 nouveaux fichiers Task 75",
            STANDARD,
        ),
    ],
    "scripts/test_task40_securisation_auto.py": [
        (
            "ATTENDU = 266  # (MODIFIÉ Task 75) 263 (état Task 74) + 3 nouveaux fichiers Task 75",
            STANDARD,
        ),
    ],
    "scripts/test_task42_demarrage_unique.py": [
        (
            "ATTENDU = 266  # (MODIFIÉ Task 75) 263 (état Task 74) + 3 nouveaux fichiers Task 75",
            STANDARD,
        ),
    ],
}

for chemin, remplacements in PATCHES.items():
    complet = os.path.join(BASE, chemin)
    with open(complet, encoding="utf-8") as f:
        texte = f.read()
    origine = texte
    for ancien, nouveau in remplacements:
        if nouveau in texte and ancien not in texte:
            continue  # déjà appliqué
        if ancien not in texte:
            print(f"ANOMALIE {chemin} : ligne attendue introuvable :\n  {ancien[:90]}…")
            continue
        texte = texte.replace(ancien, nouveau)
    if texte != origine:
        with open(complet, "w", encoding="utf-8") as f:
            f.write(texte)
        print(f"OK {chemin} : ATTENDU 266 -> 268")
    else:
        print(f"SKIPPED {chemin} (déjà à 268 ou introuvable)")

print("PATCH ATTENDU TASK 76 TERMINÉ")
