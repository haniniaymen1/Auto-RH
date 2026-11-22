#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Génère des fiches de paie PDF de test (style Sage) pour valider le site.
IMPORTANT : les noms de fichiers NE contiennent PAS le CIN —
le CIN figure uniquement DANS LE CONTENU du PDF (comme un vrai export Sage).
"""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

OUT_DIR = "/home/z/my-project/test-data/payslips"
os.makedirs(OUT_DIR, exist_ok=True)

EMPLOYEES = [
    {
        "file": "Fiche_Paie_01_2025_EMP001.pdf",
        "matricule": "EMP001",
        "nom": "BEN ALI Mohamed",
        "cin": "09123456",
        "periode": "Janvier 2025",
        "base": 1850.000,
        "prime": 250.000,
        "cnss": 271.225,
        "irpp": 214.500,
    },
    {
        "file": "Fiche_Paie_02_2025_EMP001.pdf",
        "matricule": "EMP001",
        "nom": "BEN ALI Mohamed",
        "cin": "09123456",
        "periode": "Février 2025",
        "base": 1850.000,
        "prime": 180.000,
        "cnss": 263.425,
        "irpp": 206.100,
    },
    {
        "file": "Fiche_Paie_01_2025_EMP002.pdf",
        "matricule": "EMP002",
        "nom": "TRABELSI Amira",
        "cin": "04567890",
        "periode": "Janvier 2025",
        "base": 2400.000,
        "prime": 400.000,
        "cnss": 366.000,
        "irpp": 312.750,
    },
    {
        "file": "Fiche_Paie_01_2025_EMP003.pdf",
        "matricule": "EMP003",
        "nom": "EL GHARBI Karim",
        "cin": "A123456",
        "periode": "Janvier 2025",
        "base": 1500.000,
        "prime": 120.000,
        "cnss": 219.600,
        "irpp": 148.900,
    },
    {
        "file": "Bulletin_Salaire_EMP004.pdf",
        "matricule": "EMP004",
        "nom": "JAZIRI Salma",
        "cin": "11223344",
        "periode": "Janvier 2025",
        "base": 2100.000,
        "prime": 300.000,
        "cnss": 325.500,
        "irpp": 268.400,
    },
]


def fmt(v: float) -> str:
    s = f"{v:,.3f}".replace(",", " ").replace(".", ",")
    return s


def draw_payslip(emp: dict, path: str):
    c = canvas.Canvas(path, pagesize=A4)
    w, h = A4
    x0 = 20 * mm
    y = h - 25 * mm

    # En-tête société (style Sage)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(x0, y, "SOCIETE TUNISIENNE DE DEVELOPPEMENT SARL")
    c.setFont("Helvetica", 9)
    c.drawString(x0, y - 5 * mm, "Adresse : 12 Rue de la Republique, 1001 Tunis")
    c.drawString(x0, y - 10 * mm, "Matricule fiscal : 1234567/A/M/000")
    c.drawRightString(w - x0, y, "BULLETIN DE PAIE")
    c.drawRightString(w - x0, y - 5 * mm, f"Periode : {emp['periode']}")

    y -= 22 * mm
    c.setFont("Helvetica", 10)
    c.drawString(x0, y, f"Matricule : {emp['matricule']}")
    c.drawString(x0, y - 6 * mm, f"Nom et Prenom : {emp['nom']}")
    c.drawString(x0, y - 12 * mm, f"C.I.N : {emp['cin']}")
    c.drawString(x0, y - 18 * mm, "Fonction : Technicien")
    c.drawString(x0, y - 24 * mm, "Situation familiale : Marie")
    c.drawRightString(w - x0, y, f"N° Securite Sociale : 01{emp['cin'][:2]}0{emp['matricule'][-3:]}")
    c.drawRightString(w - x0, y - 6 * mm, "Convention : Convention collective")

    # Tableau des rubriques
    y -= 34 * mm
    c.setFont("Helvetica-Bold", 9)
    c.rect(x0, y - 40 * mm, w - 2 * x0, 46 * mm)
    c.line(x0, y, w - x0, y)
    c.line(x0 + 70 * mm, y, x0 + 70 * mm, y - 40 * mm)
    c.line(x0 + 110 * mm, y, x0 + 110 * mm, y - 40 * mm)
    c.line(x0 + 135 * mm, y, x0 + 135 * mm, y - 40 * mm)

    def row(yy, label, base, primo, ret):
        c.setFont("Helvetica", 9)
        c.drawString(x0 + 2 * mm, yy, label)
        c.drawRightString(x0 + 108 * mm, yy, base)
        c.drawRightString(x0 + 133 * mm, yy, primo)
        c.drawRightString(w - x0 - 2 * mm, yy, ret)

    yy = y - 6 * mm
    c.drawString(x0 + 2 * mm, yy, "Rubrique")
    c.drawRightString(x0 + 108 * mm, yy, "Salaire")
    c.drawRightString(x0 + 133 * mm, yy, "Primes")
    c.drawRightString(w - x0 - 2 * mm, yy, "Retenues")

    net = emp["base"] + emp["prime"] - emp["cnss"] - emp["irpp"]
    yy -= 7 * mm
    row(yy, "Salaire de base", fmt(emp["base"]), "0,000", "0,000")
    yy -= 7 * mm
    row(yy, "Prime de rendement", "0,000", fmt(emp["prime"]), "0,000")
    yy -= 7 * mm
    row(yy, "CNSS (6,68%)", "0,000", "0,000", fmt(emp["cnss"]))
    yy -= 7 * mm
    row(yy, "Impot sur le revenu (IRPP)", "0,000", "0,000", fmt(emp["irpp"]))

    # Net à payer
    y = y - 40 * mm - 12 * mm
    c.setFont("Helvetica-Bold", 11)
    c.drawString(x0, y, f"NET A PAYER : {fmt(net)} DT")
    c.setFont("Helvetica", 8)
    c.drawString(x0, y - 8 * mm, f"Arrete la presente somme a : {fmt(net)} Dinars")
    c.drawString(x0, y - 16 * mm, "Document genere par Sage paie - paie & RH")

    c.showPage()
    c.save()


for emp in EMPLOYEES:
    path = os.path.join(OUT_DIR, emp["file"])
    draw_payslip(emp, path)
    print(f"OK  {emp['file']}  (CIN={emp['cin']} dans le contenu uniquement)")

print("\nTermine :", OUT_DIR)
