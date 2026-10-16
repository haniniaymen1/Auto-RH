#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Rapport d'audit de sécurité - ZIP CORRIGE Auto-RH - corps ReportLab."""
import sys, os, hashlib

PDF_SKILL_DIR = "/home/z/my-project/skills/pdf"
sys.path.insert(0, os.path.join(PDF_SKILL_DIR, "scripts"))

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm, inch
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY, TA_RIGHT
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table,
                                TableStyle, PageBreak, KeepTogether, HRFlowable,
                                CondPageBreak)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily

FONT_DIR = "/usr/share/fonts"
pdfmetrics.registerFont(TTFont("NotoSerifSC", f"{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf"))
pdfmetrics.registerFont(TTFont("NotoSerifSC-Bold", f"{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Bold.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif", f"{FONT_DIR}/truetype/freefont/FreeSerif.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif-Bold", f"{FONT_DIR}/truetype/freefont/FreeSerifBold.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif-Italic", f"{FONT_DIR}/truetype/freefont/FreeSerifItalic.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif-BoldItalic", f"{FONT_DIR}/truetype/freefont/FreeSerifBoldItalic.ttf"))
pdfmetrics.registerFont(TTFont("DejaVuSans", f"{FONT_DIR}/truetype/dejavu/DejaVuSansMono.ttf"))

registerFontFamily("NotoSerifSC", normal="NotoSerifSC", bold="NotoSerifSC-Bold")
registerFontFamily("FreeSerif", normal="FreeSerif", bold="FreeSerif-Bold",
                   italic="FreeSerif-Italic", boldItalic="FreeSerif-BoldItalic")
registerFontFamily("DejaVuSans", normal="DejaVuSans", bold="DejaVuSans")

from pdf import install_font_fallback
install_font_fallback()

# -- Palette cascade (auto-generee) --
PAGE_BG       = colors.HexColor("#f5f5f6")
SECTION_BG    = colors.HexColor("#e8eaeb")
CARD_BG       = colors.HexColor("#e4e7e9")
TABLE_STRIPE  = colors.HexColor("#edeeef")
HEADER_FILL   = colors.HexColor("#4c636f")
COVER_BLOCK   = colors.HexColor("#436170")
BORDER        = colors.HexColor("#b3bfc5")
ICON          = colors.HexColor("#4687a7")
ACCENT        = colors.HexColor("#228bbf")
ACCENT_2      = colors.HexColor("#b0644b")
TEXT_PRIMARY  = colors.HexColor("#191a1b")
TEXT_MUTED    = colors.HexColor("#7f8588")
SEM_SUCCESS   = colors.HexColor("#4b825d")
SEM_WARNING   = colors.HexColor("#a3864c")
SEM_ERROR     = colors.HexColor("#a7554e")
SEM_INFO      = colors.HexColor("#5b7b9a")

MARGIN = 2.0 * cm
PAGE_W, PAGE_H = A4
AVAIL_W = PAGE_W - 2 * MARGIN
AVAIL_H = PAGE_H - 2 * MARGIN
H1_THRESHOLD = AVAIL_H * 0.25

OUT_BODY = "/home/z/my-project/audit_zip_task94/corps_rapport.pdf"
DOC_TITLE = "Rapport d'audit de sécurité — ZIP « CORRIGÉ » Auto-RH"

# -- Styles --
st_body = ParagraphStyle("Body", fontName="FreeSerif", fontSize=10.5, leading=17,
                         alignment=TA_JUSTIFY, textColor=TEXT_PRIMARY, spaceAfter=8)
st_bullet = ParagraphStyle("Bullet", parent=st_body, alignment=TA_LEFT,
                           leftIndent=16, bulletIndent=4, spaceAfter=5)
st_h1 = ParagraphStyle("H1", fontName="FreeSerif", fontSize=21, leading=26,
                       alignment=TA_LEFT, textColor=HEADER_FILL,
                       spaceBefore=6, spaceAfter=4)
st_h2 = ParagraphStyle("H2", fontName="FreeSerif", fontSize=14.5, leading=19,
                       alignment=TA_LEFT, textColor=HEADER_FILL,
                       spaceBefore=14, spaceAfter=6)
st_h3 = ParagraphStyle("H3", fontName="FreeSerif", fontSize=11.5, leading=16,
                       alignment=TA_LEFT, textColor=TEXT_PRIMARY,
                       spaceBefore=10, spaceAfter=5)
st_caption = ParagraphStyle("Caption", fontName="FreeSerif", fontSize=8.5, leading=12,
                            alignment=TA_CENTER, textColor=TEXT_MUTED,
                            spaceBefore=3, spaceAfter=6)
st_quote = ParagraphStyle("Quote", fontName="FreeSerif-Italic", fontSize=10.5,
                          leading=17, alignment=TA_LEFT, textColor=TEXT_PRIMARY,
                          leftIndent=24, spaceBefore=6, spaceAfter=8)
st_th = ParagraphStyle("TH", fontName="FreeSerif", fontSize=9.5, leading=13,
                       alignment=TA_CENTER, textColor=colors.white)
