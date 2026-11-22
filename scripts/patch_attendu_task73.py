#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 73 — mise en cohérence des ATTENDU de la chaîne ZIP et des suites
task40/task42 : 259 fichiers (état Task 71) -> 261 fichiers (état Task 73 =
+ scripts/test73_recherche_bouton.py + scripts/test73_harnais.sh). Les
maillons intermédiaires restent idempotents : chaque étape porte l'état FINAL.
Idempotent : relançable sans effet si déjà appliqué.
"""
import os

BASE = "/home/z/my-project"
IDEMPOTENTE_TPL = (
    "ATTENDU = 261  # (MODIFIÉ Task 73) chaîne idempotente : l'archive courante "
    "porte l'état FINAL Task 73 (261 fichiers) à toutes les étapes — maillon "
    "{num} ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter"
)

PATCHES = {
    "scripts/update_zip_task38.py": [
        (
            "ATTENDU = 259  # (MODIFIÉ Task 71) chaîne idempotente : l'archive courante porte l'état FINAL Task 71 (259 fichiers) à toutes les étapes — étapes intermédiaires 38/40/42 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter",
            "ATTENDU = 261  # (MODIFIÉ Task 73) chaîne idempotente : l'archive courante porte l'état FINAL Task 73 (261 fichiers) à toutes les étapes — étapes intermédiaires 38/40/42 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter",
        ),
    ],
    "scripts/update_zip_task64.py": [
        (
            "ATTENDU = 259  # (MODIFIÉ Task 71) chaîne idempotente : l'archive courante porte l'état FINAL Task 71 (259 fichiers) à toutes les étapes — maillon 64 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter",
            IDEMPOTENTE_TPL.format(num=64),
        ),
    ],
    "scripts/update_zip_task65.py": [
        (
            "ATTENDU = 259  # (MODIFIÉ Task 71) chaîne idempotente : l'archive courante porte l'état FINAL Task 71 (259 fichiers) à toutes les étapes — maillon 65 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter",
            IDEMPOTENTE_TPL.format(num=65),
        ),
    ],
    "scripts/update_zip_task66.py": [
        (
            "ATTENDU = 259  # (MODIFIÉ Task 71) chaîne idempotente : l'archive courante porte l'état FINAL Task 71 (259 fichiers) à toutes les étapes — maillon 66 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter",
            IDEMPOTENTE_TPL.format(num=66),
        ),
    ],
    "scripts/update_zip_task67.py": [
        (
            "ATTENDU = 259  # (MODIFIÉ Task 71) chaîne idempotente : l'archive courante porte l'état FINAL Task 71 (259 fichiers) à toutes les étapes — maillon 67 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter",
            IDEMPOTENTE_TPL.format(num=67),
        ),
    ],
    "scripts/update_zip_task69.py": [
        (
            "ATTENDU = 259  # (MODIFIÉ Task 71) chaîne idempotente : l'archive courante porte l'état FINAL Task 71 (259 fichiers) à toutes les étapes — maillon 69 ne fait que REMPLACER/CONSERVER ses fichiers, sans en ajouter",
            IDEMPOTENTE_TPL.format(num=69),
        ),
    ],
    "scripts/update_zip_task70.py": [
        (
            "ATTENDU = 259  # (MODIFIÉ Task 71) 257 (état Task 70) + 2 nouveaux fichiers Task 71",
            "ATTENDU = 261  # (MODIFIÉ Task 73) 259 (état Task 71) + 2 nouveaux fichiers Task 73",
        ),
    ],
    "scripts/update_zip_task71.py": [
        (
            "ATTENDU = 259  # 257 (état Task 70) + 2 nouveaux fichiers",
            "ATTENDU = 261  # 259 (état Task 71) + 2 nouveaux fichiers Task 73",
        ),
    ],
    "scripts/test_task40_securisation_auto.py": [
        (
            "ATTENDU = 259  # (MODIFIÉ Task 71) 257 (état Task 70) + 2 nouveaux fichiers Task 71",
            "ATTENDU = 261  # (MODIFIÉ Task 73) 259 (état Task 71) + 2 nouveaux fichiers Task 73",
        ),
    ],
    "scripts/test_task42_demarrage_unique.py": [
        (
            "ATTENDU = 259  # (MODIFIÉ Task 71) 257 (état Task 70) + 2 nouveaux fichiers Task 71",
            "ATTENDU = 261  # (MODIFIÉ Task 73) 259 (état Task 71) + 2 nouveaux fichiers Task 73",
        ),
    ],
}

ok = True
for chemin, paires in PATCHES.items():
    complet = os.path.join(BASE, chemin)
    try:
        texte = open(complet, encoding="utf-8").read()
    except FileNotFoundError:
        print(f"MANQUANT : {chemin}")
        ok = False
        continue
    if "ATTENDU = 261" in texte:
        print(f"DÉJÀ EN COHÉRENCE : {chemin}")
        continue
    applique = False
    for ancien, nouveau in paires:
        if ancien in texte:
            texte = texte.replace(ancien, nouveau)
            applique = True
    if not applique:
        print(f"ANCRAGE INTROUVABLE dans {chemin} — vérifiez manuellement")
        ok = False
        continue
    open(complet, "w", encoding="utf-8").write(texte)
    print(f"PATCHÉ 259 -> 261 : {chemin}")

# Vérification finale : aucun ATTENDU = 259 actif ne doit rester
for chemin in PATCHES:
    texte = open(os.path.join(BASE, chemin), encoding="utf-8").read()
    for ligne in texte.splitlines():
        if ligne.startswith("ATTENDU = ") and "261" not in ligne:
            print(f"RESTE OBSOLÈTE dans {chemin} : {ligne.strip()}")
            ok = False

print("PATCH ATTENDU TASK73 :", "TOUT OK" if ok else "PROBLÈME DÉTECTÉ")
raise SystemExit(0 if ok else 1)
