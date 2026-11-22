#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 71 — mise en cohérence des ATTENDU de la chaîne ZIP et des suites
task40/task42 : 257 fichiers (état Task 70) -> 259 fichiers (état Task 71 =
+ scripts/test71_tableau_auto.py + scripts/test71_harnais.sh). Les maillons
intermédiaires restent idempotents : chaque étape porte l'état FINAL.
Idempotent : relançable sans effet si déjà appliqué.
"""
import os

BASE = "/home/z/my-project"
PATCHES = {
    "scripts/update_zip_task38.py": [
        (
            "ATTENDU = 257  # (MODIFIÉ Task 70) chaîne idempotente : l'archive courante porte l'état FINAL Task 70 (257 fichiers) à toutes les étapes — étapes intermédiaires 38/40/42 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter",
            "ATTENDU = 259  # (MODIFIÉ Task 71) chaîne idempotente : l'archive courante porte l'état FINAL Task 71 (259 fichiers) à toutes les étapes — étapes intermédiaires 38/40/42 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter",
        ),
    ],
    "scripts/update_zip_task64.py": [
        (
            "ATTENDU = 257  # (MODIFIÉ Task 70) chaîne idempotente : l'archive courante porte l'état FINAL Task 70 (257 fichiers) à toutes les étapes — maillon 64 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter",
            "ATTENDU = 259  # (MODIFIÉ Task 71) chaîne idempotente : l'archive courante porte l'état FINAL Task 71 (259 fichiers) à toutes les étapes — maillon 64 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter",
        ),
    ],
    "scripts/update_zip_task65.py": [
        (
            "ATTENDU = 257  # (MODIFIÉ Task 70) chaîne idempotente : l'archive courante porte l'état FINAL Task 70 (257 fichiers) à toutes les étapes — maillon 65 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter",
            "ATTENDU = 259  # (MODIFIÉ Task 71) chaîne idempotente : l'archive courante porte l'état FINAL Task 71 (259 fichiers) à toutes les étapes — maillon 65 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter",
        ),
    ],
    "scripts/update_zip_task66.py": [
        (
            "ATTENDU = 257  # (MODIFIÉ Task 70) chaîne idempotente : l'archive courante porte l'état FINAL Task 70 (257 fichiers) à toutes les étapes — maillon 66 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter",
            "ATTENDU = 259  # (MODIFIÉ Task 71) chaîne idempotente : l'archive courante porte l'état FINAL Task 71 (259 fichiers) à toutes les étapes — maillon 66 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter",
        ),
    ],
    "scripts/update_zip_task67.py": [
        (
            "ATTENDU = 257  # (MODIFIÉ Task 70) chaîne idempotente : l'archive courante porte l'état FINAL Task 70 (257 fichiers) à toutes les étapes — maillon 67 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter",
            "ATTENDU = 259  # (MODIFIÉ Task 71) chaîne idempotente : l'archive courante porte l'état FINAL Task 71 (259 fichiers) à toutes les étapes — maillon 67 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter",
        ),
    ],
    "scripts/update_zip_task69.py": [
        (
            "ATTENDU = 257  # (MODIFIÉ Task 70) chaîne idempotente : l'archive courante porte l'état FINAL Task 70 (257 fichiers) à toutes les étapes — maillon 69 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter",
            "ATTENDU = 259  # (MODIFIÉ Task 71) chaîne idempotente : l'archive courante porte l'état FINAL Task 71 (259 fichiers) à toutes les étapes — maillon 69 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter",
        ),
    ],
    "scripts/update_zip_task70.py": [
        (
            "ATTENDU = 257  # 255 (état Task 69) + 2 nouveaux fichiers",
            "ATTENDU = 259  # (MODIFIÉ Task 71) 257 (état Task 70) + 2 nouveaux fichiers Task 71",
        ),
    ],
    "scripts/test_task40_securisation_auto.py": [
        (
            "ATTENDU = 257  # (MODIFIÉ Task 70) 255 (état Task 69) + 2 nouveaux fichiers Task 70",
            "ATTENDU = 259  # (MODIFIÉ Task 71) 257 (état Task 70) + 2 nouveaux fichiers Task 71",
        ),
    ],
    "scripts/test_task42_demarrage_unique.py": [
        (
            "ATTENDU = 257  # (MODIFIÉ Task 70) 255 (état Task 69) + 2 nouveaux fichiers Task 70",
            "ATTENDU = 259  # (MODIFIÉ Task 71) 257 (état Task 70) + 2 nouveaux fichiers Task 71",
        ),
    ],
}

for relatif, remplacements in PATCHES.items():
    chemin = os.path.join(BASE, relatif)
    texte = open(chemin, encoding="utf-8").read()
    original = texte
    for ancien, nouveau in remplacements:
        if nouveau in texte:
            continue  # déjà appliqué (idempotence)
        if ancien not in texte:
            print(f"ATTENTION : motif introuvable dans {relatif} :")
            print(f"   {ancien[:90]}…")
            continue
        texte = texte.replace(ancien, nouveau, 1)
    if texte != original:
        open(chemin, "w", encoding="utf-8").write(texte)
        print(f"PATCHÉ : {relatif}")
    else:
        print(f"INCHANGÉ : {relatif}")

print("\nVérification finale :")
for relatif in PATCHES:
    texte = open(os.path.join(BASE, relatif), encoding="utf-8").read()
    etat = "OK 259" if "ATTENDU = 259" in texte else ("déjà OK" if "ATTENDU = 259" in texte else "PAS ENCORE")
    reste_257 = "ATTENDU = 257" in texte
    print(f"  {relatif} : ATTENDU 259 = {'présent' if 'ATTENDU = 259' in texte else 'ABSENT'}, 257 résiduel = {'OUI!' if reste_257 else 'non'}")