st_td = ParagraphStyle("TD", fontName="FreeSerif", fontSize=9.5, leading=13,
                       alignment=TA_LEFT, textColor=TEXT_PRIMARY)
st_td_c = ParagraphStyle("TDC", parent=st_td, alignment=TA_CENTER)
st_stat_big = ParagraphStyle("StatBig", fontName="FreeSerif", fontSize=20, leading=24,
                             alignment=TA_CENTER, textColor=ACCENT)
st_stat_lbl = ParagraphStyle("StatLbl", fontName="FreeSerif", fontSize=8.5, leading=11,
                             alignment=TA_CENTER, textColor=TEXT_MUTED)
st_toc_title = ParagraphStyle("TocTitle", fontName="FreeSerif", fontSize=21, leading=26,
                              alignment=TA_LEFT, textColor=HEADER_FILL, spaceAfter=14)
toc_l0 = ParagraphStyle("TOC0", fontName="FreeSerif", fontSize=11.5, leading=20,
                        leftIndent=8, textColor=TEXT_PRIMARY)
toc_l1 = ParagraphStyle("TOC1", fontName="FreeSerif", fontSize=10, leading=16,
                        leftIndent=28, textColor=TEXT_MUTED)


class TocDocTemplate(SimpleDocTemplate):
    def afterFlowable(self, flowable):
        if hasattr(flowable, "bookmark_name"):
            level = getattr(flowable, "bookmark_level", 0)
            text = getattr(flowable, "bookmark_text", "")
            key = getattr(flowable, "bookmark_key", "")
            # Numerotation affichee : le corps repart a 1 apres la page TOC (i)
            self.notify("TOCEntry", (level, text, self.page - 1, key))


def heading(text, style, level=0):
    key = "h_" + hashlib.md5(text.encode()).hexdigest()[:8]
    p = Paragraph('<a name="%s"/><b>%s</b>' % (key, text), style)
    p.bookmark_name = key
    p.bookmark_level = level
    p.bookmark_text = text
    p.bookmark_key = key
    return p


def safe_keep_together(elements, max_ratio=0.4):
    total_h = 0
    for el in elements:
        w, h = el.wrap(AVAIL_W, PAGE_H)
        total_h += h
    if total_h <= PAGE_H * max_ratio:
        return [KeepTogether(elements)]
    elif len(elements) >= 2:
        return [KeepTogether(elements[:2])] + list(elements[2:])
    return list(elements)


def h1(story, num, title, first_para=None):
    story.append(CondPageBreak(H1_THRESHOLD))
    hp = heading("%d. %s" % (num, title), st_h1, level=0)
    rule = HRFlowable(width="100%", color=ACCENT, thickness=1.6,
                      spaceBefore=2, spaceAfter=12)
    group = [hp, rule]
    if first_para is not None:
        group.append(first_para)
    story.extend(safe_keep_together(group))


def h2(story, num, title, first=None):
    hp = heading("%s %s" % (num, title), st_h2, level=1)
    group = [hp]
    if first is not None:
        group.append(first)
    story.extend(safe_keep_together(group))


def P(txt):
    return Paragraph(txt, st_body)


def B(txt):
    return Paragraph(txt, st_bullet, bulletText="•")


def styled_table(head, rows, ratios, align_map=None, caption=None):
    """Tableau stylé : en-tête HEADER_FILL + zébrage TABLE_STRIPE."""
    n = len(head)
    ratios = ratios[:n]
    total = sum(ratios)
    col_w = [r / total * AVAIL_W * 0.98 for r in ratios]
    data = [[Paragraph("<b>%s</b>" % c, st_th) for c in head]]
    for row in rows:
        line = []
        for i, c in enumerate(row):
            sty = st_td
            if align_map and align_map[i] == "c":
                sty = st_td_c
            line.append(Paragraph(c, sty))
        data.append(line)
    t = Table(data, colWidths=col_w, hAlign="CENTER", repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), HEADER_FILL),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            style.append(("BACKGROUND", (0, i), (-1, i), TABLE_STRIPE))
        else:
            style.append(("BACKGROUND", (0, i), (-1, i), colors.white))
    t.setStyle(TableStyle(style))
    out = [Spacer(1, 12), t]
    if caption:
        out += [Spacer(1, 2), Paragraph(caption, st_caption), Spacer(1, 8)]
    else:
        out += [Spacer(1, 10)]
    return out


def stat_row(stats):
    """Rangée d'indicateurs : [(valeur, libelle, couleur), ...]."""
    cells_v, cells_l = [], []
    for val, lbl, col in stats:
        s_big = ParagraphStyle("sb", parent=st_stat_big, textColor=col)
        cells_v.append(Paragraph("<b>%s</b>" % val, s_big))
        cells_l.append(Paragraph(lbl, st_stat_lbl))
    w = AVAIL_W * 0.96 / len(stats)
    t = Table([cells_v, cells_l], colWidths=[w] * len(stats), hAlign="CENTER")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CARD_BG),
        ("BOX", (0, 0), (-1, -1), 1, BORDER),
        ("LINEAFTER", (0, 0), (-2, -1), 0.5, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, 0), 10),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 10),
        ("TOPPADDING", (0, 1), (-1, 1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 2),
    ]))
    return [Spacer(1, 10), t, Spacer(1, 12)]


