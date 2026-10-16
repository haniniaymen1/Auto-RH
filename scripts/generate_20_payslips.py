#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Génère 20 fiches de paie PDF de test (style Sage) avec :
  - 20 FORMES D'ÉCRITURE DIFFÉRENTES DU CIN (libellés, espaces, lettres, position...)
  - 20 FORMES DE DATES DIFFÉRENTES (jj/mm/aaaa, jj/mm/aa, ISO, mois littéral, etc.)
Règle : le CIN figure UNIQUEMENT DANS LE CONTENU du PDF, jamais dans le nom de fichier.
"""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

OUT_DIR = "/home/z/my-project/test-data/payslips"
os.makedirs(OUT_DIR, exist_ok=True)

# ----------------------------------------------------------------------------
# Matrice des 20 fiches
# ----------------------------------------------------------------------------
SLIPS = [
    # 1 — CIN classique « C.I.N : » / période littérale / paiement jj/mm/aaaa
    dict(i=1, file="Bulletin_Paie_01_Janvier2025.pdf", nom="BEN ALI Mohamed",
         fonction="Technicien", cin="09123456", cin_line="C.I.N : 09123456",
         periode=["Periode : Janvier 2025"], pay="Date de paiement : 05/02/2025",
         base=1850.0, prime=250.0, transport=80.0),
    # 2 — « CIN : » / période numérique MM/AAAA / paiement jj/mm/aaaa
    dict(i=2, file="Bulletin_Paie_02_Fevrier2025.pdf", nom="TRABELSI Amira",
         fonction="Comptable", cin="09876543", cin_line="CIN : 09876543",
         periode=["Periode : 02/2025"], pay="Payé le 07/03/2025",
         base=2400.0, prime=400.0, transport=90.0),
    # 3 — « CIN N° : » / MM/AAAA / paiement jj-mm-aaaa
    dict(i=3, file="Bulletin_Paie_03_Mars2026.pdf", nom="GHARBI Karim",
         fonction="Chef d'équipe", cin="04567890", cin_line="CIN N° : 04567890",
         periode=["Période : 03/2026"], pay="Émis le 10-04-2026",
         base=1500.0, prime=120.0, transport=70.0),
    # 4 — « N° CIN : » / MM/AAAA + dates complètes entre parenthèses / jj.mm.aaaa
    dict(i=4, file="Bulletin_Paie_04_Avril2026.pdf", nom="JAZIRI Salma",
         fonction="Assistante RH", cin="01112223", cin_line="N° CIN : 01112223",
         periode=["Periode : 04/2026 (du 01/04/2026 au 30/04/2026)"],
         pay="Paiement le 05.05.2026",
         base=2100.0, prime=300.0, transport=85.0),
    # 5 — « Cin : » (minuscule) / période jj/mm/AA / mois littéral / jj/mm/aa
    dict(i=5, file="Bulletin_Paie_05_Mai2026.pdf", nom="MANSOURI Hédi",
         fonction="Commercial", cin="02223334", cin_line="Cin : 02223334",
         periode=["Période : 01/05/26 au 31/05/26", "Mois : Mai 2026"],
         pay="Date paiement : 07/06/26",
         base=1750.0, prime=180.0, transport=75.0),
    # 6 — « C.I.N. N° » collé / mois littéral seul / jj/mm/aaaa
    dict(i=6, file="Bulletin_Paie_06_Juin2026.pdf", nom="CHAABANE Nadia",
         fonction="Juriste", cin="05556667", cin_line="C.I.N. N° 05556667",
         periode=["Mois : Juin 2026"], pay="Le 12/07/2026",
         base=2650.0, prime=350.0, transport=95.0),
    # 7 — libellé long « Carte d'identité nationale » / période ISO AAAA-MM / ISO AAAA-MM-JJ
    dict(i=7, file="Bulletin_Paie_07_Juillet2026.pdf", nom="BOUAZIZI Ali",
         fonction="Magasinier", cin="03334445", cin_line="Carte d'identité nationale n° 03334445",
         periode=["Periode : 2026-07"], pay="Payé le 2026-08-05",
         base=1300.0, prime=90.0, transport=60.0),
    # 8 — CIN AVEC ARTEFACT D'EXTRACTION (espace parasite « 0 8123456 ») + mention nette
    #     en pied de page / « Bulletin du » / jj/mm/aaaa
    dict(i=8, file="Bulletin_Paie_08_Aout2026.pdf", nom="DRIDI Samir",
         fonction="Développeur", cin="08123456", cin_line="C.I.N : 0 8123456",
         periode=["Bulletin du 01/08/2026", "Mois : Août 2026"],
         pay="Paiement : 10/09/2026",
         base=3100.0, prime=420.0, transport=100.0,
         declaration="Déclaration : le salarié, CIN n° 08123456, reconnaît avoir reçu son salaire."),
    # 9 — CIN avec préfixe lettre « A123456 » / période littérale / d/m/aaaa sans zéro
    dict(i=9, file="Bulletin_Paie_09_Septembre2026.pdf", nom="FERCHICHI Leila",
         fonction="Analyste financier", cin="A123456", cin_line="CIN : A123456",
         periode=["Periode : Septembre 2026"], pay="Émis le 1/10/2026",
         base=2200.0, prime=280.0, transport=85.0),
    # 10 — CIN avec préfixe lettre contigu « A654321 » / MM/AAAA / jj/mm/aaaa
    dict(i=10, file="Bulletin_Paie_10_Octobre2026.pdf", nom="GHANMI Youssef",
         fonction="Contrôleur de gestion", cin="A654321", cin_line="N° CIN : A654321",
         periode=["Periode : 10/2026"], pay="Date de paiement : 12/11/2026",
         base=2900.0, prime=380.0, transport=100.0),
    # 11 — préfixe lettre « B234567 » / « Date de paie » MM/AAAA / jj/mm/aaaa
    dict(i=11, file="Bulletin_Paie_11_Novembre2026.pdf", nom="HAMDI Rim",
         fonction="Chargée de communication", cin="B234567", cin_line="CIN : B234567",
         periode=["Date de paie : 11/2026"], pay="Payé le 15/12/2026",
         base=1600.0, prime=150.0, transport=70.0),
    # 12 — CIN EN DOUBLON (en-tête + déclaration en pied) / littéral / jj.mm.aaaa
    dict(i=12, file="Bulletin_Paie_12_Decembre2026.pdf", nom="IBRAHIM Sofiene",
         fonction="Ingénieur réseau", cin="06112233", cin_line="C.I.N : 06112233",
         periode=["Periode : Décembre 2026"], pay="Émis le 20.01.2027",
         base=2750.0, prime=320.0, transport=95.0,
         declaration="Déclaration : le salarié reconnaît avoir reçu son salaire, CIN n° 06112233."),
    # 13 — ANCIEN CIN À 7 CHIFFRES / période « du ... au ... » + mois / jj/mm/aaaa
    dict(i=13, file="Bulletin_Paie_13_Janvier2027.pdf", nom="JEDDI Mouna",
         fonction="Secrétaire de direction", cin="1234567", cin_line="C.I.N : 1234567",
         periode=["Periode du 01/01/2027 au 31/01/2027", "Mois : Janvier 2027"],
         pay="Paiement effectué le 10/02/2027",
         base=1450.0, prime=110.0, transport=65.0),
    # 14 — motif répété 07070707 / mois littéral / jj/mm/aaaa
    dict(i=14, file="Bulletin_Paie_14_Fevrier2027.pdf", nom="KAMMOUN Walid",
         fonction="Qualiticien", cin="07070707", cin_line="C.I.N : 07070707",
         periode=["Mois : Février 2027"], pay="Payé le 28/02/2027",
         base=1950.0, prime=230.0, transport=80.0),
    # 15 — « N° CIN : » / mois littéral / d/m/aaaa sans zéros
    dict(i=15, file="Bulletin_Paie_15_Mars2027.pdf", nom="LOUATI Hanen",
         fonction="Responsable achats", cin="04445556", cin_line="N° CIN : 04445556",
         periode=["Mois : Mars 2027"], pay="Date : 2/4/2027",
         base=2350.0, prime=360.0, transport=90.0),
    # 16 — classique / MM/AAAA / paiement jj/mm/AA (2 chiffres)
    dict(i=16, file="Bulletin_Paie_16_Avril2027.pdf", nom="MEZLINI Fares",
         fonction="Électromécanicien", cin="06667778", cin_line="C.I.N : 06667778",
         periode=["Periode : 04/2027"], pay="Payé le 05/05/27",
         base=1700.0, prime=160.0, transport=75.0),
    # 17 — CIN UNIQUEMENT EN PIED DE PAGE (déclaration) / littéral / jj-mm-aa
    dict(i=17, file="Bulletin_Paie_17_Mai2027.pdf", nom="NACCACHE Dorra",
         fonction="Auditrice interne", cin="07778889", cin_line=None,
         periode=["Période : Mai 2027"], pay="Émis le 06-06-27",
         base=2550.0, prime=300.0, transport=95.0,
         declaration="Déclaration : le présent bulletin est établi pour le salarié, C.I.N : 07778889."),
    # 18 — « C.I.N. : » / « du ... au ... » + mois / jj.mm.aa
    dict(i=18, file="Bulletin_Paie_18_Juin2027.pdf", nom="OUALI Bechir",
         fonction="Conducteur de travaux", cin="03445566", cin_line="C.I.N. : 03445566",
         periode=["Periode : du 01/06/2027 au 30/06/2027", "Mois : Juin 2027"],
         pay="Le 07.07.27",
         base=2050.0, prime=260.0, transport=85.0),
    # 19 — classique / mois littéral / paiement ISO AAAA-MM-JJ
    dict(i=19, file="Bulletin_Paie_19_Juillet2027.pdf", nom="ZOUARI Ines",
         fonction="Data analyst", cin="02233445", cin_line="CIN : 02233445",
         periode=["Mois : Juillet 2027"], pay="Payé le 2027-08-10",
         base=2250.0, prime=310.0, transport=85.0),
    # 20 — classique / AAAA-MM / paiement « 1er septembre 2027 » (littéral avec 1er)
    dict(i=20, file="Bulletin_Paie_20_Aout2027.pdf", nom="BEN SALAH Rachid",
         fonction="Agent de sécurité", cin="08889990", cin_line="C.I.N : 08889990",
         periode=["Periode : 2027-08"], pay="Paiement le 1er septembre 2027",
         base=1350.0, prime=100.0, transport=60.0),
]


def fmt(v: float) -> str:
    """Format tunisien : milliers avec espace, 3 décimales avec virgule."""
    return f"{v:,.3f}".replace(",", " ").replace(".", ",")


def draw_payslip(emp: dict, path: str):
    c = canvas.Canvas(path, pagesize=A4)
    w, h = A4
    x0 = 20 * mm
    y = h - 25 * mm

    # ---- En-tête société (style Sage) ----
    c.setFont("Helvetica-Bold", 14)
    c.drawString(x0, y, "SOCIETE TUNISIENNE DE DEVELOPPEMENT SARL")
    c.setFont("Helvetica", 9)
    c.drawString(x0, y - 5 * mm, "Adresse : 12 Rue de la Republique, 1001 Tunis")
    c.drawString(x0, y - 10 * mm, "Matricule fiscal : 1874325/A/M/000")
    c.drawRightString(w - x0, y, "BULLETIN DE PAIE")
    for k, line in enumerate(emp["periode"]):
        c.drawRightString(w - x0, y - (5 + 5 * k) * mm, line)

    # ---- Bloc employé ----
    y -= 22 * mm
    c.setFont("Helvetica", 10)
    c.drawString(x0, y, f"Matricule : MAT{emp['i']:04d}")
    c.drawString(x0, y - 6 * mm, f"Nom et Prénom : {emp['nom']}")
    if emp["cin_line"]:
        c.drawString(x0, y - 12 * mm, emp["cin_line"])
        c.drawString(x0, y - 18 * mm, f"Fonction : {emp['fonction']}")
        c.drawString(x0, y - 24 * mm, "Situation familiale : Marié(e)")
    else:
        c.drawString(x0, y - 12 * mm, f"Fonction : {emp['fonction']}")
        c.drawString(x0, y - 18 * mm, "Situation familiale : Marié(e)")
    c.drawRightString(w - x0, y, f"N° Sécurité Sociale : 0{emp['i']:02d} 88 77 66 55")
    c.drawRightString(w - x0, y - 6 * mm, "Convention : Convention collective")

    # ---- Tableau des rubriques ----
    y -= 34 * mm
    c.setFont("Helvetica-Bold", 9)
    c.rect(x0, y - 54 * mm, w - 2 * x0, 60 * mm)
    c.line(x0, y, w - x0, y)
    c.line(x0 + 70 * mm, y, x0 + 70 * mm, y - 54 * mm)
    c.line(x0 + 110 * mm, y, x0 + 110 * mm, y - 54 * mm)
    c.line(x0 + 135 * mm, y, x0 + 135 * mm, y - 54 * mm)

    def row(yy, label, base, primes, retenue):
        c.setFont("Helvetica", 9)
        c.drawString(x0 + 2 * mm, yy, label)
        c.drawRightString(x0 + 108 * mm, yy, base)
        c.drawRightString(x0 + 133 * mm, yy, primes)
        c.drawRightString(w - x0 - 2 * mm, yy, retenue)

    yy = y - 6 * mm
    c.drawString(x0 + 2 * mm, yy, "Rubrique")
    c.drawRightString(x0 + 108 * mm, yy, "Salaire")
    c.drawRightString(x0 + 133 * mm, yy, "Primes")
    c.drawRightString(w - x0 - 2 * mm, yy, "Retenues")

    cnss = round(emp["base"] * 0.0918, 3)
    irpp = round((emp["base"] + emp["prime"] - cnss) * 0.12, 3)
    css = round(emp["base"] * 0.01, 3)
    net = emp["base"] + emp["prime"] + emp["transport"] - cnss - irpp - css

    yy -= 7 * mm
    row(yy, "Salaire de base", fmt(emp["base"]), "0,000", "0,000")
    yy -= 7 * mm
    row(yy, "Prime de rendement", "0,000", fmt(emp["prime"]), "0,000")
    yy -= 7 * mm
    row(yy, "Indemnité de transport", "0,000", fmt(emp["transport"]), "0,000")
    yy -= 7 * mm
    row(yy, "CNSS (9,18%)", "0,000", "0,000", fmt(cnss))
    yy -= 7 * mm
    row(yy, "Impôt sur le revenu (IRPP)", "0,000", "0,000", fmt(irpp))
    yy -= 7 * mm
    row(yy, "Contribution sociale (CSS)", "0,000", "0,000", fmt(css))

    # ---- Net à payer + date de paiement (format variable) ----
    y = y - 54 * mm - 12 * mm
    c.setFont("Helvetica-Bold", 11)
    c.drawString(x0, y, f"NET A PAYER : {fmt(net)} DT")
    c.setFont("Helvetica", 9)
    c.drawString(x0, y - 8 * mm, emp["pay"])
    c.setFont("Helvetica", 8)
    c.drawString(x0, y - 14 * mm, f"Arrêté la présente somme à : {fmt(net)} Dinars")
    c.drawString(x0, y - 20 * mm, "Document généré par Sage paie & RH")
    if emp.get("declaration"):
        c.drawString(x0, y - 28 * mm, emp["declaration"])

    c.showPage()
    c.save()


for emp in SLIPS:
    path = os.path.join(OUT_DIR, emp["file"])
    draw_payslip(emp, path)
    print(f"OK  {emp['file']}  CIN={emp['cin']!r}  dates={emp['periode']} / {emp['pay']}")

print("\nTerminé :", OUT_DIR)
