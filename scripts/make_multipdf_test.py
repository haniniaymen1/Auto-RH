#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Crée 2 PDF de test pour la gestion multi-fiches :
  1. fiches_regroupees_test.pdf  : 3 fiches (3 CIN différents) dans UN seul PDF
  2. fiche_avec_annexes_test.pdf : 1 fiche (page 1) + 2 pages annexe sans CIN
"""
from pypdf import PdfWriter, PdfReader
import os

SRC = "/home/z/my-project/upload"
OUT = "/home/z/my-project/upload"

# 1) PDF multi-fiches : 3 CIN différents (3 employés différents)
parts = [
    f"{SRC}/user_slips/fiche_de_paie_01.pdf",      # CIN 07451236 — Amine Ben Ali
    f"{SRC}/new_slips/fiche_paie_01_specimen.pdf", # CIN DEMO001234 — Amine Ben Salem
    f"{SRC}/new_slips/fiche_paie_02_specimen.pdf", # CIN DEMO123456 — Sarra Trabelsi
]
w = PdfWriter()
for p in parts:
    r = PdfReader(p)
    for pg in r.pages:
        w.add_page(pg)
out1 = os.path.join(OUT, "fiches_regroupees_test.pdf")
with open(out1, "wb") as f:
    w.write(f)
print("OK", out1, f"{os.path.getsize(out1)/1024:.1f} Ko, {len(w.pages)} pages")

# 2) fiche unique + annexes (1 seul CIN au total → doit rester 1 enregistrement)
w2 = PdfWriter()
r1 = PdfReader(f"{SRC}/user_slips/fiche_de_paie_05.pdf")  # CIN 07451236
for pg in r1.pages:
    w2.add_page(pg)
# annexes : pages tirées d'autres fiches MAIS... elles contiendraient un CIN !
# → on utilise plutôt des pages générées sans CIN : copie de page 2 d'un gros PDF
# n'existe pas ici ; on duplique la page de la fiche SANS son CIN impossible avec pypdf.
# Solution : créer une page annexe texte simple via reportlab.
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
annexe = "/tmp/annexe_sans_cin.pdf"
c = canvas.Canvas(annexe, pagesize=A4)
w_, h_ = A4
for i in range(2):
    c.setFont("Helvetica", 9)
    for line in range(30):
        c.drawString(50, h_ - 60 - line * 14,
                     f"Annexe continuite de bulletin - ligne {line+1} - historique des rubriques "
                     f"et bases de cotisation, reference reglementaire article 12-3.")
    c.showPage()
c.save()
r_ann = PdfReader(annexe)
for pg in r_ann.pages:
    w2.add_page(pg)
out2 = os.path.join(OUT, "fiche_avec_annexes_test.pdf")
with open(out2, "wb") as f:
    w2.write(f)
print("OK", out2, f"{os.path.getsize(out2)/1024:.1f} Ko, {len(w2.pages)} pages (1 fiche + 2 annexes)")