def callout(text, color=None):
    col = color or ACCENT
    inner = Paragraph(text, st_body)
    t = Table([[inner]], colWidths=[AVAIL_W * 0.96], hAlign="CENTER")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), CARD_BG),
        ("LINEBEFORE", (0, 0), (0, -1), 4, col),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return [Spacer(1, 8), t, Spacer(1, 10)]


ROMAN = {1: "i", 2: "ii", 3: "iii", 4: "iv", 5: "v"}


def on_page(canvas, doc):
    canvas.saveState()
    # En-tete : titre + filet accent
    canvas.setFont("FreeSerif", 7.5)
    canvas.setFillColor(TEXT_MUTED)
    canvas.drawString(MARGIN, PAGE_H - MARGIN + 16, DOC_TITLE)
    canvas.setStrokeColor(ACCENT)
    canvas.setLineWidth(1.2)
    canvas.line(MARGIN, PAGE_H - MARGIN + 10, PAGE_W - MARGIN, PAGE_H - MARGIN + 10)
    # Pied : auteur gauche + numero droite, filet leger
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.5)
    canvas.line(MARGIN, MARGIN - 14, PAGE_W - MARGIN, MARGIN - 14)
    canvas.setFont("FreeSerif", 7.5)
    canvas.setFillColor(TEXT_MUTED)
    canvas.drawString(MARGIN, MARGIN - 26, "Super Z — Audit Auto-RH")
    if doc.page == 1:
        num = ROMAN.get(doc.page, str(doc.page))
    else:
        num = str(doc.page - 1)
    canvas.drawRightString(PAGE_W - MARGIN, MARGIN - 26, num)
    canvas.restoreState()


story = []

# ---- Table des matieres (page i) ----
story.append(Paragraph("<b>Table des matières</b>", st_toc_title))
toc = TableOfContents()
toc.levelStyles = [toc_l0, toc_l1]
story.append(toc)
story.append(PageBreak())

# ================= 1. RESUME EXECUTIF =================
h1(story, 1, "Résumé exécutif", P(
    "Le présent rapport répond à la demande « vérifie sécurité » formulée à propos de "
    "l'archive <b>auto-rh-scripts-site-web-CORRIGE (1).zip</b> que vous avez transmise. "
    "L'objectif était de déterminer si cette archive peut être installée en toute confiance : "
    "absence de secrets ou de données sensibles, absence de code malveillant, intégrité de "
    "l'emballage, et conformité des mécanismes de sécurité de l'application Auto-RH qu'elle "
    "contient. L'audit a combiné quatre approches complémentaires : vérification d'intégrité, "
    "comparaison fichier par fichier avec la version officielle 0.2.24, balayage statique du "
    "code à la recherche de secrets, et enfin tests dynamiques sur un serveur isolé reconstruit "
    "à partir de l'archive elle-même."))

story += stat_row([
    ("307", "fichiers analysés", SEM_INFO),
    ("255 / 51", "identiques / différents vs 0.2.24", SEM_INFO),
    ("0", "secret ou donnée sensible", SEM_SUCCESS),
    ("1", "régression de sécurité confirmée", SEM_ERROR),
])

story.append(P(
    "Le verdict d'ensemble est <b>sûr mais non conforme sur un point précis</b>. D'un côté, "
    "l'archive ne contient aucun mot de passe, aucune clé de chiffrement, aucune base de "
    "données réelle et aucun fichier d'environnement personnel ; aucun script malveillant n'a "
    "été détecté ; l'intégrité ZIP est parfaite (CRC vérifié, aucun doublon). De l'autre, "
    "cette archive provient d'une <b>branche de développement parallèle</b> : elle applique "
    "correctement la politique de complexité aux <b>mots de passe</b> (8 caractères minimum, "
    "minuscule, majuscule, chiffre et symbole), mais elle <b>n'applique plus cette politique "
    "au code d'activation lors de sa saisie</b> sur la page d'inscription. La preuve en a été "
    "établie dynamiquement : avec l'archive CORRIGÉ, un code volontairement faible "
    "(« PAIESAGE-2026 », sans minuscule) a permis de créer un compte (HTTP 201), alors que la "
    "version officielle 0.2.24 refuse exactement la même demande (HTTP 403)."))

story += callout(
    "<b>Verdict :</b> l'archive est saine (aucune fuite, aucun code hostile), mais elle "
    "<b>régresse</b> par rapport à votre exigence « le code d'activation doit être minimum "
    "8 caractères (minuscule, majuscule, chiffre et symbole) » : le contrôle du code à la "
    "saisie est absent. Le chapitre 7 détaille la correction recommandée.", SEM_ERROR)

story.append(P(
    "Trois constats secondaires complètent ce tableau : la suite de tests de la politique de "
    "complexité (test94) et la section correspondante du manuel de déploiement sont absentes "
    "de cette archive ; un fichier parasite de test est embarqué sous un chemin absolu "
    "anormal (défaut d'emballage partagé avec la version officielle) ; et la communication "
    "SMTP désactive la vérification des certificats serveur (choix hérité de 0.2.24, à "
    "documenter). À l'inverse, cette branche apporte des améliorations réelles par rapport à "
    "0.2.24 : correction du conflit d'installation npm (nodemailer 7), e-mail d'accès "
    "volontairement allégé (le CIN, l'adresse du serveur et le port n'y figurent plus), et "
    "prise en charge des serveurs SMTP personnalisés d'entreprise."))

