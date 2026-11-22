#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Génère un PDF de paie volumineux (400 pages) pour tester la taille illimitée."""
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4

PATH = "/home/z/my-project/test-data/payslips/Gros_Fichier_Test_5000pages.pdf"
PAGES = 5000

c = canvas.Canvas(PATH, pagesize=A4)
w, h = A4
for i in range(PAGES):
    if i == 0:
        # Page 1 = vraie fiche de paie avec CIN
        c.setFont("Helvetica-Bold", 14)
        c.drawString(50, h - 80, "SOCIETE TUNISIENNE DE DEVELOPPEMENT SARL")
        c.drawRightString(w - 50, h - 80, "BULLETIN DE PAIE")
        c.drawRightString(w - 50, h - 100, "Periode : Mars 2025")
        c.setFont("Helvetica", 10)
        c.drawString(50, h - 140, "Matricule : EMP005")
        c.drawString(50, h - 160, "Nom et Prenom : HAMDI Yassine")
        c.drawString(50, h - 180, "C.I.N : 09876543")
        c.drawString(50, h - 200, "Fonction : Ingenieur")
        c.setFont("Helvetica-Bold", 11)
        c.drawString(50, h - 260, "NET A PAYER : 3 200,000 DT")
    c.setFont("Helvetica", 8)
    # Contenu dense par page pour atteindre un vrai volume mémoire
    for line in range(60):
        c.drawString(50, h - 40 - line * 12,
                     f"Annexe {i + 1}/{PAGES} ligne {line}: Historique des rubriques de paie, "
                     f"bases de cotisation 1234567890.12, taux 9.18%, plafond 45678.90 DT, "
                     f"reference reglementaire article 12-3 convention collective interprofessionnelle")
    c.drawString(50, 50, f"Annexe fiche de paie - page {i + 1}/{PAGES} - document genere par Sage paie")
    c.showPage()
c.save()

import os
size_mb = os.path.getsize(PATH) / (1024 * 1024)
print(f"OK {PATH} — {size_mb:.2f} Mo, {PAGES} pages")
