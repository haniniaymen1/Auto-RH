#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 212 — renommage de marque DANS les classeurs matrice + map (openpyxl)
puis renommage des fichiers Auto-RH-*.xlsx → AutoRH-*.xlsx (v0.2.95 / v0.2.94)."""

import os, zipfile, re

BASE = "/home/z/my-project/download/"

paires = [
    ("Auto-RH-Matrice-roles-utilisateurs-v0.2.95.xlsx", "AutoRH-Matrice-roles-utilisateurs-v0.2.95.xlsx"),
    ("Auto-RH-Map-routage-emails-demandes-v0.2.94.xlsx", "AutoRH-Map-routage-emails-demandes-v0.2.94.xlsx"),
]

# ---- 1) Contenu : comptage préalable (toutes parts xl/*.xml) ----------------
for anc, nou in paires:
    z = zipfile.ZipFile(BASE + anc)
    total = 0
    for nom in z.namelist():
        if nom.startswith("xl/") and nom.endswith(".xml"):
            total += z.read(nom).decode("utf-8", "ignore").count("Auto-RH")
            total += z.read(nom).decode("utf-8", "ignore").count("Auto-RH")
    z.close()
    print(f"{anc} : {total} occurrence(s) de marque")

# ---- 2) Édition openpyxl (valeurs de cellules uniquement) -------------------
from openpyxl import load_workbook

def parcours_valeurs(wb):
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                if isinstance(cell.value, str) and ("Auto-RH" in cell.value or "Auto-RH" in cell.value):
                    yield cell

for anc, nou in paires:
    wb = load_workbook(BASE + anc)
    n = 0
    for cell in parcours_valeurs(wb):
        cell.value = cell.value.replace("Auto-RH", "AutoRH").replace("Auto-RH", "AutoRH")
        n += 1
    wb.save(BASE + nou)
    os.remove(BASE + anc)
    print(f"{anc} → {nou} : {n} cellule(s) mise(s) à jour")

# ---- 3) Vérification post-édition -------------------------------------------
for anc, nou in paires:
    z = zipfile.ZipFile(BASE + nou)
    restant = 0
    for nom in z.namelist():
        if nom.startswith("xl/") and nom.endswith(".xml"):
            restant += z.read(nom).decode("utf-8", "ignore").count("Auto-RH")
            restant += z.read(nom).decode("utf-8", "ignore").count("Auto-RH")
    z.close()
    print(f"{nou} : restant {restant} (attendu 0 si tout est dans les cellules)")
print("OK")