# ================= 2. OBJET, PERIMETRE ET METHODE =================
h1(story, 2, "Objet, périmètre et méthode", P(
    "L'objet de l'audit est l'archive ZIP transmise le 20 septembre 2026, seconde version "
    "d'un envoi initialement incomplet. Le premier fichier reçu, nommé "
    "« auto-rh-scripts-site-web-CORRIGE (1) (1).zip », était tronqué : il mesurait "
    "3 386 582 octets, soit exactement les 40,4 premiers pour cent du fichier complet — "
    "téléchargement interrompu, signature de fin d'archive absente, seulement 142 entrées "
    "récupérables sur 307. Ce premier envoi n'était donc pas analysable ; l'audit a été mené "
    "sur la version complète, dont l'empreinte correspond bit à bit à un préfixe du premier "
    "fichier, ce qui confirme qu'il s'agit du même document arrivé à terme."))

story += styled_table(
    ["Attribut", "Valeur constatée"],
    [
        ["Nom du fichier", "auto-rh-scripts-site-web-CORRIGE (1).zip"],
        ["Taille compressée", "8 371 185 octets (18 431 844 octets décompressés)"],
        ["Empreinte MD5", "46f8610e0e9e38c3dc7888d407a43e49"],
        ["Nombre d'entrées", "307 fichiers (aucun dossier fantôme, aucun doublon)"],
        ["Version déclarée (package.json)", "0.2.23 — avec nodemailer porté à ^7.0.7"],
        ["Premier envoi (tronqué)", "3 386 582 octets — préfixe exact à 40,4 % — inutilisable"],
    ],
    [0.32, 0.68],
    caption="Carte d'identité de l'archive auditée.")

story.append(P(
    "La méthode a suivi quatre étapes. <b>Première étape, l'intégrité</b> : liste complète des "
    "entrées, contrôle CRC de chaque fichier, recherche de doublons et de fichiers interdits "
    "(.env réel, base SQLite, node_modules, journaux). <b>Deuxième étape, la comparaison</b> : "
    "différentiel exhaustif par empreinte MD5 de chacun des 307 fichiers contre l'archive "
    "officielle 0.2.24 servie par le lien public, afin d'isoler précisément ce qui change. "
    "<b>Troisième étape, l'audit statique</b> : lecture des 51 fichiers divergents, recherche "
    "de secrets sur l'ensemble du contenu (clés, mots de passe, adresses réelles, codes "
    "d'activation), vérification du câblage de la politique de complexité dans les routes "
    "d'authentification. <b>Quatrième étape, les tests dynamiques</b> : reconstruction "
    "complète de l'application issue de l'archive dans un bac à sable isolé (installation npm, "
    "base vierge, serveur de production sur le port 4311), puis requêtes HTTP de contrôle "
    "reproduisant des scénarios d'attaque simples."))

# ================= 3. INTEGRITE DE L'ARCHIVE =================
h1(story, 3, "Intégrité de l'archive", P(
    "L'archive est structurellement saine. Le contrôle CRC de chacune des 307 entrées s'est "
    "terminé sans erreur, la table centrale est complète, et aucune entrée n'apparaît en "
    "double — un point important, car les doublons de noms dans un ZIP peuvent servir à "
    "faire accepter un fichier différent selon l'outil d'extraction. La liste des fichiers "
    "correspond à celle d'une livraison Auto-RH standard, augmentée d'un document "
    "d'accompagnement : LIRE-MOI-FIX-INSTALL.txt, qui documente la correction du conflit "
    "d'installation npm (ERESOLVE sur nodemailer) et le mode d'emploi correspondant."))

story.append(P(
    "Aucun fichier interdit ou sensible n'a été trouvé. La recherche a couvert les motifs "
    "suivants : fichier .env réel ou .env.local (seul un .env.example comportant des "
    "valeurs d'exemple est présent, conformément aux bonnes pratiques), base de données "
    "SQLite ou autre, dossier node_modules, artefacts de compilation .next, dossiers de "
    "stockage des fiches de paie, et journaux d'exécution. L'absence de ces éléments est "
    "essentielle : c'est elle qui garantit que l'archive ne transporte ni votre AUTH_SECRET, "
    "ni le hash du code d'activation de votre installation, ni des fiches de paie réelles, "
    "ni des identifiants SMTP personnels."))

story += styled_table(
    ["Contrôle effectué", "Résultat", "Appréciation"],
    [
        ["CRC des 307 entrées", "Aucune erreur", "Conforme"],
        ["Doublons de noms d'entrées", "Aucun", "Conforme"],
        [".env réel, .env.local, base, node_modules, .next, stockage, journaux", "Aucun trouvé", "Conforme"],
        [".env.example", "Placeholders uniquement (aucune valeur réelle)", "Conforme"],
        ["Signature de fin d'archive (EOCD)", "Présente et valide", "Conforme"],
        ["Premier envoi reçu (tronqué à 40,4 %)", "EOCD absent — 142/307 entrées", "À retélécharger"],
    ],
    [0.44, 0.34, 0.22],
    align_map=["l", "l", "c"],
    caption="Synthèse des contrôles d'intégrité et d'hygiène d'emballage.")

