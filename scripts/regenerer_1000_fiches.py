#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Régénère les 1000 fiches de paie du fichier TransferNow
« 1000_fiches_de_paie_fictives (1).pdf » en gardant la MÊME STRUCTURE que
l'ancien fichier « fiches_paie_1000.pdf » (généré par ReportLab + AutoRH) :
libellés en TEXTE (TUNIS CALL CENTER / BULLETIN DE PAIE / MATRICULE /
NOM ET PRENOM / N° CIN / dates / 1990 Salaire Net / 2100 Net à payer…),
exactement la structure que le site Auto-RH extrait correctement.

Livrables :
  - download/1000-fiches-paie-structure-texte.pdf  (1000 pages)
  - download/1000-fiches-paie-structure-texte.txt  (mêmes données en texte)
  - scripts/echantillon_3_fiches.pdf               (pages 1-3, pour test E2E)
"""
import json
from reportlab.pdfgen import canvas
from reportlab.pdfbase.pdfmetrics import stringWidth

JSON_SRC = "/home/z/my-project/scripts/fiches_1000.json"
PDF_OUT = "/home/z/my-project/download/1000-fiches-paie-structure-texte.pdf"
TXT_OUT = "/home/z/my-project/download/1000-fiches-paie-structure-texte.txt"
PDF_SAMPLE = "/home/z/my-project/scripts/echantillon_3_fiches.pdf"

PAGE_W, PAGE_H = 583.0, 842.0   # format de l'ancien fichier

# ------------------------------------------------------------------ données
with open(JSON_SRC, encoding="utf-8") as fh:
    FICHES = json.load(fh)
print(f"Fiches chargées : {len(FICHES)}")


def fmt(s):
    """« 2541,762 » -> « 2 541,762 » (séparateur de milliers espace, comme
    l'ancien fichier) ; laisse « 22,000 » tel quel."""
    if not s:
        return ""
    s = s.strip().replace("\u00a0", " ").replace(" ", "")
    if "," in s:
        ent, dec = s.rsplit(",", 1)
    else:
        ent, dec = s, ""
    if ent.isdigit() and len(ent) > 3:
        g = []
        while len(ent) > 3:
            g.insert(0, ent[-3:])
            ent = ent[:-3]
        g.insert(0, ent)
        ent = " ".join(g)
    return ent + ("," + dec if dec else "")


def fit(c, text, font, size, max_w, x, y, min_size=5.5):
    """Dessine le texte en réduisant la police si nécessaire pour tenir
    dans max_w points (colonne FONCTION étroite de l'ancien gabarit)."""
    if not text:
        return
    real = size
    while real > min_size and stringWidth(text, font, real) > max_w:
        real -= 0.25
    c.setFont(font, real)
    c.drawString(x, y, text)


# ------------------------------------------------------------ géométrie ancienne
# baselines « y depuis le haut » (identiques à l'ancien fichier)
Y_TITRE = 43.0
Y_MCNS = 55.0
Y_BULLETIN = 89.0
Y_SALAIRE = 77.0
Y_DATES = 92.0
Y_LAB1 = 114.2          # MATRICULE / NOM ET PRENOM / FONCTION / CATEGORIE
Y_VAL1 = 129.5          # valeurs correspondantes
Y_LAB2 = 144.2          # ETAT CIVIL / ENF. A CHARGE / N° CNSS / N° CIN
Y_VAL2 = 159.5          # valeurs correspondantes
Y_DROIT_LAB = 121.8     # Droit acquis / Solde Congés / H/J Trav / Sal. Base Th
Y_DROIT_VAL = 151.5
Y_TAB_HEAD = 177.0      # N° / Rubrique / Nombre / Base / Taux / Gains / Retenues
Y_ROWS0 = 191.0         # 1re ligne de rubrique
PAS = 14.0              # 17 lignes : 6,10,60,110,120,140,190,TB,600,710,720,800,900,950,TC,1990,2100
Y_VIRER = 433.0
Y_BANQUE = 458.0
Y_COMPTE = 458.0
Y_NETBIG = 460.0
Y_SIGN = 484.0
Y_SOC = 567.0
Y_LEGAL = 579.0
Y_MENTION = 593.0

X = {
    "titre": 25.0, "mcns": 25.0,
    "bulletin": 133.7, "salaire": 440.6, "date1": 376.5, "date2": 518.0,
    "mat_lab": 32.9, "nom_lab": 102.9, "fon_lab": 220.4, "cat_lab": 294.2,
    "mat_val": 41.7, "nom_val": 113.4, "fon_val": 216.4, "cat_val": 298.9,
    "ec_lab": 34.6, "enf_lab": 105.4, "cnss_lab": 224.3, "cin_lab": 304.8,
    "ec_val": 35.9, "enf_val": 132.8, "cnss_val": 214.2, "cin_val": 298.7,
    "dr_lab": 343.8, "so_lab": 395.5, "tr_lab": 458.2, "sb_lab": 505.7,
    "dr_val": 355.5, "so_val": 408.3, "tr_val": 458.5, "sb_val": 515.8,
    "n_lab": 33.0, "rub_lab": 104.9, "nb_lab": 204.9, "ba_lab": 275.4,
    "ta_lab": 333.2, "ga_lab": 398.4, "re_lab": 490.5,
    "no_x": 33.0, "rub_x": 52.0,
    "nb_r": 233.0, "ba_r": 318.0, "ta_r": 358.0, "ga_r": 460.0, "re_r": 558.0,
    "virer": 61.7, "compte_lab": 207.0, "net_lab": 436.2,
    "banque": 72.3, "compte_val": 187.4, "netbig": 430.9,
    "sign1": 29.0, "sign2": 376.0,
    "soc": 252.8, "leg1": 27.0, "leg2": 255.7, "leg3": 473.7, "mention": 145.0,
}

# cadres (x0, y_haut, x1, y_bas) — « y depuis le haut »
def rect_haut(x0, yh, x1, yb):
    return (x0, PAGE_H - yh, x1, PAGE_H - yb)


BOXES = [
    rect_haut(25, 68, 368, 103),      # BULLETIN DE PAIE
    rect_haut(368, 68, 558, 103),     # SALAIRE
    rect_haut(25, 103, 340, 122),     # MATRICULE | NOM | FONCTION | CATEGORIE
    rect_haut(340, 103, 558, 137),    # Droit acquis | Solde | Trav | Sal. Base
    rect_haut(25, 122, 340, 137),     # valeurs identité 1
    rect_haut(25, 137, 340, 152),     # ETAT CIVIL | ENF | CNSS | CIN
    rect_haut(340, 137, 558, 168),    # valeurs droit/trav/salbase
    rect_haut(25, 152, 340, 168),
]

TAB_X = [25, 45, 200, 260, 330, 390, 480, 558]   # séparateurs colonnes
TAB_TOP = 168.0
TAB_BOT = TAB_TOP + PAS * 17 + 14.0              # entête + 17 lignes

BOT_BOXES = [
    rect_haut(25, TAB_BOT, 170, TAB_BOT + 52),    # VIRER A / banque
    rect_haut(170, TAB_BOT, 400, TAB_BOT + 52),   # NUMERO DE COMPTE
    rect_haut(400, TAB_BOT, 558, TAB_BOT + 52),   # NET A PAYER
]

SIGN_BOXES = [
    rect_haut(25, 477, 200, 545),     # Signature Employé
    rect_haut(370, 477, 530, 545),    # Cachet Société
]


def dessiner_gabarit(c):
    """Cadres et séparateurs (une seule fois par page, avant le texte)."""
    c.setLineWidth(0.7)
    for x0, y0, x1, y1 in BOXES:
        c.rect(x0, y0, x1 - x0, y1 - y0)
    # tableau des rubriques
    c.rect(TAB_X[0], PAGE_H - TAB_TOP, TAB_X[-1] - TAB_X[0], TAB_BOT - TAB_TOP)
    c.line(TAB_X[0], PAGE_H - (TAB_TOP + 14), TAB_X[-1], PAGE_H - (TAB_TOP + 14))
    for i in range(1, 18):
        y = PAGE_H - (TAB_TOP + 14 + i * PAS)
        c.line(TAB_X[0], y, TAB_X[-1], y)
    for x in TAB_X[1:-1]:
        c.line(x, PAGE_H - TAB_TOP, x, PAGE_H - TAB_BOT)
    # bloc bancaire
    for x0, y0, x1, y1 in BOT_BOXES:
        c.rect(x0, y0, x1 - x0, y1 - y0)
    for x0, y0, x1, y1 in SIGN_BOXES:
        c.rect(x0, y0, x1 - x0, y1 - y0)


# ------------------------------------------------------------------ PDF
def dessiner_fiche(c, f):
    dessiner_gabarit(c)

    c.setFont("Helvetica-Bold", 16)
    c.drawString(X["titre"], PAGE_H - Y_TITRE, "TUNIS CALL CENTER")
    c.setFont("Helvetica", 9)
    c.drawString(X["mcns"], PAGE_H - Y_MCNS, "Matricule CNSS : 209 959 - 51")

    c.setFont("Helvetica-Bold", 14)
    c.drawString(X["bulletin"], PAGE_H - Y_BULLETIN, "BULLETIN DE PAIE")
    c.setFont("Helvetica-Bold", 11)
    c.drawString(X["salaire"], PAGE_H - Y_SALAIRE, "SALAIRE")
    c.setFont("Helvetica", 9)
    c.drawString(X["date1"], PAGE_H - Y_DATES, f["date_debut"])
    c.drawString(X["date2"], PAGE_H - Y_DATES, f["date_fin"])

    # ---- ligne d'étiquettes 1
    c.setFont("Helvetica-Bold", 7.5)
    c.drawString(X["mat_lab"], PAGE_H - Y_LAB1, "MATRICULE")
    c.drawString(X["nom_lab"], PAGE_H - Y_LAB1, "NOM ET PRENOM")
    c.drawString(X["fon_lab"], PAGE_H - Y_LAB1, "FONCTION")
    c.drawString(X["cat_lab"], PAGE_H - Y_LAB1, "CATEGORIE")
    # ---- valeurs 1 (matricule en premier token, comme l'ancien fichier)
    fit(c, f["matricule"], "Helvetica", 8, 50, X["mat_val"], PAGE_H - Y_VAL1)
    fit(c, f["nom_prenom"], "Helvetica-Bold", 8, 118, X["nom_val"], PAGE_H - Y_VAL1)
    fit(c, f["fonction"], "Helvetica", 8, 72, X["fon_val"], PAGE_H - Y_VAL1)
    fit(c, f.get("categorie", ""), "Helvetica", 8, 40, X["cat_val"], PAGE_H - Y_VAL1)
    # ---- bloc droit / trav / salaire de base
    c.setFont("Helvetica-Bold", 7.5)
    c.drawString(X["dr_lab"], PAGE_H - Y_DROIT_LAB, "Droit acquis")
    c.drawString(X["so_lab"], PAGE_H - Y_DROIT_LAB, "Solde Congés")
    c.drawString(X["tr_lab"], PAGE_H - Y_DROIT_LAB, "H/J Trav")
    c.drawString(X["sb_lab"], PAGE_H - Y_DROIT_LAB, "Sal. Base Th")
    c.setFont("Helvetica", 8)
    c.drawString(X["dr_val"], PAGE_H - Y_DROIT_VAL, fmt(f.get("droit", "")))
    c.drawString(X["so_val"], PAGE_H - Y_DROIT_VAL, fmt(f.get("solde", "")))
    c.drawString(X["tr_val"], PAGE_H - Y_DROIT_VAL, fmt(f.get("trav", "")))
    c.drawString(X["sb_val"], PAGE_H - Y_DROIT_VAL, fmt(f.get("sal_base", "")))

    # ---- ligne d'étiquettes 2
    c.setFont("Helvetica-Bold", 7.5)
    c.drawString(X["ec_lab"], PAGE_H - Y_LAB2, "ETAT CIVIL")
    c.drawString(X["enf_lab"], PAGE_H - Y_LAB2, "ENF. A CHARGE")
    c.drawString(X["cnss_lab"], PAGE_H - Y_LAB2, "N° CNSS")
    c.drawString(X["cin_lab"], PAGE_H - Y_LAB2, "N° CIN")
    # ---- valeurs 2
    c.setFont("Helvetica", 8)
    c.drawString(X["ec_val"], PAGE_H - Y_VAL2, f["etat_civil"])
    c.drawString(X["enf_val"], PAGE_H - Y_VAL2, f["enfants"])
    c.drawString(X["cnss_val"], PAGE_H - Y_VAL2, f["cnss"])
    c.drawString(X["cin_val"], PAGE_H - Y_VAL2, f["cin"])

    # ---- tableau des rubriques
    c.setFont("Helvetica-Bold", 8)
    c.drawString(X["n_lab"], PAGE_H - Y_TAB_HEAD, "N°")
    c.drawString(X["rub_lab"], PAGE_H - Y_TAB_HEAD, "Rubrique")
    c.drawString(X["nb_lab"], PAGE_H - Y_TAB_HEAD, "Nombre")
    c.drawString(X["ba_lab"], PAGE_H - Y_TAB_HEAD, "Base")
    c.drawString(X["ta_lab"], PAGE_H - Y_TAB_HEAD, "Taux")
    c.drawString(X["ga_lab"], PAGE_H - Y_TAB_HEAD, "Gains")
    c.drawString(X["re_lab"], PAGE_H - Y_TAB_HEAD, "Retenues")

    rub = {r["numero"]: r for r in f["rubriques"]}

    def ligne_rub(idx, numero, libelle, bold=False, colonnes=("nombre", "base", "taux", "gains", "retenues"),
                  retenues_depuis_gains=False):
        y = PAGE_H - (Y_ROWS0 + idx * PAS)
        font = "Helvetica-Bold" if bold else "Helvetica"
        c.setFont(font, 8)
        c.drawString(X["no_x"], y, numero)
        c.drawString(X["rub_x"], y, libelle)
        r = rub.get(numero, {})
        # nombres alignés à droite dans leur colonne (comme l'ancien)
        if "nombre" in colonnes and r.get("nombre"):
            c.drawRightString(X["nb_r"], y, fmt(r["nombre"]))
        if "base" in colonnes and r.get("base"):
            c.drawRightString(X["ba_r"], y, fmt(r["base"]))
        if "taux" in colonnes and r.get("taux"):
            c.drawRightString(X["ta_r"], y, fmt(r["taux"]))
        if "gains" in colonnes and r.get("gains"):
            c.drawRightString(X["ga_r"], y, fmt(r["gains"]))
        if "retenues" in colonnes:
            # le fichier source place IRPP/CSS/Total Cotisations dans la
            # colonne Gains : repli automatique pour la colonne Retenues
            val = r.get("retenues") or (r.get("gains") if retenues_depuis_gains else "")
            if val:
                c.drawRightString(X["re_r"], y, fmt(val))

    # 7 lignes de gains (structure de l'ancien fichier, 140 comprise)
    ligne_rub(0, "6", "Présence")
    ligne_rub(1, "10", "Salaire de base du mois")
    ligne_rub(2, "60", "Congés payés")
    ligne_rub(3, "110", "Indemnité de présence")
    ligne_rub(4, "120", "Indemnité de transport")
    ligne_rub(5, "140", "Jours Fériés / Supplémentair")
    ligne_rub(6, "190", "Quote part prime")
    ligne_rub(7, "TB", "Total Brut", bold=True, colonnes=("gains",))
    ligne_rub(8, "600", "CNSS", colonnes=("base", "taux", "retenues"))
    ligne_rub(9, "710", "Assurance maladie", colonnes=("base", "taux", "retenues"))
    ligne_rub(10, "720", "Assurance Invalidité Décès", colonnes=("base", "taux", "retenues"))
    ligne_rub(11, "800", "SALAIRE IMPOSABLE", bold=True, colonnes=("gains",))
    ligne_rub(12, "900", "IRPP", colonnes=("retenues",), retenues_depuis_gains=True)
    ligne_rub(13, "950", "Retenue CSS", colonnes=("retenues",), retenues_depuis_gains=True)
    ligne_rub(14, "TC", "Total Cotisations", bold=True, colonnes=("retenues",), retenues_depuis_gains=True)
    ligne_rub(15, "1990", "Salaire Net", colonnes=("gains",))
    ligne_rub(16, "2100", "Net à payer", bold=True, colonnes=("gains",))

    # ---- bloc bancaire
    c.setFont("Helvetica-Bold", 9)
    c.drawString(X["virer"], PAGE_H - Y_VIRER, "VIRER A")
    c.drawString(X["compte_lab"], PAGE_H - Y_VIRER, "NUMERO DE COMPTE")
    c.drawString(X["net_lab"], PAGE_H - Y_VIRER, "NET A PAYER")
    c.setFont("Helvetica-Bold", 9)
    c.drawString(X["banque"], PAGE_H - Y_BANQUE, "BIAT")
    c.setFont("Helvetica", 9)
    c.drawString(X["compte_val"], PAGE_H - Y_COMPTE, f["compte"])
    c.setFont("Helvetica-Bold", 16)
    c.drawString(X["netbig"], PAGE_H - Y_NETBIG, fmt(f["net_bas"]))

    # ---- signatures + bas de page
    c.setFont("Helvetica-Bold", 8)
    c.drawString(X["sign1"], PAGE_H - Y_SIGN, "Signature Employé")
    c.drawString(X["sign2"], PAGE_H - Y_SIGN, "Cachet Société")
    c.setFont("Helvetica-Bold", 9)
    c.drawString(X["soc"], PAGE_H - Y_SOC, "TELEMARKETING")
    c.setFont("Helvetica", 8)
    c.drawString(X["leg1"], PAGE_H - Y_LEGAL, "Au Capital de 1.050.000 DT -")
    c.drawString(X["leg2"], PAGE_H - Y_LEGAL, "R.C. : 112 312 1998")
    c.drawString(X["leg3"], PAGE_H - Y_LEGAL, "M.F: 633781K/A/M/000")
    c.setFont("Helvetica-Oblique", 7)
    c.drawString(X["mention"], PAGE_H - Y_MENTION,
                 "Pour vous aider à faire valoir vos droits, conservez ce "
                 "bulletin de paie sans limitation de durée.")


def generer_pdf(chemin, fiches, limite=None):
    c = canvas.Canvas(chemin, pagesize=(PAGE_W, PAGE_H))
    c.setTitle("Bulletins de paie - Tunis Call Center")
    c.setAuthor("AutoRH")
    c.setSubject("1 000 fiches de paie - structure texte (refait)")
    c.setCreator("ReportLab + AutoRH")
    n = 0
    for f in fiches:
        if limite is not None and n >= limite:
            break
        dessiner_fiche(c, f)
        c.showPage()
        n += 1
    c.save()
    return n


# ------------------------------------------------------------------ TXT
LARG = 80


def bloc_txt(i, f):
    rub = {r["numero"]: r for r in f["rubriques"]}
    L = []
    bar = "=" * LARG
    L.append(bar)
    L.append(f"FICHE {i + 1:04d} / {len(FICHES)}   (page {f['page']} du fichier d'origine)")
    L.append(bar)
    L.append("TUNIS CALL CENTER")
    L.append("Matricule CNSS : 209 959 - 51")
    L.append("")
    L.append("BULLETIN DE PAIE                              SALAIRE")
    L.append(f"                                              Du {f['date_debut']} "
             f"au {f['date_fin']}")
    L.append("")
    L.append(f"MATRICULE      : {f['matricule']}")
    L.append(f"NOM ET PRENOM  : {f['nom_prenom']}")
    L.append(f"FONCTION       : {f['fonction']}")
    cat = f.get("categorie", "")
    L.append(f"CATEGORIE      : {cat if cat else '-'}")
    L.append(f"ETAT CIVIL     : {f['etat_civil']}")
    L.append(f"ENF. A CHARGE  : {f['enfants']}")
    L.append(f"N° CNSS        : {f['cnss']}")
    L.append(f"N° CIN         : {f['cin']}")
    L.append(f"Droit acquis   : {fmt(f.get('droit', '')) or '-'}    "
             f"Solde Congés : {fmt(f.get('solde', '')) or '-'}    "
             f"H/J Trav : {fmt(f.get('trav', ''))}    "
             f"Sal. Base Th : {fmt(f.get('sal_base', ''))}")
    L.append("")
    ent = (f"{'N°':<5}{'Rubrique':<30}{'Nombre':>10}{'Base':>12}"
           f"{'Taux':>9}{'Gains':>12}{'Retenues':>12}")
    L.append(ent)
    L.append("-" * LARG)

    def rl(idx, numero, libelle, cols=("nombre", "base", "taux", "gains", "retenues"),
           retenues_depuis_gains=False):
        r = rub.get(numero, {})
        def g(k):
            if k not in cols:
                return ""
            if k == "retenues" and not r.get("retenues") and retenues_depuis_gains:
                return fmt(r.get("gains", ""))
            return fmt(r.get(k, ""))
        L.append(f"{numero:<5}{libelle:<30}{g('nombre'):>10}{g('base'):>12}"
                 f"{g('taux'):>9}{g('gains'):>12}{g('retenues'):>12}")

    rl(0, "6", "Présence")
    rl(1, "10", "Salaire de base du mois")
    rl(2, "60", "Congés payés")
    rl(3, "110", "Indemnité de présence")
    rl(4, "120", "Indemnité de transport")
    rl(5, "140", "Jours Fériés / Supplémentair")
    rl(6, "190", "Quote part prime")
    rl(7, "TB", "Total Brut", cols=("gains",))
    rl(8, "600", "CNSS", cols=("base", "taux", "retenues"))
    rl(9, "710", "Assurance maladie", cols=("base", "taux", "retenues"))
    rl(10, "720", "Assurance Invalidité Décès", cols=("base", "taux", "retenues"))
    rl(11, "800", "SALAIRE IMPOSABLE", cols=("gains",))
    rl(12, "900", "IRPP", cols=("retenues",), retenues_depuis_gains=True)
    rl(13, "950", "Retenue CSS", cols=("retenues",), retenues_depuis_gains=True)
    rl(14, "TC", "Total Cotisations", cols=("retenues",), retenues_depuis_gains=True)
    rl(15, "1990", "Salaire Net", cols=("gains",))
    rl(16, "2100", "Net à payer", cols=("gains",))
    L.append("")
    L.append(f"VIRER A        : BIAT")
    L.append(f"NUMERO COMPTE  : {f['compte']}")
    L.append(f"NET A PAYER    : {fmt(f['net_bas'])}")
    L.append("")
    return "\n".join(L)


if __name__ == "__main__":
    import os
    os.makedirs("/home/z/my-project/download", exist_ok=True)

    n = generer_pdf(PDF_OUT, FICHES)
    mo = os.path.getsize(PDF_OUT) / (1024 * 1024)
    print(f"PDF  : {PDF_OUT} — {n} pages, {mo:.2f} Mo")

    n3 = generer_pdf(PDF_SAMPLE, FICHES[:3])
    print(f"PDF échantillon : {PDF_SAMPLE} — {n3} pages")

    with open(TXT_OUT, "w", encoding="utf-8") as fh:
        for i, f in enumerate(FICHES):
            fh.write(bloc_txt(i, f))
    mo_t = os.path.getsize(TXT_OUT) / (1024 * 1024)
    print(f"TXT  : {TXT_OUT} — {mo_t:.2f} Mo")