# ================= 4. COMPARAISON AVEC 0.2.24 =================
h1(story, 4, "Comparaison avec la version officielle 0.2.24", P(
    "La comparaison par empreinte MD5 des 307 fichiers contre l'archive officielle 0.2.24 "
    "donne une image très claire : 255 fichiers sont rigoureusement identiques, 51 diffèrent, "
    "un fichier est ajouté et un fichier est absent. Autrement dit, cette archive n'est ni "
    "l'ancienne 0.2.23, ni la 0.2.24 officielle : c'est une <b>branche parallèle</b> qui "
    "réimplémente une partie de la politique de sécurité Task 94 avec des fonctions "
    "différentes, y ajoute des évolutions propres (serveurs SMTP personnalisés, e-mail "
    "allégé, correctif npm) et en perd d'autres (contrôle du code à la saisie, suite de "
    "tests dédiée)."))

story += styled_table(
    ["Écart", "Détail"],
    [
        ["255 fichiers identiques", "Cœur applicatif inchangé : chiffrement, sessions, portail, fiches de paie, etc."],
        ["+1 fichier ajouté", "LIRE-MOI-FIX-INSTALL.txt (documentation du correctif npm ERESOLVE)"],
        ["−1 fichier manquant", "scripts/test94_politique_complexite.py (suite de 83 vérifications de la Task 94)"],
        ["51 fichiers différents", "Politique de complexité (implémentation alternative), mailer et SMTP, générateur de code, portail, interfaces, scripts de test, package.json/lock, README"],
    ],
    [0.28, 0.72],
    caption="Résultat du différentiel exhaustif contre l'archive officielle 0.2.24.")

story.append(P(
    "La lecture des 51 fichiers divergents révèle une cohérence d'ensemble : il ne s'agit pas "
    "d'altérations suspectes, mais d'une réécriture parallèle et documentée. Les fonctions de "
    "contrôle portent d'ailleurs des noms différents (erreurPolitiqueMotDePasse retournant une "
    "liste de manquants, plutôt que validerPolitiqueMotDePasse retournant un message unique), "
    "ce qui explique que des contrôles automatiques calés sur les marqueurs « Task 94 » de la "
    "branche officielle les déclarent absents à tort. Les commentaires de code de la branche "
    "CORRIGÉ documentent explicitement cette politique, et le LIRE-MOI l'annonce noir sur "
    "blanc. Trois familles d'écarts méritent toutefois l'attention, traitées aux chapitres "
    "suivants : le contrôle du code d'activation à la saisie (absent), la suite de tests "
    "test94 (absente), et le fichier parasite d'emballage (présent)."))

# ================= 5. AUDIT DE LA SURFACE DE SECURITE =================
h1(story, 5, "Audit de la surface de sécurité", P(
    "Ce chapitre examine un par un les mécanismes de sécurité de l'application embarquée, en "
    "distinguant ce qui est propre à la branche CORRIGÉ de ce qui est hérité à l'identique de "
    "0.2.24. Pour mémoire, l'audit de la version officielle 0.2.24 avait conclu à une "
    "architecture solide : mots de passe et code d'activation protégés par scrypt (sel de "
    "16 octets, empreinte de 64 octets, comparaison à temps constant), chiffrement AES-256-GCM "
    "des champs sensibles, sessions signées revalidées en base à chaque requête, cookies "
    "HttpOnly/SameSite=Lax, limitation anti-force-brute sur la saisie du code et six seaux de "
    "limitation de débit côté portail. Tous ces mécanismes reposent sur des fichiers "
    "strictement identiques entre les deux branches et restent donc valables ici."))

h2(story, "5.1", "Politique des mots de passe : appliquée partout", P(
    "La branche CORRIGÉ définit sa propre bibliothèque de politique (src/lib/password-policy.ts) "
    "avec la même règle que la Task 94 : 8 caractères minimum, au moins une minuscule, une "
    "majuscule, un chiffre et un symbole. Cette politique est correctement câblée dans toutes "
    "les routes concernées : création de compte RH/IT (/api/auth/signup), changement de mot de "
    "passe obligatoire (/api/auth/change-password), réinitialisation par le superadministrateur "
    "(/api/users/[id]/password), script de création du superadministrateur, ainsi que le portail "
    "employés (premier choix et changements suivants). Les interfaces client affichent la règle "
    "et la contrôlent également avant envoi. Le test dynamique du chapitre 6 le confirme : un "
    "mot de passe « abc123 » est refusé avec un message français précis indiquant les classes "
    "manquantes. Les mots de passe initiaux générés pour le portail garantissent les quatre "
    "familles (trois majuscules, trois minuscules, trois chiffres, trois symboles) et restent "
    "conformes même recopiés sans leurs tirets."))

h2(story, "5.2", "Code d'activation : conforme à la génération, non contrôlé à la saisie", P(
    "C'est ici que se situe la régression. Le générateur de la branche CORRIGÉ produit bien "
    "des codes forts (format SERVICE RH- suivi de deux groupes de cinq caractères garantissant "
    "les quatre familles, tirés avec crypto.randomInt), et les options de création du menu "
    "SECURISER-INSCRIPTION refusent tout code personnalisé trop faible. En revanche, la route "
    "d'inscription <b>ne vérifie plus la complexité du code saisi</b> : la fonction de "
    "politique du code d'activation présente dans 0.2.24 (politiqueCodeInscription, appelée "
    "avant la comparaison du hash) n'existe pas dans cette branche. Conséquence pratique : si "
    "votre installation utilise encore un ancien code faible — par exemple le code historique "
    "de test, ou tout code sans minuscule —, l'archive CORRIGÉ l'acceptera silencieusement à "
    "l'inscription, là où 0.2.24 le refuse en invitant à en recréer un. Le diagnostic de "
    "l'option 7 « Tester un code » perd également son avertissement honnête, puisqu'il n'a "
    "plus rien d'incohérent à signaler."))

h2(story, "5.3", "Secrets et données sensibles : aucune fuite", P(
    "Le balayage de l'intégralité des fichiers textes n'a révélé aucun secret. Aucun mot de "
    "passe d'application Gmail, aucune clé AES ou AUTH_SECRET, aucune clé d'API (motifs "
    "sk- et AIza), aucune clé privée embarquée, aucune adresse e-mail personnelle réelle. "
    "Les occurrences de « SIGNUP_CODE= » et « SIGNUP_CODE_HASH= » se trouvent exclusivement "
    "dans les scripts de test automatisé et ne contiennent que des valeurs factices "
    "(« PAIESAGE-2026 », « MONANCIENCODE-2026 » ou des placeholders), utilisées pour "
    "exercer les mécanismes de hachage ; le mot de passe « it@demo.tn » d'un script de test "
    "est un identifiant de démonstration, pas un secret de production. Le fichier .env.example "
    "ne contient que des commentaires et des valeurs d'exemple. Aucun élément de cette archive "
    "ne compromet votre installation existante ni ne divulgue de donnée de votre organisation."))

h2(story, "5.4", "Fichier parasite et scripts exécutables", P(
    "L'archive embarque un fichier parasite : scripts/apply_specimen_update.py, rangé sous le "
    "chemin absolu anormal home/z/my-project/scripts/ (artefact d'un empaquetage réalisé "
    "depuis une arborescence absolue). Son contenu a été examiné : c'est un script de test "
    "interne bénin (import de fiches spécimens contre un serveur local), sans appel réseau "
    "externe, sans commande système, sans obfuscation. Il est inoffensif mais devrait être "
    "retiré ; il est d'ailleurs également présent dans l'archive officielle 0.2.24, ce qui "
    "en fait un défaut de chaîne d'emballage et non une particularité de cette branche. La "
    "liste des scripts exécutables (fichiers .bat, .vbs, .sh) correspond aux lanceurs "
    "standard de Auto-RH (démarrage, arrêt, sauvegarde, sécurisation de l'inscription, "
    "création superadministrateur) et aux harnais de test ; aucun lanceur inconnu ni modifié "
    "de façon suspecte n'a été détecté."))

h2(story, "5.5", "Dépendances : correctif npm légitime", P(
    "Le changement de dépendances est le motif d'existence de cette branche : nodemailer passe "
    "de ^6.9.15 à ^7.0.7 (version verrouillée 7.0.13 dans package-lock.json) pour résoudre le "
    "conflit ERESOLVE avec next-auth 4.24.15, qui exige nodemailer 7. Les typages suivent "
    "(@types/nodemailer ^7.0.7). Le code applicatif n'utilise que createTransport() et "
    "sendMail(), dont l'API est stable entre les deux versions majeures ; le LIRE-MOI "
    "documente une installation complète de 1 005 paquets sans erreur. Aucune autre dépendance "
    "n'est modifiée : ni rétrogradation silencieuse, ni paquet insolite, ni registre "
    "alternatif dans package-lock.json. Ce correctif est donc sain et même souhaitable, "
    "puisqu'il supprime le contournement --legacy-peer-deps que l'erreur ERESOLVE incitait "
    "par ailleurs à adopter."))

h2(story, "5.6", "Évolutions propres : e-mail allégé et SMTP personnalisé", P(
    "Deux évolutions fonctionnelles de cette branche ont un impact de sécurité positif ou "
    "acceptable. L'e-mail d'accès au portail est <b>volontairement allégé</b> à votre demande : "
    "il ne contient plus que l'adresse d'accès et le mot de passe initial — le CIN, l'adresse "
    "IP ou DNS du serveur et le port du site ne voyagent plus par e-mail, ce qui réduit la "
    "surface exposée en cas de boîte aux lettres compromise. La configuration SMTP accepte "
    "désormais des serveurs personnalisés d'entreprise, y compris des identifiants simples "
    "« login » (admin, DOMAIN\\utilisateur) : la validation reste stricte (pas d'espaces, "
    "longueur plafonnée, jeu de caractères restreint) et le mot de passe SMTP continue "
    "d'être stocké chiffré, jamais renvoyé à l'interface. Deux réserves néanmoins : la "
    "validation TLS des serveurs SMTP reste désactivée (tls rejectUnauthorized à false), "
    "trait hérité de 0.2.24 justifié pour les certificats auto-signés internes mais qui "
    "expose au relais intermédiaire sur un réseau hostile ; et le champ de confirmation du "
    "mot de passe de la page d'inscription garde un minLength client de 6 (purement "
    "cosmétique, le serveur imposant bien 8 avec les quatre familles)."))

# ================= 6. PREUVES DYNAMIQUES =================
h1(story, 6, "Preuves dynamiques en bac à sable", P(
    "Pour ancrer l'audit dans des faits observables, l'application de l'archive a été "
    "reconstruite intégralement dans un environnement isolé : installation npm depuis "
    "package-lock.json (1 005 paquets, sans erreur), génération du client Prisma, base "
    "SQLite vierge, serveur de production démarré sur le port 4311 avec un AUTH_SECRET et un "
    "code d'activation dédiés au test. Le code d'activation configuré pour le bac à sable "
    "était volontairement faible (« PAIESAGE-2026 » : treize caractères avec majuscules, "
    "chiffres et tiret, mais <b>aucune minuscule</b>) pour éprouver précisément le point "
    "litigieux. Les mêmes requêtes ont ensuite été adressées au serveur officiel 0.2.24 "
    "(port 4000) pour comparaison directe."))

story += styled_table(
    ["Scénario testé (sandbox CORRIGÉ, port 4311)", "Réponse", "Interprétation"],
    [
        ["Inscription avec mot de passe faible « abc123 » et code correct",
         "HTTP 400 — « Le mot de passe n'est pas assez fort : au moins 8 caractères, une "
         "lettre majuscule, un symbole… »",
         "Politique mots de passe ACTIVE"],
        ["Inscription avec mot de passe fort « PaieSage2026! » et code faible « PAIESAGE-2026 »",
         "HTTP 201 — compte créé",
         "Politique code d'activation NON appliquée à la saisie"],
        ["Inscription avec mot de passe fort et code erroné",
         "HTTP 403 — « Code d'activation incorrect… » (diagnostic Task 93 intact)",
         "Comportement de base inchangé"],
        ["Même code faible « PAIESAGE-2026 » contre 0.2.24 officiel (port 4000)",
         "HTTP 403 — « Le code d'activation doit contenir au moins une LETTRE MINUSCULE… »",
         "0.2.24 refuse ; la branche CORRIGÉ accepte"],
    ],
    [0.36, 0.36, 0.28],
    caption="Résultats des tests dynamiques (bac à sable isolé, base vierge, port 4311).")

story.append(P(
    "Ces quatre réponses tranchent la question posée. La protection des mots de passe de la "
    "branche CORRIGÉ fonctionne réellement, avec un message d'erreur français précis énumérant "
    "les familles manquantes — ce n'était pas acquis, puisque son implémentation diffère de "
    "celle de 0.2.24. La régression sur le code d'activation est, elle, démontrée de bout en "
    "bout : même demande, deux verdicts opposés selon la version. Il convient de souligner la "
    "portée exacte du risque : elle ne concerne que les installations qui conserveraient un "
    "code d'activation antérieur à la politique de complexité. Un code généré par la branche "
    "CORRIGÉ elle-même est fort ; le problème est la disparition du filet de sécurité qui "
    "refusait les anciens codes faibles et guidait l'administrateur vers leur renouvellement."))

# ================= 7. CONSTATS ET RECOMMANDATIONS =================
h1(story, 7, "Constats et recommandations", P(
    "Le tableau ci-dessous consolide l'ensemble des constats de l'audit, chacun assorti d'une "
    "gravité et d'une recommandation. La gravité « critique » est réservée au constat qui "
    "contrevient à une exigence de sécurité que vous avez explicitement formulée (Task 94) ; "
    "les gravités « moyenne » et « faible » concernent la maintenabilité et l'hygiène ; les "
    "constats positifs sont rappelés pour équilibrer le tableau."))

story += styled_table(
    ["N°", "Constat", "Gravité", "Recommandation"],
    [
        ["C1", "La complexité du code d'activation n'est plus contrôlée à la saisie sur "
               "/signup (refus des anciens codes faibles perdu)", "Critique",
         "R1 : réintroduire le contrôle avant comparaison, ou basculer sur 0.2.24 (voir R1)"],
        ["C2", "Suite de tests test94 (83 vérifications) et section README §59 absentes",
         "Moyenne", "R2 : fusionner les deux branches en un tronc 0.2.25 avec sa suite"],
        ["C3", "Fichier parasite scripts/apply_specimen_update.py sous chemin absolu "
               "(présent aussi dans 0.2.24)", "Faible",
         "R3 : retirer le parasite de la chaîne d'emballage"],
        ["C4", "Option 7 « Tester un code » sans l'avertissement de non-conformité",
         "Faible", "R1 : restaurer l'avertissement avec le contrôle"],
        ["C5", "minLength client de 6 sur la confirmation du mot de passe (serveur = 8)",
         "Faible", "R4 : harmoniser à 8 côté client"],
        ["C6", "Validation des certificats SMTP désactivée (rejectUnauthorized à false)",
         "Informationnel (hérité)", "R5 : option explicite, stricte par défaut"],
        ["P1", "Aucun secret, aucune donnée sensible, aucun code hostile dans l'archive",
         "Positif", "Consolider : conserver ce niveau d'hygiène"],
        ["P2", "Politique mots de passe active et prouvée dynamiquement ; e-mail d'accès "
               "allégé ; correctif nodemailer 7 sain", "Positif",
         "Reporter ces évolutions dans le tronc officiel"],
    ],
    [0.06, 0.42, 0.16, 0.36],
    align_map=["c", "l", "c", "l"],
    caption="Registre des constats, gravités et recommandations.")

h2(story, "7.1", "Recommandation prioritaire R1", P(
    "Deux voies s'offrent à vous, et la seconde est recommandée. <b>Voie A — corriger la "
    "branche CORRIGÉ</b> : réintroduire dans /api/auth/signup l'appel à une politique de "
    "complexité du code (celle de 0.2.24 peut être reprise telle quelle), restaurer "
    "l'avertissement de l'option 7, puis rejouer une campagne de tests. C'est rapide, mais "
    "elle laisse coexister deux implémentations divergentes de la même règle, avec le risque "
    "récurrent de confusion que cet audit vient d'illustrer. <b>Voie B — revenir au tronc "
    "officiel 0.2.24 et y reporter les apports de la branche</b> : le correctif nodemailer 7 "
    "(package.json et package-lock.json), l'e-mail allégé (mailer.ts, mail-config, "
    "portal-access, mail-panel), et la prise en charge des serveurs SMTP personnalisés. "
    "0.2.24 conserve ainsi son contrôle complet du code d'activation, sa suite test94 et sa "
    "documentation, tout en récupérant les améliorations. Cette voie produit une version "
    "0.2.25 unique, testée, et supprime la cause racine de la divergence."))

h2(story, "7.2", "Autres recommandations", P(
    "<b>R2</b> découle de R1 : une fois la fusion réalisée, la chaîne d'emballage doit "
    "embarquer la suite test94 et la documentation à jour, de sorte que toute livraison "
    "future prouve elle-même sa conformité. <b>R3</b> est une correction de deux minutes : "
    "exclure le fichier parasite du paquetage (et de préférence le retirer aussi de la "
    "chaîne officielle). <b>R4</b> harmonise le minLength client de la confirmation à 8 "
    "pour éviter la dissonance visuelle. <b>R5</b> propose de rendre la validation TLS de "
    "SMTP stricte par défaut, avec une case explicite « accepter les certificats "
    "auto-signés (réseau interne) » dans le panneau SMTP — la sécurité du canal qui "
    "transporte le mot de passe initial mérite ce réglage visible plutôt qu'un contournement "
    "global silencieux. Enfin, quel que soit votre choix, pensez à faire un « vrai "
    "redémarrage » (ARRETER puis DEMARRER) après tout changement de .env : le rappel Task 93 "
    "reste la première cause de faux « code incorrect »."))

# ================= 8. CONCLUSION =================
h1(story, 8, "Conclusion", P(
    "L'archive auto-rh-scripts-site-web-CORRIGE (1).zip est <b>sûre à employer</b> au sens "
    "strict : aucun secret, aucune donnée personnelle, aucune base, aucune altération "
    "malveillante, intégrité ZIP parfaite, et un correctif de dépendances légitime et "
    "documenté. Elle applique réellement la politique de complexité que vous avez demandée "
    "pour les <b>mots de passe</b>, comme l'a prouvé le refus dynamique d'un mot de passe "
    "faible. Elle porte en outre des améliorations utiles — e-mail d'accès allégé, serveurs "
    "SMTP d'entreprise, installation npm débloquée."))

story.append(P(
    "En revanche, elle <b>ne satisfait plus intégralement votre exigence Task 94</b> : le "
    "contrôle de complexité du <b>code d'activation à la saisie</b> a disparu de la route "
    "d'inscription, ce qui autorise de nouveau les anciens codes faibles et prive "
    "l'administrateur du diagnostic qui l'invitait à les renouveler. Ce constat, démontré "
    "par la création effective d'un compte avec un code faible dans le bac à sable, fait de "
    "la voie B (fusion dans le tronc officiel 0.2.24 pour produire une version 0.2.25 unique) "
    "la recommandation centrale de cet audit. Sur simple demande, la correction peut être "
    "appliquée, testée et redelivrée selon le processus standard."))

# ---- Construction ----
doc = TocDocTemplate(
    OUT_BODY, pagesize=A4,
    leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN + 8, bottomMargin=MARGIN + 8,
    title=DOC_TITLE, author="AutoRH", creator="AutoRH",
    subject="Audit de sécurité de l'archive ZIP CORRIGÉ Auto-RH",
)
doc.multiBuild(story, onFirstPage=on_page, onLaterPages=on_page)
print("Corps généré :", OUT_BODY)
