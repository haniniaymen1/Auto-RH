#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 254 — README officiel AutoRH, édition resserrée v0.2.174.

Remplace l'édition v0.2.133 : mise à jour complète au code livré v0.2.174 —
les acquis de l'édition v0.2.133 sont conservés (v0.2.126 signature réservée
au superadministrateur, v0.2.128 cachet, v0.2.129 mot de passe initial 15
minutes, v0.2.131-133 managers côté employés) et documentent désormais :
  • v0.2.165 : curseurs UID IMAP persistants (remplacent le filtre « non lu »,
    survivent aux redémarrages, dédoublonnage Message-ID) ;
  • v0.2.168 (Task 181) : VALIDATION À DEUX ÉTAPES des congés et
    autorisations — matrice calculerStatutFinalDeuxEtapes (acceptation
    manager ET service RH), PDF signé UNIQUEMENT après double acceptation,
    REFUS immédiat du premier décideur qui refuse ; CORRECTIF du statut
    manager resté « En attente » quand le RH répond en premier ;
  • v0.2.168 → v0.2.172 : pièces jointes des réponses Acceptée/Refusée
    transmises au demandeur AVEC le PDF signé — cumul des deux étapes,
    dédoublonnage, octets exacts, aucune perte (certifié campagne réelle
    42/42) ;
  • v0.2.172 : durcissements réseau IMAP (timeouts connexion 20 s, socket
    120 s, relâchement forcé du verrou de polling) ;
  • v0.2.173 : campagne E2E des 4 scénarios obligatoires (RH d'abord /
    manager d'abord / refus manager / refus RH) en conditions réelles
    Gmail/Zoho — 36 vérifications OK.

Sorties :
  servicerh-readme-technique.pdf (racine)
  download/servicerh-readme-technique.pdf
  download/servicerh-readme-technique-v0.2.174.pdf
"""
import os
import shutil
import hashlib

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether,
    HRFlowable,
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

RACINE = "/home/z/my-project"
PDF_CIBLE = os.path.join(RACINE, "servicerh-readme-technique.pdf")
PDF_DL = os.path.join(RACINE, "download", "servicerh-readme-technique.pdf")
PDF_VERSIONNE = os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.174.pdf")
EDITION = "v0.2.174"

# ---- Polices (mêmes familles que la série des README officiels) ------------
pdfmetrics.registerFont(TTFont("Serif", "/usr/share/fonts/truetype/freefont/FreeSerif.ttf"))
pdfmetrics.registerFont(TTFont("Serif-B", "/usr/share/fonts/truetype/freefont/FreeSerifBold.ttf"))
pdfmetrics.registerFont(TTFont("Serif-I", "/usr/share/fonts/truetype/freefont/FreeSerifItalic.ttf"))
pdfmetrics.registerFont(TTFont("Mono", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"))

LARG, HAUT = A4
MARGE_G, MARGE_D, MARGE_H, MARGE_B = 2.0 * cm, 2.0 * cm, 1.9 * cm, 1.8 * cm
LARGE_UTILE = LARG - MARGE_G - MARGE_D

# ---- Palette (identité établie de la série AutoRH) ----------------------
ENCRE = colors.HexColor("#1a1a1a")
GRIS = colors.HexColor("#555555")
ACCENT = colors.HexColor("#0f4c46")
ACCENT_CLAIR = colors.HexColor("#eef4f3")
LIGNE = colors.HexColor("#c9d4d2")
FOND_ENTETE = colors.HexColor("#0f4c46")
FOND_GROUPE = colors.HexColor("#eef4f3")
FOND_CODE = colors.HexColor("#f4f6f5")
VERT_OUI = colors.HexColor("#1c6b40")
ROUGE_NON = colors.HexColor("#9c2f2f")
OR = colors.HexColor("#8a5a00")

# ---- Styles ----------------------------------------------------------------
S = {}
S["bande"] = ParagraphStyle("bande", fontName="Serif-B", fontSize=9.5, leading=13,
                            textColor=ACCENT, alignment=TA_CENTER, spaceAfter=10)
S["titre"] = ParagraphStyle("titre", fontName="Serif-B", fontSize=30, leading=34,
                            textColor=ENCRE, spaceAfter=2)
S["sous-titre"] = ParagraphStyle("sous-titre", fontName="Serif", fontSize=14.5, leading=19,
                                 textColor=GRIS, spaceAfter=12)
S["intro"] = ParagraphStyle("intro", fontName="Serif", fontSize=10.2, leading=15.2,
                            textColor=ENCRE, spaceAfter=10)
S["badges"] = ParagraphStyle("badges", fontName="Serif-B", fontSize=9.6, leading=14,
                             textColor=ACCENT, alignment=TA_CENTER, spaceBefore=4, spaceAfter=12)
S["h1"] = ParagraphStyle("h1", fontName="Serif-B", fontSize=17.5, leading=21.5,
                         textColor=ACCENT, spaceBefore=16, spaceAfter=7)
S["h2"] = ParagraphStyle("h2", fontName="Serif-B", fontSize=12.6, leading=16,
                         textColor=ENCRE, spaceBefore=11, spaceAfter=5)
S["corps"] = ParagraphStyle("corps", fontName="Serif", fontSize=9.8, leading=14.3,
                            textColor=ENCRE, spaceAfter=5)
S["bul"] = ParagraphStyle("bul", fontName="Serif", fontSize=9.8, leading=14.2,
                          textColor=ENCRE, leftIndent=14, bulletIndent=3, spaceAfter=4.5)
S["code"] = ParagraphStyle("code", fontName="Mono", fontSize=8.6, leading=12.6,
                           textColor=ENCRE, leftIndent=10, spaceAfter=2)
S["bloc-code"] = ParagraphStyle("bloc-code", fontName="Mono", fontSize=8.8, leading=13.2,
                                textColor=ENCRE, backColor=FOND_CODE,
                                borderPadding=6, leftIndent=8, spaceBefore=3, spaceAfter=8)
S["legende"] = ParagraphStyle("legende", fontName="Serif-I", fontSize=8.6, leading=12,
                              textColor=GRIS, spaceBefore=2.5, spaceAfter=9)
S["cell"] = ParagraphStyle("cell", fontName="Serif", fontSize=9.0, leading=12.6, textColor=ENCRE)
S["cell-b"] = ParagraphStyle("cell-b", fontName="Serif-B", fontSize=9.0, leading=12.6, textColor=ENCRE)
S["cell-c"] = ParagraphStyle("cell-c", fontName="Serif-B", fontSize=9.0, leading=12.6,
                             textColor=ENCRE, alignment=TA_CENTER)
S["cell-tete"] = ParagraphStyle("cell-tete", fontName="Serif-B", fontSize=9.0, leading=12.4,
                                textColor=colors.white)
S["cell-tete-c"] = ParagraphStyle("cell-tete-c", fontName="Serif-B", fontSize=9.0, leading=12.4,
                                  textColor=colors.white, alignment=TA_CENTER)
S["pivot"] = ParagraphStyle("pivot", fontName="Serif-B", fontSize=9.2, leading=12.8,
                            textColor=ACCENT)


def h1(txt):
    return Paragraph(txt, S["h1"])


def h2(txt):
    return Paragraph(txt, S["h2"])


def p(txt, style="corps"):
    return Paragraph(txt, S[style])


def bul(txt):
    return Paragraph(txt, S["bul"], bulletText="•")


def code(txt):
    return Paragraph(txt, S["bloc-code"])


def legende(txt):
    return Paragraph(txt, S["legende"])


def pivot(txt):
    return Paragraph(txt, S["pivot"])


def tableau(entetes, lignes, largeurs, centre=None, style_sup=None):
    """Tableau sobre : entête vert foncé, lignes alternées, cellules Paragraph."""
    centre = centre or []
    data = [[Paragraph(e, S["cell-tete-c"] if i in centre else S["cell-tete"])
             for i, e in enumerate(entetes)]]
    for lg in lignes:
        data.append([Paragraph(c, S["cell-c"] if i in centre else S["cell"])
                     for i, c in enumerate(lg)])
    total = sum(largeurs)
    if total > LARGE_UTILE:
        largeurs = [w * LARGE_UTILE / total for w in largeurs]
    t = Table(data, colWidths=largeurs, repeatRows=1, hAlign="LEFT")
    cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), FOND_ENTETE),
        ("GRID", (0, 0), (-1, -1), 0.5, LIGNE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4.5),
    ]
    for i in range(1, len(data)):
        cmds.append(("BACKGROUND", (0, i), (-1, i),
                     colors.white if i % 2 == 1 else ACCENT_CLAIR))
    if style_sup:
        cmds.extend(style_sup)
    t.setStyle(TableStyle(cmds))
    return t


def filet():
    return HRFlowable(width="100%", thickness=0.7, color=LIGNE, spaceBefore=2, spaceAfter=8)


def espacer(txt):
    return " ".join(list(txt.replace("·", "·")))


# === CONTENU (injecté en partie 2/3/4) ===
STORY = []


def page_couverture():
    STORY.append(Paragraph(espacer("README OFFICIEL · ÉDITION RESSERRÉE · V0.2.174"), S["bande"]))
    STORY.append(p("AutoRH", "titre"))
    STORY.append(p("Fiches de paie, demandes administratives et documents RH", "sous-titre"))
    STORY.append(p(
        "Documentation technique resserrée à l'essentiel, fondée sur le code livré v0.2.174 : architecture "
        "à deux services (ports 4000 et 4001), fonctionnalités, installation, sécurité outillée, capacité "
        "mesurée à 240 000 fiches (20 ans), exploitation. Renommée « AutoRH » (anciennement Auto-RH), "
        "l'application couvre les fiches de paie ET les demandes administratives. Les demandes de congé et "
        "d'autorisation de sortie suivent une <b>VALIDATION À DEUX ÉTAPES</b> : le manager responsable est "
        "aiguillé automatiquement (plus aucun « Responsable N+1 » saisi — v0.2.132) avec copie informative "
        "au service RH et confirmation à l'employé ; le PDF de décision <b>signé électroniquement</b> n'est "
        "envoyé que lorsque le manager <b>ET</b> le service RH ont accepté (quel que soit l'ordre des "
        "réponses), tandis qu'un refus de l'un des deux déclenche la réponse immédiate, sans attendre "
        "l'autre (v0.2.168 — correctif inclus du statut manager resté « En attente » lorsque le service RH "
        "répond en premier). Les pièces jointes fournies par le manager ou le service RH dans leur réponse "
        "sont toutes transmises à l'employé avec le PDF — cumul des deux étapes, aucune perte "
        "(v0.2.168 → v0.2.172, certifié en conditions réelles Gmail/Zoho). Le mot de passe initial des "
        "comptes RH/IT est <b>valable 15 minutes</b> (v0.2.129). La signature cryptographique PAdES est "
        "intégrée au serveur : module « API de certification &amp; signature » configuré par le "
        "superadministrateur seul (v0.2.126), fiches signées automatiquement à l'import, réponses signées "
        "avant envoi, documents signés téléchargeables par l'employé, cachet « SIGNATURE ÉLECTRONIQUE » au "
        "contenu choisi (v0.2.128). Annexes : matrice des droits et map de routage des e-mails des "
        "demandes."))
    STORY.append(p("Administration 4000  ·  Portail 4001  ·  Pont d'aperçu 3000  ·  CIN 8 chiffres  ·  "
                   "AES-256-GCM  ·  240 000 fiches · 20 ans", "badges"))
    STORY.append(filet())
    STORY.append(p("<b>Sommaire</b>", "corps"))
    sommaire = [
        "1. Présentation et architecture — deux services, deux ports, technologies, structure du projet",
        "2. Fonctionnalités — import, extraction, portail, comptes et managers, e-mails, demandes, signature",
        "3. Installation et démarrage — prérequis, lanceurs, réseau local, secrets",
        "4. Sécurité — mesures, chiffrement AES-256-GCM, procédure pas à pas, rotation de clé",
        "5. Capacité, matériel et durée de vie — mesures à 240 000 fiches, projection sur 20 ans",
        "6. Exploitation et dépannage — commandes, routine, remèdes vérifiés",
        "7. Recommandations",
        "Annexe A — Matrice des droits des rôles (SuperAdmin, RH, IT ; portail employé)",
        "Annexe B — Map de routage des e-mails des demandes (5 types, champs de configuration)",
    ]
    for s_ in sommaire:
        STORY.append(p(s_, "bul"))
    STORY.append(Spacer(1, 6))
    STORY.append(filet())
    blocs = [
        ("D I F F U S I O N",
         "Les quatre livrables sont téléchargeables sans connexion depuis l'administration : "
         "/api/download-readme (présent README), /api/download-scripts (archive du code), "
         "/api/download-matrice (matrice des rôles Excel), /api/download-routage (map de routage des "
         "e-mails)."),
        ("S O U R C E S",
         "Code source livré v0.2.174 · README-DEPLOIEMENT-LOCAL.md (guide d'installation illustré) · "
         "notes LIRE-MOI-CORRECTIF-*.txt (détail de chaque livraison)."),
        ("D A T E   D ' É D I T I O N",
         "10 octobre 2026 — maintenue à jour au fil des livraisons (recommandation R21)."),
    ]
    for titre, corps in blocs:
        STORY.append(p(titre, "pivot"))
        STORY.append(p(corps))
    STORY.append(Spacer(1, 8))
    STORY.append(p("F I C H E S   D E   P A I E   E T   D E M A N D E S   A D M I N I S T R A T I V E S   ·   F R",
                   "badges"))


def section_1():
    STORY.append(h1("1. Présentation et architecture"))
    STORY.append(p(
        "AutoRH (anciennement Auto-RH) est une application web de gestion des services RH destinée à un "
        "service RH assisté par l'informatique : fiches de paie ET demandes administratives. Le service RH "
        "importe en masse les bulletins produits par Sage (PDF, images, archives ZIP, classeurs Excel, "
        "documents Word) ; l'application détecte automatiquement le CIN, le nom de l'employé, la période, le "
        "net à payer et le matricule dans le contenu des documents, puis indexe chaque fiche dans une base "
        "SQLite. Chaque employé consulte ensuite ses propres fiches — signées électroniquement — et suit ses "
        "demandes (congés, autorisations, attestations, parrainage) via un portail sécurisé par CIN, mot de "
        "passe et code OTP. Deux services cohabitent sur la même machine et partagent la base et le stockage "
        "chiffré :"))
    STORY.append(tableau(
        ["Service", "Port et surcharge", "Rôle"],
        [["Administration (RH, IT, SuperAdmin)",
          "4000 — PORT ou AUTO_RH_PORT_ADMIN",
          "Serveur Next.js standalone : import, recherche paginée, gestion des fiches, comptes et managers, "
          "configuration SMTP (scripts/start-prod.js)."],
         ["Portail employés",
          "4001 — PORTAL_PORT ou AUTO_RH_PORT_PORTAIL",
          "Serveur Node HTTP natif (scripts/portail-server.js) : consultation après CIN + mot de passe + code "
          "OTP, fiches du CIN de session uniquement, demandes administratives."],
         ["Pont d'aperçu",
          "3000 — AUTO_RH_PORT_PONT (désactivable)",
          "Pont 3000 → administration 4000 pour l'entrée Caddy 81 : aperçu et téléchargements publics "
          "(/api/download-*) sans connexion."]],
        [3.1 * cm, 4.4 * cm, LARGE_UTILE - 7.5 * cm]))
    STORY.append(legende(
        "Tableau 1.1 — Les services livrés. Écoute 0.0.0.0 : ouvrir 4000 et 4001 en TCP dans le pare-feu ; "
        "les services partagent db/custom.db et storage/."))
    STORY.append(p(
        "Le stockage est doublement chiffré : les champs sensibles de la base le sont en AES-256-GCM par un "
        "middleware Prisma (src/lib/db-crypto.ts) et chaque fichier de fiche l'est sur disque "
        "(src/lib/storage-crypto.ts, en-tête PAIESAGE1) — tampons importés, certificats et documents des "
        "demandes compris. Conséquence opérationnelle majeure : la perte du fichier .env (clés AUTH_SECRET "
        "et AUTO_RH_STORAGE_KEY) rend les fiches mathématiquement irrécupérables — .env doit donc être "
        "sauvegardé avec les données (sections 3, 4 et 6)."))
    STORY.append(h2("Technologies"))
    STORY.append(tableau(
        ["Composant", "Rôle dans AutoRH"],
        [["Next.js / React (build standalone, App Router)",
          "Framework de l'administration : import, recherche paginée, gestion des fiches, comptes, "
          "configuration SMTP et du module de signature."],
         ["Prisma + SQLite (db/custom.db)",
          "Base de données embarquée — aucune autre base à installer."],
         ["Tailwind CSS 4 + shadcn/ui",
          "Interface responsive mobile (thème blanc + vert : boutons vert émeraude #10b981, fond blanc cassé vert #f6fef9)."],
         ["tesseract.js + sharp",
          "OCR des fiches peu textuelles (modèle français local)."],
         ["pdf-parse, pdf-lib, mammoth, exceljs, xlsx, jszip",
          "Extraction PDF, Word, Excel et archives ZIP ; découpage des fichiers multi-fiches."],
         ["nodemailer, qrcode",
          "Envoi SMTP (accès portail, demandes administratives, comptes) et QR codes TOTP."],
         ["node:crypto, node-forge, jsqr",
          "Signature cryptographique PAdES (PKCS#7/CMS, 100 % node sans openssl) et lecture des QR "
          "d'authenticator pour l'enrôlement OTP."]],
        [6.4 * cm, LARGE_UTILE - 6.4 * cm]))
    STORY.append(legende(
        "Tableau 1.2 — Technologies embarquées (versions exactes fixées par package-lock.json ; "
        "conteneurisation Docker node:20-slim en option)."))
    STORY.append(h2("Structure du projet"))
    STORY.append(p(
        "L'archive ne contient ni node_modules (npm install obligatoire à la première mise en service) ni "
        "les dossiers d'exécution (db, storage, logs, backups), créés au premier démarrage. Le guide pas-à-"
        "pas illustré est README-DEPLOIEMENT-LOCAL.md, à la racine de l'archive ; chaque correctif livré "
        "est documenté dans une note LIRE-MOI-CORRECTIF-*.txt embarquée."))
    STORY.append(code(
        "servicerh/<br/>"
        "+-- package.json / next.config.ts / Dockerfile / docker-compose.yml / lanceurs<br/>"
        "+-- README-DEPLOIEMENT-LOCAL.md ; servicerh-readme-technique.pdf<br/>"
        "+-- prisma/schema.prisma&nbsp;&nbsp;&nbsp;# Payslip (+cinIndex/nomIndex), PayslipCinToken,<br/>"
        "|&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;# User (+passwordExpiresAt, isManager/managerId),<br/>"
        "|&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;# PasswordHistory, ImportLog, PortalAccess,<br/>"
        "|&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;# MailConfig, DemandeAdministrative,<br/>"
        "|&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;# SignatureConfig, SignatureConfigReponse,<br/>"
        "|&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;# SignatureApiConfig, SignatureApiDocument<br/>"
        "+-- src/ : middleware.ts (protection globale) ; instrumentation.ts (balayage<br/>"
        "|&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;des comptes non activés) ; app/api/ (auth, payslips, portal-access,<br/>"
        "|&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;mail-config, demandes, signature-config, signature-api, users, stats,<br/>"
        "|&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;download-*) ; lib/ (auth, db-crypto, storage-crypto, payslip-extractor,<br/>"
        "|&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;payslip-index, payslip-ocr, splitters PDF/Excel/Word, mailer, stamp,<br/>"
        "|&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;certificat, cms-pur, mot-de-passe-initial)<br/>"
        "+-- scripts/ : start-prod.js, auto-rh.js, portail-server.js,<br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;sauvegarde-bd.js, chiffrer-base.js, chiffrer-storage.js,<br/>"
        "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;creer-superadmin.js<br/>"
        "# créés à l'exécution : db/custom.db | storage/ | logs/ | backups/"))
    STORY.append(h2("Temps de développement et de test"))
    STORY.append(p(
        "Le projet a été réalisé du 12 septembre au 3 octobre 2026, en cycles itératifs courts : 55 "
        "chantiers documentés dans le journal de projet et environ 135 versions numérotées livrées "
        "(de v0.2.1 à v0.2.135), chaque version passant par un build de production, des tests de fumée "
        "sur les trois services et des vérifications ciblées avant emballage. Le volume livré s'établit "
        "à environ 52 500 lignes de code applicatif, 36 points d'entrée API, 63 composants d'interface, "
        "13 modèles de données et 548 scripts d'exploitation, dont 257 dédiés aux tests, vérifications, "
        "audits et diagnostics."))
    STORY.append(tableau(
        ["Indicateur", "Valeur"],
        [["Période de réalisation",
          "Du 12 septembre au 3 octobre 2026&nbsp;— 21 jours calendaires, plusieurs livraisons par jour."],
         ["Chantiers et versions",
          "55 chantiers documentés ; environ 135 versions numérotées (v0.2.1 à v0.2.135)."],
         ["Volume livré",
          "Environ 52 500 lignes de code applicatif ; 36 points d'entrée API ; 63 composants "
          "d'interface ; 13 modèles de données ; 548 scripts livrés."],
         ["Temps de développement (estimation)",
          "Environ 65 à 90 jours-homme : conception, développement, corrections, documentation."],
         ["Temps de test et de validation (estimation)",
          "Environ 25 à 40 jours-homme, soit près de 30 % de l'effort total."],
         ["Effort total équivalent (estimation)",
          "Environ 90 à 130 jours-homme&nbsp;— de l'ordre de 4 à 6 mois-homme."]],
        [5.8 * cm, LARGE_UTILE - 5.8 * cm]))
    STORY.append(legende(
        "Tableau 1.3 — Temps de développement et de test. Volumes relevés dans l'archive livrée ; "
        "estimations d'effort à titre indicatif (ordres de grandeur)."))
    STORY.append(p(
        "Méthode d'estimation : les durées sont établies par analogie&nbsp;— chaque module livré "
        "(authentification et sessions, portail OTP, import multi-formats et OCR, chiffrement "
        "AES-256-GCM de la base et des fichiers, messagerie SMTP et routage des demandes, signature "
        "PAdES, sauvegardes, documentation) est ramené à l'effort habituellement nécessaire pour le "
        "concevoir, le coder, le déboguer et le documenter dans une petite équipe. Il s'agit d'ordres "
        "de grandeur destinés à dimensionner une reprise ou une extension du projet, et non d'un "
        "relevé de temps passé."))
    STORY.append(p(
        "La part des tests est détaillée parce qu'elle structure la qualité livrée : chaque version a "
        "été soumise au même verrouillage&nbsp;— build de production réussi, tests de fumée sur les trois "
        "services (ports 4000, 4001 et 3000), scénarios d'API, parcours E2E automatisés au navigateur, "
        "contrôles visuels des pages sensibles et vérification documentaire. Cette pratique explique "
        "les 257 scripts de test, de vérification, d'audit et de diagnostic livrés dans le dossier "
        "scripts/ de l'archive."))
    STORY.append(Spacer(1, 4))


def section_2():
    STORY.append(h1("2. Fonctionnalités"))
    STORY.append(p(
        "La liste ci-dessous recense les fonctionnalités vérifiables dans le code livré et décrit leur "
        "comportement tel qu'il se manifeste à l'écran et dans les API. L'installation est détaillée en "
        "section 3, l'exploitation quotidienne en section 6."))
    STORY.append(h2("Import multi-formats, extraction et découpage"))
    STORY.append(bul(
        "<b>Formats acceptés</b> : PDF, PNG, JPG, ZIP, XLSX/XLSM/XLS, DOCX ; tout autre format est refusé "
        "avec message explicite. Envoi par lots de 5 fichiers légers, fichiers de plus de 20 Mo envoyés "
        "seuls ; limite de 500 Mo par fichier, erreur 413 explicite au-delà. Archives ZIP : profondeur 2, "
        "300 entrées maximum, formats internes limités aux types acceptés. Journal d'import systématique : "
        "une ligne ImportLog par fichier traité, avec le taux de fiabilité des CIN du lot (section 5)."))
    STORY.append(bul(
        "<b>CIN tunisienne</b> : exactement 8 chiffres isolés (garde anti numéro CNSS) ; la carte "
        "biométrique récente à 9 chiffres est également reconnue. La recherche exige le numéro COMPLET — "
        "séparateurs intérieurs et casse tolérés, jamais une partie. Détection par familles de motifs "
        "(libellé « CIN », ligne suivante, colonne de tableau, formats tunisien et marocain) avec exclusion "
        "des faux positifs ; nom, période (plus de 10 formats de dates), net à payer et matricule (garde "
        "anti « Matricule fiscal »)."))
    STORY.append(bul(
        "<b>OCR adaptatif</b> : si le texte extrait est trop court, lecture page par page (Tesseract.js, "
        "modèle français local) puis seconde passe haute lisibilité si des champs manquent."))
    STORY.append(bul(
        "<b>Découpage des fichiers multi-fiches</b> : un PDF multi-bulletins (y compris scanné), un "
        "classeur Excel ou un document Word regroupant plusieurs employés est découpé en une fiche "
        "individuelle par employé, avec son CIN, son nom et sa période. Copies identiques (même bulletin en "
        "N exemplaires) séparées automatiquement ; les fichiers fusionnés importés par une ancienne version "
        "peuvent être retraités par les scripts scinder-* (section 6)."))
    STORY.append(h2("Recherche à grande échelle et portail employés"))
    STORY.append(bul(
        "<b>Liste d'administration paginée côté serveur</b> (100 fiches par page, plafond de l'API à "
        "1 000) et recherche CIN par index SQL déterministe chiffré : parcours d'index, jamais de balayage "
        "complet de la base ; fluide à 240 000 fiches (mesures en section 5). Garde-fous : recherche "
        "refusée avec message clair tant que l'indexation initiale est incomplète ; CIN de moins de "
        "6 caractères refusé sur une base volumineuse."))
    STORY.append(bul(
        "<b>Portail employés</b> : connexion par CIN + mot de passe + code TOTP — QR d'enrôlement affiché "
        "une seule fois à la première connexion, puis code à 6 chiffres demandé à chaque connexion. Liste "
        "de toutes les fiches du CIN de session, paginée ou illimitée (« Tout afficher ») ; chaque fiche "
        "s'ouvre ou se télécharge avec sa COPIE SIGNÉE conservée par le registre (PAdES — v0.2.118), le "
        "tampon signature/QR éventuel étant appliqué à la volée. Demandes administratives et documents "
        "reçus accessibles depuis le portail ; aucune fiche d'un autre employé n'est accessible (contrôle "
        "côté serveur)."))
    STORY.append(h2("Comptes, managers, e-mails et demandes administratives"))
    STORY.append(bul(
        "<b>Quatre rôles appliqués côté serveur</b> : SUPERADMIN (comptes, déverrouillages, périmètre "
        "complet), IT (messagerie, comptes en consultation), RH (imports, fiches, accès portail, demandes, "
        "tampon) et employé (portail restreint à son CIN) — matrice complète en annexe A. Les comptes RH et "
        "IT sont créés exclusivement par le superadministrateur (onglet Utilisateurs) ; leur création "
        "déclenche un E-MAIL AUTOMATIQUE au nouvel utilisateur (identifiant, mot de passe initial, adresse "
        "d'accès) ; changement de mot de passe imposé à la première connexion puis à chaque expiration "
        "(15 jours)."))
    STORY.append(bul(
        "<b>Mot de passe initial valable 15 MINUTES (v0.2.129)</b> : sans connexion dans le délai, le "
        "compte IT/RH est DÉSACTIVÉ AUTOMATIQUEMENT (balayage interne toutes les 30 secondes et contrôle "
        "immédiat à la connexion — l'ancien mot de passe n'est plus accepté, code COMPTE_EXPIRE_INITIAL). "
        "Le superadministrateur le RÉACTIVE par un bouton dédié : le système génère un NOUVEAU mot de passe "
        "aléatoire UNIQUE — différent de TOUS les précédents, historique complet en base (PasswordHistory) — "
        "envoyé par e-mail et soumis au même délai. Aucune réutilisation d'un ancien mot de passe n'est "
        "possible (création, réinitialisation, changement personnel — tout est historisé). L'onglet "
        "Utilisateurs affiche les statuts « Actif », « En attente — expire dans N min », « Délai expiré — "
        "désactivé », « Désactivé » ; les comptes superadministrateurs ne sont pas soumis à ce délai."))
    STORY.append(bul(
        "<b>Désignation des managers dans l'onglet « Accès portail » (v0.2.131 → v0.2.133)</b> : la case à "
        "cocher « Manager » et la liste déroulante « Manager responsable » sont proposées pour les "
        "EMPLOYÉS — dans la fenêtre « Mot de passe initial — CIN » (création/réinitialisation d'accès) et, "
        "depuis la v0.2.133, via le bouton « Manager » du tableau qui ouvre la fenêtre dédiée « Modifier le "
        "manager » : la modification s'effectue SANS réinitialiser le mot de passe (aucun mot de passe "
        "émis, sessions intactes, l'employé continue de se connecter avec le sien). Chaque changement est "
        "ENREGISTRÉ AUTOMATIQUEMENT puis la liste est rechargée — elle se remplit AU FUR ET À MESURE que "
        "des employés sont cochés « Manager ». Garde-fous serveur : responsable obligatoirement ACTIF et "
        "coché « Manager », auto-référence impossible, décochage d'un manager remettant ses subordonnés à "
        "« Aucun ». La case « Manager » a été RETIRÉE de la fenêtre « Créer un compte utilisateur » "
        "(la désignation vise désormais les employés du portail, et plus les comptes d'administration)."))
    STORY.append(bul(
        "<b>E-mails SMTP</b> : panneau réservé aux rôles IT et SUPERADMIN — préréglage Gmail (port 465, "
        "mot de passe d'application de 16 caractères obligatoire) et serveur personnalisé (587 par défaut) ; "
        "sécurité déduite du port (465 = SSL/TLS direct, tout autre port = STARTTLS/plain). Identifiants "
        "chiffrés en base (le mot de passe n'est jamais renvoyé à l'interface) ; chaque tentative est "
        "journalisée dans logs/journal-emails.log avec la réponse SMTP brute."))
    STORY.append(bul(
        "<b>Routage des demandes</b> : une adresse e-mail DÉDIÉE par type de demande avec repli "
        "systématique sur la boîte RH et confirmation automatique au demandeur — map complète en annexe B. "
        "Depuis la v0.2.132, les demandes de congé et d'autorisation de sortie sont adressées au MANAGER "
        "RESPONSABLE de l'employé (affecté par le RH dans l'onglet Accès portail — plus aucun champ "
        "« Responsable N+1 » saisi par l'employé) avec copie à l'adresse dédiée ; réception des réponses du "
        "RH/du manager par IMAP, pièces jointes rattachées automatiquement à la demande. Depuis la "
        "v0.2.168, ces deux types suivent une VALIDATION À DEUX ÉTAPES (manager puis service RH) détaillée "
        "dans les deux encadrés suivants."))
    STORY.append(bul(
        "<b>Demandes administratives</b> : cinq types créés depuis le portail (attestation de travail, "
        "attestation de salaire, congé, autorisation de sortie, parrainage) — les attestations ne "
        "demandent PLUS AUCUNE saisie (un seul bouton « Envoyer » ; nom, prénom et e-mail récupérés "
        "automatiquement de l'accès portail). Référence lisible unique (DEM-AAAA-NNNNN), le nom réel de "
        "l'employé (résolu depuis ses fiches) et son matricule figurent dans les e-mails. Suivi par "
        "l'employé (« Mes demandes » : En attente / Acceptée / Refusée / Information requise) et traitement "
        "par le RH ou le SuperAdmin (onglet « Demandes » : liste, compteurs, filtres, décision, demande "
        "d'information). Réponse par document : le traitant répond à l'e-mail de la demande (réception "
        "IMAP) ou importe le document depuis le détail — document chiffré, tamponné, signé, visible par "
        "l'employé dans « Mes documents » et JOINT à sa notification e-mail, pour TOUS les types. La "
        "décision — manager responsable ou service RH — porte sur « Acceptée » ou « Refusée » : statut mis "
        "à jour automatiquement par interface ou par simple réponse e-mail. L'aiguillage automatique "
        "(v0.2.132) : e-mail PRINCIPAL au manager avec la consigne « VALIDATION PAR E-MAIL », COPIE "
        "informative au service RH (adresse dédiée sinon boîte RH), CONFIRMATION avec récapitulatif à "
        "l'employé — envoi en ARRIÈRE-PLAN jamais bloquant, à défaut de manager affecté la demande est "
        "traitée par le service RH (jamais perdue). Garde-fous : plafond de demandes ouvertes par employé "
        "(anti-spam), validation des champs, aucune donnée de demande en clair en base."))
    STORY.append(bul(
        "<b>Validation à DEUX ÉTAPES des congés et autorisations (v0.2.168)</b> : la décision finale "
        "exige l'acceptation du MANAGER <b>ET</b> du service RH — la matrice calculerStatutFinalDeuxEtapes "
        "est recalculée après chaque réponse e-mail. Acceptation du manager seule ou du service RH seule : "
        "la demande reste « En attente », l'étape acquise est tracée dans « Mes demandes » (1. Manager : "
        "Acceptée / 2. Auto-RH : Acceptée) et AUCUN PDF de décision n'est envoyé tant que les deux n'ont "
        "pas accepté. Acceptation des DEUX (quel que soit l'ordre des réponses) : la demande passe "
        "« Acceptée » et le PDF de décision SIGNÉ ÉLECTRONIQUEMENT part automatiquement à l'employé. REFUS "
        "immédiat : si le manager OU le service RH répond « Refusée », la demande passe « Refusée » (libellé "
        "précis « Refusée par le Manager » / « Refusée par les RH ») et la réponse part SANS attendre "
        "l'autre décideur — une acceptation ultérieure est ignorée. CORRECTIF inclus (v0.2.168) : lorsque le "
        "service RH répond EN PREMIER, la réponse ultérieure du manager est correctement enregistrée et "
        "achève la matrice — le statut ne reste plus bloqué « En attente ». Comportement PROUVÉ en "
        "conditions réelles Gmail/Zoho (campagne v0.2.173 : RH d'abord, manager d'abord, refus dans les "
        "deux sens)."))
    STORY.append(bul(
        "<b>Pièces jointes des réponses transmises au demandeur (v0.2.168 → v0.2.172)</b> : lorsque le "
        "manager ou le service RH répond « Acceptée »/« Refusée » AVEC une ou plusieurs pièces jointes, le "
        "système détecte la réponse (IMAP), met le statut à jour, génère le PDF de décision signé, puis "
        "envoie à l'employé le PDF ET TOUTES les pièces jointes fournies — cumulées entre les deux étapes "
        "(manager + RH), dédoublonnées (noms distincts en cas de doublon), transmises à l'identique octet "
        "par octet (contrôle SHA-256), sans AUCUNE perte ; valable pour une demande ACCEPTÉE comme REFUSÉE, "
        "que la réponse provienne du RH ou du manager (certifié campagne réelle 42/42 — v0.2.172)."))
    STORY.append(h2("Signature électronique, QR code et outils d'exploitation"))
    STORY.append(bul(
        "<b>Signature et QR</b> : configuration dans la rubrique « Signature électronique &amp; QR code » — "
        "image de cachet/signature (PNG/JPEG jusqu'à 8 Mo), ligne de texte, mention légale datée, QR à "
        "quatre modes de contenu (données de la fiche avec empreinte de contrôle HMAC, URL de vérification, "
        "image fournie, texte libre). Positionnement libre : décalages horizontal/vertical sur toute la "
        "feuille, largeur/taille de 40 à 1 200 points, rotation de 0° à 360° par élément, aperçu A4 "
        "interactif avec glisser-déposer. Tous les formats tamponnés : PDF (y compris pages pivotées), "
        "images, Word et Excel — administration comme portail, avec aperçu. Configurations PROPRES pour "
        "l'Import et les Demandes/Réponses, chacune avec SON certificat de signature électronique DÉDIÉ et "
        "SON positionnement — une modification dans une section n'affecte jamais l'autre."))
    STORY.append(bul(
        "<b>Le fichier stocké n'est jamais réécrit</b> : le tampon est dessiné à la volée sur la copie "
        "servie ; en cas d'erreur de dessin, la fiche est servie sans tampon (jamais bloquant). Les images "
        "de tampon importées sont chiffrées sur le disque (storage/tampons, en-tête PAIESAGE1), comme les "
        "fiches."))
    STORY.append(bul(
        "<b>Onglet « Signature » (RH et SuperAdmin)</b> : signature électronique de TOUS les documents "
        "importés avec le certificat chargé ; le RH et le SuperAdmin y disposent aussi du panneau de "
        "configuration du cachet des réponses, l'onglet « Demandes » portant la configuration dédiée des "
        "réponses (tampon, certificat, positionnement)."))
    STORY.append(bul(
        "<b>Signature cryptographique PAdES (v0.2.114 → v0.2.128)</b> : module « API de certification &amp; "
        "signature » — certificat du serveur (mode LOCALE, moteur 100 % node : aucune dépendance à "
        "openssl) ou API externe de signature (mode API_EXTERNE : URL distinctes Test/Production, Bearer / "
        "API-Key / Basic, secret chiffré jamais renvoyé). Les fiches de paie sont signées AUTOMATIQUEMENT à "
        "l'import (cache par empreinte) et les réponses aux demandes AVANT envoi ; l'employé télécharge "
        "depuis son portail SES fiches et réponses SIGNÉES (copies signées conservées, registre "
        "consultable, vérification d'intégrité à la demande). CONFIGURATION RÉSERVÉE AU SUPERADMINISTRATEUR "
        "(v0.2.126) : le panneau du module a été retiré des paramètres du rôle IT — onglet « Paramètres » "
        "du SuperAdmin uniquement."))
    STORY.append(bul(
        "<b>Cachet « SIGNATURE ÉLECTRONIQUE » du tampon (v0.2.119 → v0.2.128)</b> : alimenté EN DIRECT par "
        "le certificat du module et TOUJOURS couvert par la signature PAdES sur les mêmes octets — si la "
        "signature échoue, le cachet est retiré (jamais un document cacheté non signé). Forme RECTANGLE ou "
        "ROND d'entreprise. Depuis la v0.2.128, AUCUNE information du certificat n'est affichée PAR DÉFAUT "
        "(mention seule) : un formulaire « Contenu du cachet — informations à afficher » permet de choisir "
        "Signataire, Organisation, Émetteur, Validité, Empreinte SHA-256 et une ligne personnalisée — "
        "interrupteurs PROPRES aux périmètres Import et Réponses."))
    STORY.append(bul(
        "<b>Outils d'exploitation intégrés</b> : chiffrement outillé chiffrer-base.js (base, idempotent, "
        "sauvegarde préalable automatique) et chiffrer-storage.js (fiches, documents des demandes, "
        "tampons) — procédure complète en section 4 ; sauvegarde de base chiffrée au format .pgb "
        "(AES-256-GCM, rotation de 10) avec options --liste, --restaurer (contrôle sha256), --garder N ; "
        "mode silencieux Windows (démarrage/arrêt/état sans fenêtre, PIDs dans logs/auto-rh-processus.json, "
        "démarrage automatique par raccourci du dossier Startup) ; sécurisation disque automatique à chaque "
        "démarrage — droits restrictifs sur .env, db, storage, logs, backups (scripts/securiser-auto.js)."))


def section_3():
    STORY.append(h1("3. Installation et démarrage"))
    STORY.append(h2("Prérequis et commandes de base"))
    STORY.append(bul(
        "Node.js 22 LTS recommandé (Node 20 est en fin de vie depuis avril 2026) ; npm inclus ; aucune "
        "autre base de données à installer (SQLite embarqué via Prisma). Connexion Internet nécessaire "
        "uniquement à la première installation (dépendances npm) ; l'application fonctionne ensuite "
        "entièrement hors ligne. Extraire l'archive servicerh-scripts-site-web.zip dans un dossier sans "
        "accents ni espaces (par exemple C:\\AutoRH). En cas d'erreur ERESOLVE au npm install : "
        "utiliser le package.json et package-lock.json livrés, supprimer node_modules et "
        "package-lock.json puis relancer (LIRE-MOI-FIX-INSTALL.txt)."))
    STORY.append(code(
        "npm install<br/>"
        "npx prisma generate &amp;&amp; npx prisma db push<br/>"
        "npm run build<br/>"
        "npm run start&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;# administration — port 4000<br/>"
        "node scripts/portail-server.js&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;# portail employés — port 4001"))
    STORY.append(h2("Lanceurs et accès réseau"))
    STORY.append(bul(
        "<b>Windows (recommandé)</b> : double-clic sur DEMARRER-SILENCIEUX-WINDOWS.vbs — préparation, "
        "raccourci de démarrage automatique, attente de l'état écrit dans logs/demarrage-etat.txt (jusqu'à "
        "20 minutes au premier lancement, temps du build) puis ouverture de http://localhost:4000 ; arrêt "
        "par ARRETER-SILENCIEUX-WINDOWS.vbs. Linux/macOS : DEMARRER-LINUX-MAC.sh (administration), "
        "DEMARRER-PORTAIL-LINUX-MAC.sh (portail) ou DEMARRER-TOUT-LINUX-MAC.sh (les deux)."))
    STORY.append(bul(
        "<b>Docker (optionnel)</b> : docker compose up --build démarre les deux services ; définir "
        "AUTH_SECRET et AUTO_RH_STORAGE_KEY dans le compose ou monter un .env restreint, sinon les "
        "sessions sont invalidées à chaque recréation du conteneur."))
    STORY.append(bul(
        "<b>Accès depuis le réseau local</b> : les deux serveurs écoutent sur 0.0.0.0 — accéder via "
        "http://192.168.x.x:4000 (administration) et :4001 (portail) ; IP du poste hébergeur : ipconfig "
        "(Windows) ou hostname -I (Linux). Si la page ne s'affiche pas depuis un autre poste : autoriser le "
        "trafic entrant TCP 4000 ET 4001 dans le pare-feu (sudo ufw allow 4000/tcp puis 4001/tcp). Demander "
        "à l'administrateur réseau un bail DHCP fixe pour que l'adresse du serveur ne change jamais."))
    STORY.append(h2("Secrets : fichier .env — mise en service et vérification"))
    STORY.append(bul(
        "Trois valeurs clés : DATABASE_URL (chemin ABSOLU vers db/custom.db, exigé par Prisma), AUTH_SECRET "
        "(généré automatiquement au premier démarrage — signature des sessions et dérivation des clés) et "
        "AUTO_RH_STORAGE_KEY (clé de chiffrement du stockage). La perte de ces clés rend les fiches "
        "irrécupérables : sauvegarder .env avec les données, dans un coffre-fort de secrets ; ne jamais le "
        "partager ni régénérer les clés sur une installation existante. Ports surchargeables : "
        "AUTO_RH_PORT_ADMIN et AUTO_RH_PORT_PORTAIL (défauts 4000 et 4001)."))
    STORY.append(bul(
        "Mise en service : CREER-SUPERADMIN-WINDOWS.bat (ou node scripts/creer-superadmin.js) crée un "
        "compte SUPERADMIN ou promeut un compte existant ; puis création du premier compte RH/IT par le "
        "superadministrateur (onglet Utilisateurs — le mot de passe initial parvenant par e-mail est "
        "valable 15 minutes, section 2), connexion, changement de mot de passe imposé. Vérifier : import du "
        "jeu d'essai test-data (20 fiches) puis recherche d'un CIN complet (une recherche partielle doit "
        "donner 0 résultat — LISEZMOI-TESTS.txt). Si la base contient des fiches antérieures à 0.2.27 : "
        "cliquer une fois « Indexer la base pour la recherche » (bandeau ambré) — idempotent, sans arrêt de "
        "service. Sauvegarde de contrôle : SAUVEGARDER-BD-WINDOWS.bat puis node scripts/sauvegarde-bd.js "
        "--liste ; conserver une copie de .env hors du serveur."))


def section_4():
    STORY.append(h1("4. Sécurité"))
    STORY.append(p(
        "Principe directeur du projet : usage en réseau interne — ne pas exposer le port 4001 sur Internet. "
        "Les mesures ci-dessous sont présentes dans le code livré ; les points restants sont explicités "
        "ensuite, puis la procédure complète de chiffrement et de déchiffrement."))
    STORY.append(h2("Mesures en place et points restants"))
    STORY.append(bul(
        "<b>Mots de passe hachés scrypt</b> (comparaison à temps constant) : 8 caractères minimum, 4 "
        "classes, expiration 15 jours pour tous les comptes avec changement forcé. Sessions admin : cookie "
        "httpOnly signé HMAC-SHA256, révoquées au changement de mot de passe (jetons liés à la version du "
        "mot de passe). Mot de passe initial des comptes IT/RH : validité 15 MINUTES puis désactivation "
        "automatique, nouveau mot de passe unique à la réactivation (historique PasswordHistory — section 2)."))
    STORY.append(bul(
        "<b>Anti force-brute</b> : 10 échecs de connexion admin par IP en 10 minutes puis 429 ; portail : "
        "5 échecs puis verrouillage persistant de 15 minutes (423) avec temporisation anti-énumération. "
        "Double authentification TOTP (RFC 6238) du portail : QR affiché une seule fois, anti-rejeu, secret "
        "de fenêtre régénéré toutes les 10 minutes."))
    STORY.append(bul(
        "<b>Journal de sécurité des authentifications (v0.2.101)</b> : logs/auth-securite.log, une ligne "
        "JSON par événement — échec de connexion, verrouillage anti force-brute, tentative sur compte "
        "désactivé, désactivation automatique d'un compte non activé (v0.2.129), connexion réussie (rôle "
        "tracé, mot de passe JAMAIS inscrit). Écriture asynchrone jamais bloquante, exploitable par grep ou "
        "un SIEM."))
    STORY.append(bul(
        "<b>Chiffrement AES-256-GCM</b> des champs sensibles de la base et de chaque fichier sur disque "
        "(en-tête PAIESAGE1), fiches, tampons, certificats et documents des demandes compris — procédure "
        "complète ci-après. Index de recherche : empreintes déterministes CHIFFRÉES uniquement — aucune "
        "valeur en clair en base, pré-filtre SQL par égalité sans déchiffrement. Le .env définit AUTH_SECRET "
        "et une AUTO_RH_STORAGE_KEY DÉDIÉE : le repli historique sur une valeur par défaut ne s'applique "
        "plus, et une rotation de clé s'effectue avec les deux outils de chiffrement (v0.2.101)."))
    STORY.append(bul(
        "<b>Verrouillage du répertoire des tampons (v0.2.102)</b> : les copies de contrôle de "
        "storage/tampons — images de tampon ET certificats importés — sont chiffrées AES-256-GCM (en-tête "
        "PAIESAGE1) ET protégées par des permissions Unix strictes : dossier en 0700, chaque fichier en "
        "0600, imposées à CHAQUE écriture. Ce dossier n'est servi par AUCUNE route HTTP (Next.js ne sert "
        "que public/) — accès vérifié 404 même avec une session valide ; même traitement pour "
        "storage/payslips et storage/documents-demandes. Le build standalone n'embarque PLUS les données : "
        "storage, db, logs et backups sont exclus de .next/standalone/."))
    STORY.append(bul(
        "<b>Secrets hors du suivi de version (v0.2.102)</b> : le fichier .env (AUTH_SECRET, "
        "AUTO_RH_STORAGE_KEY) est exclu de git après la découverte d'un commit contenant les clés — "
        "rotations exécutées avec les outils officiels, .env en droits 0600 et absent des archives livrées. "
        "Route d'import dédiée fiabilisée : /api/signature-config/certificat ne renvoie JAMAIS le mot de "
        "passe du certificat (booléen certMotDePasseEnregistre seul)."))
    STORY.append(bul(
        "<b>Autorisations API</b> : session requise partout ; IT/SUPERADMIN exigés pour les comptes, la "
        "consultation et l'écriture SMTP et le journal d'envoi ; le tampon/signature des fiches est refusé "
        "à l'IT (403 dédié FONCTIONNALITE_NON_AUTORISEE_IT) ; la configuration du module « API de "
        "certification &amp; signature » n'est exposée qu'au superadministrateur (v0.2.126) ; fiche du "
        "portail servie seulement si le CIN de session figure dans son contenu — matrice complète en "
        "annexe A. En-têtes HTTP (anti-clickjacking, nosniff, no-referrer, HSTS, Content-Security-Policy, "
        "Permissions-Policy — v0.2.101), cookies de session « Secure » automatiques dès que la requête "
        "arrive en HTTPS (x-forwarded-proto) ou sur AUTO_RH_FORCE_SECURE_COOKIES=1, validation "
        "structurelle des images, archives ZIP limitées, droits disque restrictifs appliqués "
        "automatiquement au démarrage (ACL Windows / chmod Linux) sur .env, db, storage, logs, backups."))
    STORY.append(bul(
        "<b>Points restants avant une exposition plus large</b> : HTTPS absent — prévoir un reverse proxy "
        "TLS (nginx, Caddy, IIS), les cookies « Secure » s'activant alors seuls ; docker-compose.yml ne "
        "fournit ni AUTH_SECRET ni AUTO_RH_STORAGE_KEY (monter le .env restreint ou les définir dans le "
        "compose) ; compteurs anti force-brute admin en mémoire (réinitialisés à chaque redémarrage)."))
    STORY.append(h2("Chiffrement et déchiffrement pas à pas"))
    STORY.append(p(
        "Deux modes coexistent : le mode AUTOMATIQUE — l'application chiffre à l'écriture et déchiffre à la "
        "lecture, sans aucune action de l'exploitant — et le mode MANUEL — deux outils en ligne de commande "
        "qui agissent en masse sur les fichiers ou sur la base, typiquement pour une migration, un audit ou "
        "un changement de clé. Dans les deux modes, TOUT repose sur un seul secret : celui du fichier .env "
        "situé à la racine du projet. Le secret actif est AUTO_RH_STORAGE_KEY si elle est définie, sinon "
        "AUTH_SECRET. Le secret brut n'est JAMAIS employé directement comme clé AES : la fonction scrypt "
        "l'étire en clés de 256 bits avec des sels applicatifs fixes, produisant des clés DISTINCTES par "
        "domaine — connaître une clé ne révèle ni les autres ni le secret d'origine. Deux installations "
        "partageant le même secret partagent les mêmes clés (les sels sont publics dans le code) : ne jamais "
        "transmettre le secret par chat ou e-mail, et le rotater si cela arrive."))
    STORY.append(tableau(
        ["Domaine chiffré", "Sel scrypt (dans le code)", "Fichier du code", "Format sur le disque"],
        [["Fiches de paie, documents des demandes, copies des tampons (en-tête PAIESAGE1)",
          "autorh-storage-v1", "src/lib/storage-crypto.ts",
          "[PAIESAGE1][nonce 12 o][tag 16 o][données AES-256-GCM]"],
         ["Champs sensibles de la base — IV ALÉATOIRE (préfixe encbd1:) : contenu des fiches, SMTP, TOTP, journaux",
          "autorh-db-aleatoire-v1", "src/lib/db-crypto.ts", "encbd1:iv:tag:données"],
         ["Champs à recherche par égalité — IV DÉTERMINISTE (préfixe encbd1d:) : CIN de session, e-mails",
          "autorh-db-deterministe-v1 (+ clé HMAC autorh-db-mac-v1 pour l'IV)",
          "src/lib/db-crypto.ts", "encbd1d:iv:tag:données"]],
        [4.6 * cm, 4.3 * cm, 3.2 * cm, LARGE_UTILE - 12.1 * cm]))
    STORY.append(legende(
        "Tableau 4.1 — Dérivation des clés : UN secret (.env) étiré par scrypt en QUATRE clés AES-256 "
        "distinctes. Les mots de passe ne sont ni chiffrés ni déchiffrables, par conception : ils sont "
        "HACHÉS (scrypt, sel aléatoire de 16 octets) — aucun outil ne peut les « récupérer », même avec le "
        ".env."))
    STORY.append(bul(
        "<b>Mode automatique — rien à faire</b> : fiche chiffrée AVANT écriture sur le disque "
        "(storage/payslips/), déchiffrée EN MÉMOIRE à la volée à la consultation (administration ET "
        "portail) — le fichier sur disque reste chiffré en permanence ; champs sensibles chiffrés à "
        "l'écriture par le middleware Prisma, recherche par empreintes déterministes SANS déchiffrement ; "
        "copies des tampons écrites chiffrées à l'enregistrement, avec rattrapage automatique, idempotent "
        "et journalisé, des copies plus anciennes restées en clair."))
    STORY.append(bul(
        "<b>Le cycle d'un PDF de fiche</b> : à l'IMPORT, une fois le type du fichier contrôlé, le PDF ou "
        "l'image est chiffré AVANT toute écriture — un nonce aléatoire unique de 12 octets est tiré pour "
        "CHAQUE fichier (deux fiches strictement identiques produisent donc deux fichiers chiffrés "
        "différents), AES-256-GCM chiffre le document et calcule un tag d'authenticité de 16 octets ; le "
        "fichier écrit commence par l'en-tête PAIESAGE1 : ce n'est PLUS un PDF — aucun lecteur ne peut "
        "l'ouvrir sur le disque, ni l'exploitant, ni un vol ou un prêt du disque. À la CONSULTATION, seul "
        "un point d'accès authentifié peut demander la fiche — le serveur lit le fichier chiffré, VÉRIFIE "
        "le tag d'authenticité (toute altération du disque fait échouer le déchiffrement avec une erreur "
        "explicite : le contenu altéré n'est JAMAIS servi), déchiffre EN MÉMOIRE et envoie le PDF au "
        "navigateur. Aucune copie en clair n'est écrite nulle part — ni cache disque, ni fichier "
        "temporaire."))
    STORY.append(bul(
        "<b>Compatibilité et garde-fous</b> : les fiches antérieures au chiffrement (sans en-tête "
        "PAIESAGE1) restent lues telles quelles — aucune fiche existante n'est cassée ; un fichier déjà "
        "chiffré n'est JAMAIS double-chiffré (idempotence, détecté par son en-tête) ; le disjoncteur "
        "AUTO_RH_STORAGE_DISABLE=1 désactive le chiffrement des NOUVEAUX imports (repli historique de "
        "dépannage uniquement) : le laisser DÉSACTIVÉ en exploitation ; contrôle périodique : node "
        "scripts/chiffrer-storage.js --verifier (lecture seule, serveurs en marche) doit afficher 0 fichier "
        "en clair."))
    STORY.append(bul(
        "<b>Défense en profondeur</b> : le chiffrement du PDF s'accompagne de permissions Unix strictes "
        "(dossier 0700, fichiers 0600, imposées à CHAQUE écriture), d'AUCUNE route HTTP vers les "
        "répertoires de stockage (une URL directe /storage/… renvoie 404, même avec une session valide), "
        "d'un build standalone sans les données, et d'une clé unique AUTO_RH_STORAGE_KEY conservée dans "
        "le .env en droits 0600 et hors suivi git : qui dispose du disque sans le .env ne peut rien lire."))
    STORY.append(h2("Outils manuels, rotation de clé et règles d'or"))
    STORY.append(p(
        "Outil FICHIERS (scripts\\chiffrer-storage.js) : couvre storage/payslips, storage/documents-demandes "
        "et storage/tampons (ainsi que leurs copies .next/standalone). Les fichiers DÉJÀ chiffrés sont "
        "détectés par leur en-tête et JAMAIS double-chiffrés (idempotence). À lancer depuis la racine du "
        "projet, syntaxe Windows (Linux/macOS : barres obliques normales) :"))
    STORY.append(code(
        "node scripts\\chiffrer-storage.js --verifier&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Etat sans rien modifier (SUR)<br/>"
        "node scripts\\chiffrer-storage.js&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Chiffre tout ce qui est en clair (defaut)<br/>"
        "node scripts\\chiffrer-storage.js --dechiffrer&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Dechiffre tout (retour arriere)"))
    STORY.append(p(
        "Outil BASE DE DONNÉES (scripts\\chiffrer-base.js) : migre les lignes déjà présentes dans "
        "db/custom.db (champs des fiches, accès portail TOTP, comptes RH/IT, journaux). ARRÊTER D'ABORD les "
        "serveurs : SQLite n'accepte qu'un seul écrivain à la fois. Une SAUVEGARDE AUTOMATIQUE de la base "
        "(db/custom.db.avant-chiffrement-AAAA-MM-JJ-HHMMSS) est créée AVANT toute modification, et le "
        "script est IDEMPOTENT : une valeur déjà chiffrée (préfixes encbd1:/encbd1d:) n'est jamais "
        "retouchée. Puis redémarrer. Les modes --verifier et --statut sont LECTURE SEULE : ils peuvent être "
        "lancés à tout moment, serveurs en marche, comme contrôle périodique d'hygiène."))
    STORY.append(code(
        "node scripts\\chiffrer-base.js --statut&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Etat sans rien modifier (SUR)<br/>"
        "node scripts\\chiffrer-base.js&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Chiffre toutes les lignes en clair (defaut)<br/>"
        "node scripts\\chiffrer-base.js --dechiffrer&nbsp;&nbsp;&nbsp;&nbsp;Dechiffre tout (retour arriere / rollback)"))
    STORY.append(bul(
        "<b>Rotation de la clé</b> (changer AUTH_SECRET sans perte de données) : le changer dans le .env "
        "sans préparation rend INSTANTANÉMENT illisibles les fichiers ET la base. Procédure sûre, à "
        "exécuter serveurs arrêtés — (1) vérifier l'état : --verifier et --statut doivent afficher 0 en "
        "clair (tout est chiffré avec l'ANCIENNE clé) ; (2) déchiffrer avec l'ancienne clé encore en "
        "place : chiffrer-storage.js --dechiffrer PUIS chiffrer-base.js --dechiffrer (les sauvegardes "
        "automatiques sont créées avant chaque étape) ; (3) remplacer la valeur de AUTH_SECRET dans le "
        ".env par un nouveau secret aléatoire de 64 caractères hexadécimaux (généré localement, jamais "
        "transmis en clair par chat/e-mail) et sauvegarder l'ancien .env dans un coffre-fort de mots de "
        "passe ; (4) re-chiffrer avec la nouvelle clé : chiffrer-storage.js PUIS chiffrer-base.js ; (5) "
        "redémarrer puis contrôle final : --verifier (0 en clair), --statut (tous chiffrés), import d'essai "
        "d'une fiche, consultation administration ET portail."))
    STORY.append(bul(
        "<b>Règles d'or</b> : (1) SAUVEGARDER le .env hors du serveur (coffre-fort de mots de passe) — la "
        "perte de la clé rend les données mathématiquement irrécupérables, c'est le seul incident réellement "
        "survenu sur le projet ; (2) la MÊME clé doit chiffrer et déchiffrer, sans jamais lancer d'outils en "
        "dehors de la racine du projet avec son .env ; (3) l'idempotence protège des doubles chiffrements : "
        "relancer un outil ne fait rien de dangereux ; (4) les modes --verifier et --statut sont lecture "
        "seule et peuvent servir d'audit périodique ; (5) en cas de doute, arrêter les serveurs avant toute "
        "opération sur la base."))


def section_5():
    STORY.append(h1("5. Capacité, matériel et durée de vie (20 ans)"))
    STORY.append(p(
        "Charge cible du projet : environ 1 000 employés, 1 000 fiches importées par mois et une "
        "conservation sur 20 ans, soit 240 000 fiches au terme. Les deux anciennes limites majeures sont "
        "traitées : la liste d'administration est paginée côté serveur et la recherche CIN s'effectue par "
        "index SQL déterministe chiffré. Les performances ont été mesurées à 240 000 fiches exactes sur les "
        "routes HTTP authentifiées : page de liste de 0,02 s (première page) à 0,73 s au pire (fin de "
        "table), recherche CIN à 0,64 s après le premier appel (cache à froid), mémoire du serveur stable "
        "(103 Mo au démarrage, 192 Mo après tous les scénarios, aucune fuite). Le test de charge HTTP "
        "simultanée du portail (jour de paie, 100 à 150 utilisateurs) reste à exécuter avant engagement (R1)."))
    STORY.append(tableau(
        ["Poste de stockage", "Calcul sur 240 000 fiches", "Estimation à 20 ans"],
        [["Base SQLite (fiches, index de recherche, journal d'import)",
          "8 à 14 Ko par fiche + 1 à 3 Ko d'index chiffré", "2,2 à 4,3 Go"],
         ["Fichiers PDF des bulletins (storage/payslips)",
          "100 à 500 Ko par PDF (hypothèse à confirmer par un import pilote)", "24 à 120 Go"],
         ["Journaux applicatifs (logs/*.log)",
          "croissance continue sans rotation — surveillance requise", "1 à 5 Go"],
         ["Volume vivant total", "somme des postes ci-dessus", "≈ 27 à 130 Go"],
         ["Marge interne recommandée (+ 50 %) et rotation locale de 10 sauvegardes .pgb",
          "ré-imports, doublons temporaires, sauvegardes locales", "≈ 40 à 196 Go"],
         ["Sauvegardes externes (règle 3-2-1, dont 1 hors site)",
          "3 à 4 copies du volume vivant", "≈ 80 à 520 Go"]],
        [5.6 * cm, 6.6 * cm, LARGE_UTILE - 12.2 * cm]))
    STORY.append(legende(
        "Tableau 5.1 — Projection de stockage à 20 ans (ordres de grandeur décimaux ; 1 Go = "
        "1 000 000 000 octets)."))
    STORY.append(p(
        "Configuration matérielle recommandée (dimensionnée pour la charge cible sur le long terme) : CPU "
        "8 cœurs physiques à 3 GHz ou plus (16 threads — OCR multi-passes pendant les imports, chiffrement "
        "AES sur chaque lecture/écriture, scrypt coûteux à chaque connexion) ; RAM 16 Go (ECC de "
        "préférence), extensible à 32 Go sans changer de carte mère ; disque système 500 Go SSD ; disque "
        "données 2 × 1 To SSD/NVMe identiques en miroir RAID 1 (le SSD réduit la latence des accès "
        "aléatoires SQLite) ; Windows Server 2016+ ou Linux LTS avec Node.js 22, Docker en option ; LAN "
        "1 Gbit/s (couvre environ dix fois le pic estimé du jour de paie) ; onduleur (UPS) avec arrêt "
        "propre automatique — une coupure pendant une écriture SQLite peut corrompre la base."))
    STORY.append(h2("Fiabilité des données et durée de vie"))
    STORY.append(bul(
        "<b>Vérification automatique des CIN après chaque import</b> : chaque fiche est classée « vrai » "
        "(format tunisien authentique : 8 chiffres classique ou 9 biométrique), « faux » (valeur détectée "
        "hors format) ou « non détecté » (aucun CIN lisible). Le taux de fiabilité (CIN vrais / fiches "
        "importées) et le taux d'erreur (CIN faux / fiches importées) s'affichent dans un encadré du "
        "panneau d'import, en badge vert/rouge devant chaque CIN et dans le journal des imports. La "
        "vérification certifie le FORMAT du numéro lu sur le document ; certifier qu'un CIN correspond à "
        "une carte réelle exigerait un registre officiel externe, hors de portée d'une application locale."))
    STORY.append(bul(
        "<b>Détection automatique des incohérences de nom et prénom</b> : à l'import, le nom extrait de "
        "chaque fiche est contrôlé en format puis comparé aux fiches du même CIN — la référence est le nom "
        "le plus FRÉQUENT, une coquille isolée ne devient jamais la référence (écriture différente, ordre "
        "inversé et fautes de frappe signalés). Toute la détection est NON BLOQUANTE : imports et demandes "
        "restent créés, le RH garde la décision finale."))
    STORY.append(bul(
        "<b>Défaillances et parades sur 20 ans</b> : miroir RAID 1 et remplacement préventif des disques "
        "tous les 5 à 7 ans (défaillance typique d'un SSD 0,5 à 1 % par an) ; règle 3-2-1 pour les "
        "sauvegardes externes avec test de restauration trimestriel ; onduleur contre les coupures "
        "électriques ; renouvellement du serveur tous les 5 à 7 ans (migration testée : copier db, storage, "
        "backups et .env vers le nouveau serveur puis restaurer). Taux d'erreur en exploitation : chaque "
        "opération écrit une trace vérifiable — une ligne ImportLog par fichier importé et une "
        "journalisation de chaque envoi avec succes:true ou false dans logs/journal-emails.log (seuil "
        "d'alerte indicatif : 2 % sur une journée de paie). Aucune corruption silencieuse n'est possible : "
        "toute altération d'un fichier ou d'un champ invalide l'authentification AES-256-GCM et déclenche "
        "une erreur explicite."))
    STORY.append(bul(
        "<b>Durée de vie</b> : prévoir 3 à 4 générations de matériel sur 20 ans et 4 à 6 migrations "
        "majeures du socle logiciel (Node, Next.js, Prisma) ; exporter périodiquement les PDF en clair "
        "vers une archive pérenne (PDF/A si exigence légale). Au-delà de 2 000 employés ou en multi-sites, "
        "évoluer vers PostgreSQL/MySQL — Prisma change de provider sans réécriture applicative — plutôt "
        "que changer de matériel ; une revue annuelle de capacité permet de décider à temps. Disponibilité "
        "cible : supérieure à 99,5 % ; avant la mise en production à 1 000 employés : test de charge du "
        "portail (k6, JMeter ou Locust — objectif indicatif : moins de 3 s par écran) et test de "
        "restauration des sauvegardes."))


def section_6():
    STORY.append(h1("6. Exploitation et dépannage"))
    STORY.append(p(
        "Le projet fournit lanceurs d'état, journaux dédiés, sauvegarde chiffrée outillée et sécurisation "
        "automatique des droits. Ce chapitre réunit l'essentiel : commandes, routine recommandée, mise à "
        "niveau, tests et remèdes aux incidents documentés."))
    STORY.append(tableau(
        ["Objectif", "Commande"],
        [["Sauvegarde / restauration",
          "node scripts/sauvegarde-bd.js --liste ; --restaurer \"SERVICE-RH-BD-...\" --sortie db/custom.db"],
         ["Superadministrateur",
          "node scripts/creer-superadmin.js --creer --email a@b.tn --nom \"Nom\" --password XXX ; "
          "--promouvoir --email a@b.tn"],
         ["Chiffrement base / stockage",
          "node scripts/chiffrer-base.js (idempotent, sauvegarde préalable) ; node scripts/chiffrer-storage.js --verifier"],
         ["Services",
          "node scripts/auto-rh.js start | stop | restart | status"],
         ["Découpage des anciens fichiers",
          "node scripts/scinder-pdfs-multipages.js --verifier (idem scinder-excel- et scinder-docx-)"],
         ["État et journaux",
          "ETAT-SILENCIEUX-WINDOWS.vbs ; JOURNAUX-SILENCIEUX-WINDOWS.vbs ; logs/auto-rh-processus.json"]],
        [4.6 * cm, LARGE_UTILE - 4.6 * cm]))
    STORY.append(legende("Tableau 6.1 — Commandes en ligne de commande (options vérifiées dans chaque script)."))
    STORY.append(tableau(
        ["Périodicité", "Tâche"],
        [["Hebdomadaire",
          "Vérifier l'état des deux services, les journaux et l'espace disque (journaux sans rotation automatique)."],
         ["Mensuelle (après paie)",
          "Sauvegarde .pgb + copie externe de db, storage ET .env ; vérifier la rotation."],
         ["Trimestrielle",
          "Test de restauration sur une machine de test depuis une sauvegarde .pgb et une copie storage."],
         ["Après chaque mise à jour",
          "Sauvegarder, remplacer les fichiers, npm install, npx prisma generate + db push (si le schéma a "
          "changé), npm run build, redémarrer ; cliquer « Indexer la base » si le bandeau ambré apparaît."],
         ["Annuelle",
          "Revue de capacité (taille de base, nombre de fiches, temps de réponse), export d'archive annuel, "
          "vérification des accès portail."]],
        [4.2 * cm, LARGE_UTILE - 4.2 * cm]))
    STORY.append(legende("Tableau 6.2 — Routine d'exploitation."))
    STORY.append(p(
        "Point de vigilance capital : une sauvegarde sans le fichier .env (AUTH_SECRET et "
        "AUTO_RH_STORAGE_KEY) est une sauvegarde morte — les fiches seraient irrécupérables après "
        "restauration."))
    STORY.append(bul(
        "<b>Mise à niveau</b> : séquence d'installation d'une nouvelle version — sauvegarde, remplacement "
        "des fichiers, npm install, npx prisma generate + db push (si le schéma a changé), npm run build, "
        "redémarrage. Fichiers multi-fiches importés par une ancienne version (restés fusionnés) : "
        "supprimer la fiche fusionnée puis réimporter le fichier original, ou les découper par les scripts "
        "scinder-*. Avant une mise en production à 1 000 employés : test de charge HTTP du portail (50 à "
        "150 utilisateurs simultanés) et test de restauration à l'échelle des 20 années de données "
        "(sections 5 et 7)."))
    STORY.append(h2("Dépannage : incidents d'exploitation et remèdes vérifiés"))
    STORY.append(tableau(
        ["Symptôme", "Remède vérifié"],
        [["« Node.js n'est pas reconnu » ou lanceur qui s'arrête immédiatement",
          "Réinstaller Node.js 20 ou 22 LTS (nodejs.org), rouvrir le terminal puis relancer le lanceur."],
         ["Erreur 500 au démarrage, base absente",
          "Les lanceurs recréent le .env et exécutent prisma db push ; manuellement : npx prisma db push "
          "puis redémarrer."],
         ["Recherche lente ou 409 « indexation requise »",
          "Cliquer « Indexer la base pour la recherche » (idempotent, sans arrêt de service)."],
         ["Fiche importée introuvable en recherche",
          "La recherche exige le CIN COMPLET (séparateurs intérieurs et casse tolérés) ; un scan sans "
          "couche texte exige un réimport lisible (l'OCR ne s'applique qu'aux documents contenant quelques "
          "caractères)."],
         ["Erreur 405 à l'importation de fiches (résultat : 0 réussi · N échec)",
          "Build PÉRIMÉ ne connaissant pas la route d'upload : relancer npm run build puis redémarrer "
          "(v0.2.130 — la route /api/payslips/upload doit figurer dans le manifest du build)."],
         ["« Ce compte a été automatiquement désactivé : le délai de 15 minutes … est dépassé » "
          "(COMPTE_EXPIRE_INITIAL)",
          "Le mot de passe initial n'a pas servi dans les 15 minutes (v0.2.129) : le SuperAdmin clique "
          "« Réactiver » dans l'onglet Utilisateurs — un NOUVEAU mot de passe unique est envoyé par e-mail, "
          "valable 15 minutes ; l'ancien n'est plus accepté."],
         ["Le manager ne reçoit pas les demandes de congé / autorisation",
          "Vérifier l'affectation « Manager responsable » dans l'onglet Accès portail (fenêtre « Mot de "
          "passe initial — CIN » ou bouton « Manager ») : le manager doit être ACTIF et coché « Manager ». "
          "À défaut de manager, la demande part au service RH (repli, annexe B) — le champ « Responsable "
          "N+1 » saisi n'existe plus depuis la v0.2.132."],
         ["Le RH a répondu « Acceptée » et la demande reste « En attente » après la réponse du manager",
          "Comportement CORRIGÉ (v0.2.168) : la réponse ultérieure du manager est enregistrée et achève la "
          "matrice à deux étapes — le PDF ne part qu'après les DEUX acceptations. Si le statut reste "
          "« En attente » : vérifier que la réponse contient « Acceptée »/« Refusée », que la réception IMAP "
          "est activée puis consulter le journal du portail (cycle de scrutation 15 s)."],
         ["Les pièces jointes d'une réponse Acceptée/Refusée ne parviennent pas à l'employé",
          "Depuis la v0.2.172, TOUTES les pièces jointes de la réponse (manager ou RH) sont transmises avec "
          "le PDF de décision, y compris en cas de refus et en cas de cumul des deux étapes. Vérifier la "
          "réception IMAP (interrupteur, identifiants, « Tester la connexion ») et le journal."],
         ["Fiches illisibles : « clé de chiffrement du stockage ne correspond pas »",
          "AUTH_SECRET ou AUTO_RH_STORAGE_KEY a changé : restaurer le .env d'origine ; ne JAMAIS "
          "régénérer les clés sur une base existante (rotation de clé : section 4)."],
         ["« Je ne reçois pas l'e-mail » (accès portail, test SMTP ou notification)",
          "Lire logs/journal-emails.log : chaque tentative y est consignée avec la réponse SMTP brute "
          "(Gmail : mot de passe d'application de 16 caractères obligatoire)."],
         ["L'employé ne reçoit pas la notification de sa demande",
          "Vérifier l'adresse enregistrée dans « Accès portail par mot de passe » (colonne « E-mail "
          "d'accès ») ; l'onglet Demandes côté administration indique l'état de la notification."],
         ["Le document envoyé par le RH n'apparaît pas sur la demande",
          "Vérifier la rubrique « Réception des réponses du service RH (IMAP) » de l'onglet Accès portail "
          "(interrupteur activé, adresse et port du serveur, identifiants — vides = ceux du SMTP) puis "
          "« Tester la connexion »."],
         ["Un document du dossier documents-demandes est resté lisible sur le disque",
          "Il est chiffré AUTOMATIQUEMENT au démarrage du portail (balayage silencieux) ; pour forcer "
          "immédiatement : node scripts/chiffrer-storage.js."],
         ["Les fichiers du dossier storage/tampons/ ne s'ouvrent plus comme des images",
          "C'est voulu : les copies de contrôle des tampons importés sont CHIFFRÉES (AES-256-GCM, en-tête "
          "PAIESAGE1) ; les deux services les déchiffrent à la volée."],
         ["Après une mise à jour, le QR, la signature ou l'import ne fonctionnent plus",
          "Build PÉRIMÉ : relancer npm run build puis redémarrer (les lanceurs vérifient le marqueur "
          ".auto-rh-version et reconstruisent si besoin)."],
         ["La signature ou le QR recouvre une zone de la fiche",
          "Curseurs « Décalage horizontal/vertical », largeur/taille (40 à 1 200 points) et rotation "
          "(0 à 360°) de la rubrique « Signature électronique &amp; QR code » — positionnement libre sur "
          "toute la feuille (aperçu A4 interactif)."],
         ["Une fiche ou une demande signale une anomalie de nom/prénom",
          "Détection automatique (format, faute de frappe, ordre inversé) : signalée dans les résultats "
          "d'import, le journal, l'e-mail du destinataire et le détail de la demande ; jamais bloquante "
          "(section 5)."],
         ["« Port déjà utilisé » au démarrage",
          "ARRETER-SILENCIEUX-WINDOWS.vbs (ou node scripts/auto-rh.js stop) puis redémarrer ; "
          "vérifier avec ETAT-SILENCIEUX-WINDOWS.vbs."],
         ["Employé verrouillé : « Trop de tentatives » (423)",
          "Attendre 15 minutes ou bouton « Déverrouiller » de l'onglet Accès portail ; mot de passe expiré "
          "(15 jours) : changement imposé à la connexion ou réinitialisation par le RH."],
         ["Sessions invalidées après chaque redémarrage Docker",
          "Définir AUTH_SECRET et AUTO_RH_STORAGE_KEY dans le compose ou monter un .env restreint."]],
        [6.2 * cm, LARGE_UTILE - 6.2 * cm]))
    STORY.append(legende("Tableau 6.3 — Dépannage : incidents d'exploitation et remèdes vérifiés."))


def section_7():
    STORY.append(h1("7. Recommandations"))
    STORY.append(p(
        "Les recommandations ci-dessous sont ordonnées par priorité au regard de l'objectif déclaré "
        "(1 000 employés, 1 000 fiches par mois, 20 ans d'historique). Toutes les versions se cumulent : "
        "installer la dernière revient à bénéficier de l'ensemble des correctifs."))
    for r in [
        "<b>R1 — Exécuter le test de charge du portail</b> (k6, JMeter ou Locust, 50 à 150 utilisateurs "
        "simultanés) avant la mise en production à 1 000 employés.",
        "<b>R3 — Automatiser les sauvegardes</b> : planifier sauvegarde-bd.js (tâche planifiée / cron) + "
        "copie externe de db, storage et .env ; tester la restauration trimestriellement (règle 3-2-1).",
        "<b>R4 — Chiffrer le transport</b> : reverse proxy HTTPS devant 4000/4001 et cookies secure avant "
        "toute exposition au-delà du réseau interne.",
        "<b>R5 — Compléter docker-compose.yml</b> avec AUTH_SECRET et AUTO_RH_STORAGE_KEY.",
        "<b>R6/R8 — Conserver SQLite</b> tant que le test de charge le permet ; migrer vers "
        "PostgreSQL/MySQL uniquement en cas de croissance (multi-sites, plus de 2 000 employés) — Prisma "
        "change de provider sans réécriture applicative.",
        "<b>R10 — Gestion des clés</b> : coffre-fort de secrets pour .env et procédure écrite de reprise ; "
        "jamais de régénération sur une base existante.",
        "<b>R11 — Export annuel pérenne</b> : exporter chaque année les PDF de l'année (déchiffrés) vers un "
        "support d'archive documenté (PDF/A si exigence légale).",
        "<b>R12 — Surveillance</b> : alerte sur l'espace disque (80 %), l'absence de sauvegarde récente et "
        "l'indisponibilité des ports 4000/4001.",
        "<b>R14 — Imports lourds hors heures ouvrées</b> (OCR = CPU), par tranches si besoin (gros "
        "fichiers jusqu'à 500 Mo gérés).",
        "<b>R15 — Revue annuelle de capacité</b> : comparer volumes et temps de réponse réels aux "
        "estimations de la section 5.",
        "<b>R21 — Maintenir le présent README à chaque livraison</b> : intégrer les nouveautés, retirer "
        "l'obsolète, actualiser les annexes.",
    ]:
        STORY.append(bul(r))


def matrice_tableau(lignes):
    """Tableau matrice : Fonctionnalité | SuperAdmin | RH | IT, Oui vert / Non rouge."""
    entete = ["Fonctionnalité", "SuperAdmin", "RH", "IT"]
    col_f = LARGE_UTILE * 0.52
    col_v = (LARGE_UTILE - col_f) / 3.0
    data = [[Paragraph(e, S["cell-tete-c"] if i else S["cell-tete"]) for i, e in enumerate(entete)]]
    cmds_style = []
    for ri, (texte, v1, v2, v3) in enumerate(lignes, start=1):
        data.append([Paragraph(texte, S["cell"]),
                     Paragraph(v1, S["cell-c"]),
                     Paragraph(v2, S["cell-c"]),
                     Paragraph(v3, S["cell-c"])])
        for ci, v in enumerate((v1, v2, v3), start=1):
            if v == "Oui":
                cmds_style.append(("TEXTCOLOR", (ci, ri), (ci, ri), VERT_OUI))
            elif v == "Non":
                cmds_style.append(("TEXTCOLOR", (ci, ri), (ci, ri), ROUGE_NON))
    t = Table(data, colWidths=[col_f, col_v, col_v, col_v], repeatRows=1, hAlign="LEFT")
    cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), FOND_ENTETE),
        ("GRID", (0, 0), (-1, -1), 0.5, LIGNE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4.5),
    ]
    for i in range(1, len(data)):
        cmds.append(("BACKGROUND", (0, i), (-1, i),
                     colors.white if i % 2 == 1 else ACCENT_CLAIR))
    cmds.extend(cmds_style)
    t.setStyle(TableStyle(cmds))
    return t


def annexe_a():
    STORY.append(h1("Annexe A — Matrice des droits des rôles"))
    STORY.append(p(
        "État du code livré v0.2.174 (archive officielle), 10 octobre 2026. Trois rôles d'administration "
        "(SuperAdmin, RH, IT) sur le port 4000 ; l'employé dispose du portail dédié 4001 (bloc ci-après)."))
    STORY.append(pivot("Fiches de paie"))
    STORY.append(matrice_tableau([
        ("Consultation — recherche par CIN, toutes les fiches, détail, copie signée servie (original intact)", "Oui", "Oui", "Non"),
        ("Importer des fiches de paie (PDF Sage, images, Excel, Word, ZIP ; signature PAdES automatique)", "Oui", "Oui", "Non"),
        ("Supprimer des fiches (unitaire et multiple)", "Oui", "Oui", "Non"),
        ("Maintenance — redétection du contenu, indexation de la base", "Oui", "Oui", "Non"),
        ("QR « Fiche en ligne » — page publique sous jeton HMAC : activation et configuration", "Oui", "Oui", "Non"),
    ]))
    STORY.append(Spacer(1, 5))
    STORY.append(pivot("Tampon, signature et certificat"))
    STORY.append(matrice_tableau([
        ("Configuration du tampon signature et QR des fiches (consultation, modification, aperçu)", "Oui", "Oui", "Non"),
        ("Import du certificat de signature — 10 formats (.p12, .pfx, .pem, .cer…), fichier chiffré sur disque", "Oui", "Oui", "Non"),
        ("Onglet « Signature » — signature électronique des documents importés, cachet des réponses", "Oui", "Oui", "Non"),
        ("Module « API de certification &amp; signature électronique » — configuration (mode LOCALE/API_EXTERNE, certificat, Test/Production, registre des documents signés) — réservé au SuperAdmin depuis la v0.2.126", "Oui", "Non", "Non"),
        ("Cachet « Signature électronique » du tampon — rectangle ou rond, contenu choisi (formulaire « Contenu du cachet », v0.2.128), couvert par la signature PAdES", "Oui", "Oui", "Non"),
    ]))
    STORY.append(Spacer(1, 5))
    STORY.append(pivot("Accès portail par mot de passe"))
    STORY.append(matrice_tableau([
        ("Créer / réinitialiser / activer-désactiver / débloquer / supprimer un accès", "Oui", "Oui", "Non"),
        ("QR code d'accès / réinitialisation du QR", "Oui", "Oui", "Non"),
        ("Envoyer le mot de passe initial par e-mail (adresse enregistrée sur le compte)", "Oui", "Oui", "Non"),
        ("Modifier « Nom » / « Prénom » / « Matricule » / e-mail — répercuté sur toutes les fiches du CIN", "Oui", "Oui", "Non"),
        ("Désigner un employé « Manager » et choisir son « Manager responsable » — fenêtre « Mot de passe initial — CIN » ou bouton « Manager » du tableau, SANS réinitialiser le mot de passe (v0.2.131 → v0.2.133)", "Oui", "Oui", "Non"),
    ]))
    STORY.append(Spacer(1, 5))
    STORY.append(pivot("Demandes administratives"))
    STORY.append(matrice_tableau([
        ("Liste, détail, traitement (statut + commentaire + notification e-mail) — congés, autorisations, attestations, parrainages", "Oui", "Oui", "Non"),
        ("Réponse avec document (import direct ; tampon et signature automatiques de la config des réponses)", "Oui", "Oui", "Non"),
        ("Téléchargement des documents de réponse", "Oui", "Oui", "Non"),
        ("QR « Réponse en ligne » — page publique sous jeton HMAC : activation et configuration", "Oui", "Oui", "Non"),
        ("Configuration DÉDIÉE du tampon des réponses ET de son certificat de signature — panneau « Configuration des réponses » de l'onglet Demandes", "Oui", "Oui", "Non"),
        ("Journal d'envoi IMAP (outil de diagnostic de la réception automatique)", "Oui", "Non", "Oui"),
    ]))
    STORY.append(Spacer(1, 5))
    STORY.append(pivot("Paramètres techniques — messagerie et signature"))
    STORY.append(matrice_tableau([
        ("Consulter la configuration SMTP", "Oui", "Non", "Oui"),
        ("Modifier la configuration SMTP — dont le routage des demandes : adresses dédiées par type (détails en annexe B) — et tests d'envoi SMTP / IMAP", "Oui", "Non", "Oui"),
        ("Module « API de certification &amp; signature » : panneau de configuration (onglet « Paramètres » du SuperAdmin seul — v0.2.126)", "Oui", "Non", "Non"),
    ]))
    STORY.append(Spacer(1, 5))
    STORY.append(pivot("Comptes utilisateurs"))
    STORY.append(matrice_tableau([
        ("Lister les comptes", "Oui", "Non", "Oui (consultation seule)"),
        ("Créer un compte RH ou IT — mot de passe initial envoyé par e-mail, VALABLE 15 MINUTES (v0.2.129)", "Oui", "Non", "Non"),
        ("Réactiver un compte dont le délai de 15 minutes a expiré (nouveau mot de passe unique par e-mail)", "Oui", "Non", "Non"),
        ("Activer / désactiver / supprimer un compte", "Oui", "Non", "Non"),
        ("Réinitialiser le mot de passe d'un compte (révoque les sessions ; jamais un ancien mot de passe — historique)", "Oui", "Non", "Non"),
        ("Changer le rôle d'un compte (RH ↔ IT)", "Oui", "Non", "Non"),
    ]))
    STORY.append(Spacer(1, 5))
    STORY.append(pivot("Divers"))
    STORY.append(matrice_tableau([
        ("Statistiques du tableau de bord", "Oui", "Oui", "Oui"),
        ("Changement de son propre mot de passe (expiration 15 jours)", "Oui", "Oui", "Oui"),
    ]))
    STORY.append(legende(
        "« Non » = refusé (403 côté serveur et/ou élément masqué dans l'interface) — les refus IT sont "
        "appliqués proprement côté serveur, sans état intermédiaire. Le dernier compte superadministrateur "
        "actif est protégé contre la suppression et la désactivation."))
    STORY.append(h2("Onglets visibles dans l'interface d'administration"))
    STORY.append(bul(
        "<b>SuperAdmin (8 onglets)</b> : Recherche CIN · Toutes les fiches · Importer (tampon, signature, "
        "certificat) · Accès portail · Demandes (avec la configuration des réponses) · Signature · "
        "Paramètres (module « API de certification &amp; signature ») · Utilisateurs."))
    STORY.append(bul(
        "<b>RH (6 onglets)</b> : Recherche CIN · Toutes les fiches · Importer (tampon, signature) · Accès "
        "portail · Demandes (configuration des réponses) · Signature — ni « Utilisateurs », ni "
        "« Paramètres » (aucun accès SMTP)."))
    STORY.append(bul(
        "<b>IT (2 onglets)</b> : Paramètres (SMTP seul) · Utilisateurs (consultation seule) — le tampon, "
        "la signature, le certificat, les fiches, les accès portail et les demandes en sont retirés."))
    STORY.append(h2("Le portail employé (port 4001)"))
    STORY.append(bul(
        "Connexion CIN + mot de passe + code OTP (2FA TOTP à chaque connexion) ; mot de passe initial à "
        "usage unique, changé obligatoirement à la première connexion puis tous les 15 jours."))
    STORY.append(bul(
        "Consultation de SES fiches de paie uniquement (CIN de la session) — copies SIGNÉES téléchargeables "
        "(v0.2.118), tampon appliqué à la volée, original intact."))
    STORY.append(bul(
        "Renseigner son e-mail de notification (stocké chiffré) — utilisé pour le suivi de SES demandes."))
    STORY.append(bul(
        "Créer des demandes administratives (5 types) : attestations — un seul bouton, aucune saisie ; "
        "congé et autorisation de sortie — PLUS AUCUN « Responsable N+1 » à saisir (v0.2.132), le manager "
        "responsable affecté par le RH reçoit la demande pour validation, puis le service RH valide à son "
        "tour (validation à DEUX ÉTAPES, v0.2.168 : le PDF de décision signé ne part qu'après les deux "
        "acceptations, un refus d'un des deux répond immédiatement) ; parrainage. Suivi dans "
        "« Mes demandes » (étapes 1. Manager / 2. Auto-RH tracées) et réception des documents de "
        "réponse, pièces jointes des décideurs incluses."))
    STORY.append(bul(
        "Aiguillage automatique des e-mails (annexe B) : manager responsable (principal) + service RH "
        "(copie) + employé (confirmation) — à défaut de manager, repli service RH ; envoi en arrière-plan "
        "jamais bloquant."))
    STORY.append(bul(
        "Aucune fonction d'administration : verrouillage temporaire après échecs consécutifs, aucune API "
        "d'administration exposée."))
    STORY.append(h2("Principes appliqués"))
    STORY.append(bul(
        "Toute restriction est DOUBLE : réponse 403 côté serveur (code FONCTIONNALITE_NON_AUTORISEE_IT "
        "pour le rôle IT) ET masquage de l'élément dans l'interface — jamais l'un sans l'autre."))
    STORY.append(bul(
        "Aucune inscription libre : les comptes RH et IT sont créés exclusivement par le superadministrateur "
        "(onglet Utilisateurs) ; leur mot de passe initial est valable 15 minutes et aucun ancien mot de "
        "passe ne peut être réutilisé (historique PasswordHistory — v0.2.129)."))
    STORY.append(bul(
        "La modification du manager d'un employé (bouton « Manager » de l'onglet Accès portail) ne touche "
        "JAMAIS à son mot de passe : aucun mot de passe initial n'est émis, les sessions restent valides "
        "(v0.2.133)."))
    STORY.append(bul(
        "Mot de passe expiré (politique 15 jours, tous les comptes) : toute API de données répond 403 "
        "jusqu'au changement effectif ; tout changement ou réinitialisation révoque immédiatement TOUTES "
        "les sessions antérieures (jetons liés à la version du mot de passe)."))
    STORY.append(bul(
        "Le portail employé (CIN + mot de passe + code OTP) reste accessible aux employés indépendamment "
        "des trois rôles d'administration."))
    STORY.append(bul(
        "Pages publiques limitativement énumérées : /login, /api/auth/*, téléchargement du README, des "
        "scripts, de la matrice des rôles et de la map de routage des e-mails, pages de vérification QR "
        "(fiche et réponse) sous jeton HMAC signé."))
    STORY.append(bul(
        "Données sensibles chiffrées (AES-256-GCM) : fiches de paie, adresses e-mail, mots de passe "
        "(scrypt), certificat de signature stocké sur disque."))


def annexe_b():
    STORY.append(h1("Annexe B — Map de routage des e-mails des demandes"))
    STORY.append(p(
        "Configuration introduite en v0.2.94 — état du code v0.2.174, 10 octobre 2026. Configuration par "
        "l'IT / le superadministrateur — panneau SMTP → « Routage des demandes administratives »."))
    STORY.append(p(
        "Depuis la v0.2.132, l'EMPLOYÉ ne saisit plus AUCUN destinataire : le champ « Responsable N+1 "
        "hiérarchique » a été supprimé des formulaires de congé et d'autorisation de sortie. Le "
        "DESTINATAIRE PRINCIPAL de ces deux types est le MANAGER RESPONSABLE de l'employé, affecté par le "
        "RH dans l'onglet « Accès portail » (case « Manager » + liste « Manager responsable » — fenêtre "
        "« Mot de passe initial — CIN » ou bouton « Manager »). Il reçoit la demande avec la consigne "
        "« VALIDATION PAR E-MAIL » : sa réponse contenant « Acceptée » ou « Refusée » met le statut à jour "
        "automatiquement. Le service RH reçoit une COPIE informative et l'employé une CONFIRMATION avec "
        "récapitulatif. Les deux attestations et le parrainage partent vers leur adresse DÉDIÉE (boîte RH "
        "en repli). Dans tous les cas l'employé reçoit une confirmation automatique, et aucun envoi n'est "
        "perdu : à défaut de manager affecté ou d'adresse dédiée, tout retombe sur la boîte RH. Les e-mails "
        "partent en arrière-plan (la création de la demande répond immédiatement) et chaque envoi est "
        "journalisé."))
    STORY.append(h2("Routage par type de demande"))
    STORY.append(tableau(
        ["Type de demande", "Destinataire principal", "Copie automatique", "Confirmation"],
        [["Attestation de travail",
          "Adresse DÉDIÉE attestationTravailEmail ; vide → boîte RH (rhEmail).", "(aucune)", "Oui"],
         ["Attestation de salaire",
          "Adresse DÉDIÉE attestationSalaireEmail ; vide → boîte RH (rhEmail).", "(aucune)", "Oui"],
         ["Congé",
          "MANAGER RESPONSABLE de l'employé (affectation « Accès portail » — plus aucun N+1 saisi, "
          "v0.2.132) ; aucun manager → boîte RH (rhEmail).",
          "COPIE à l'adresse DÉDIÉE congeEmail ; vide → copie boîte RH.", "Oui"],
         ["Autorisation de sortie",
          "MANAGER RESPONSABLE de l'employé (v0.2.132) ; repli historique : cascade département → ligne "
          "DEFAUT → boîte RH.",
          "COPIE à l'adresse DÉDIÉE autorisationEmail ; vide → copie boîte RH.", "Oui"],
         ["Parrainage",
          "Adresse DÉDIÉE parrainageEmail (aucun N+1 saisi) ; vide → boîte RH.", "(aucune)", "Oui"]],
        [3.1 * cm, 6.4 * cm, 4.4 * cm, LARGE_UTILE - 13.9 * cm], centre=[3]))
    STORY.append(legende(
        "Tableau B.1 — Routage par type de demande. Le nom du manager résolu (managerNom) est mémorisé sur "
        "la demande et affiché dans « Mes demandes » et aux traitants."))
    STORY.append(h2("Champs de configuration (model MailConfig)"))
    STORY.append(tableau(
        ["Champ", "Rôle dans le routage"],
        [["rhEmail", "Boîte commune du service RH : repli de tous les types sans adresse dédiée ni manager, copie des congés / autorisations sans adresse dédiée."],
         ["itEmail", "Notifications techniques éventuelles — aucun routage automatique actuel."],
         ["responsablesMap", "Table de repli historique des autorisations de sortie : DEPARTEMENT=email, ligne DEFAUT=email pour les départements sans règle."],
         ["parrainageEmail", "Destinataire PRINCIPAL du parrainage (routage exclusif)."],
         ["attestationTravailEmail", "Destinataire PRINCIPAL des attestations de travail."],
         ["attestationSalaireEmail", "Destinataire PRINCIPAL des attestations de salaire."],
         ["congeEmail", "Reçoit une COPIE de chaque demande de congé (le manager responsable reste principal)."],
         ["autorisationEmail", "Reçoit une COPIE de chaque autorisation de sortie (le manager responsable reste principal)."]],
        [4.6 * cm, LARGE_UTILE - 4.6 * cm]))
    STORY.append(legende("Tableau B.2 — Champs de routage du panneau SMTP."))
    STORY.append(h2("Mécanique commune"))
    STORY.append(bul(
        "<b>Envoi en arrière-plan</b> : la création d'une demande répond 201 immédiatement ; les e-mails "
        "partent ensuite, JAMAIS bloquants. Sans destinataire résolu, rien n'est envoyé, l'échec est "
        "journalisé (DESTINATAIRE_ABSENT) et la demande reste traitable dans l'onglet « Demandes » ; à "
        "défaut de manager affecté, la demande est aiguillée au service RH (jamais perdue)."))
    STORY.append(bul(
        "<b>Repli RH systématique</b> : aucune adresse dédiée n'est obligatoire — un champ laissé vide "
        "retombe sur la boîte RH (comportement historique conservé)."))
    STORY.append(bul(
        "<b>Anti-doublon</b> : la copie dédiée n'est jamais envoyée lorsque son adresse est identique au "
        "destinataire principal."))
    STORY.append(bul(
        "<b>Confirmation au demandeur (les 5 types)</b> : récapitulatif et référence envoyés à l'adresse "
        "de notification de l'employé (PortalAccess.email, chiffré ; repli mailEnvoyeA — dernière adresse "
        "utilisée pour l'envoi du mot de passe initial) — e-mail automatique « NE PAS répondre » "
        "(v0.2.105)."))
    STORY.append(bul(
        "<b>Notifications employé SANS réponse (v0.2.105)</b> : TOUS les e-mails destinés à l'EMPLOYÉ "
        "(confirmation d'enregistrement, changement de statut, document disponible, décision du manager) "
        "sont des NOTIFICATIONS PURES — mention explicite « NE PAS répondre à cet e-mail », renvoi à la "
        "rubrique « Mes demandes » du portail employé et invitation à contacter le service RH ; aucune "
        "réponse envoyée à l'adresse d'expédition n'est lue. La réponse par e-mail reste réservée au "
        "manager responsable / service RH (reconnue par IMAP)."))
    STORY.append(bul(
        "<b>Journal d'envoi</b> (logs/journal-emails.log, consultable IT / SuperAdmin — onglet Demandes) : "
        "demande-creation (au manager responsable), demande-creation-copie-rh, "
        "demande-creation-copie-dediee, demande-creation-confirmation-demandeur, compte-cree, "
        "reactivation-compte (v0.2.129)."))
    STORY.append(bul(
        "<b>E-mails de comptes (v0.2.106 → v0.2.129)</b> : la création d'un compte RH ou IT par le "
        "superadministrateur envoie AUTOMATIQUEMENT au nouvel utilisateur son identifiant, son mot de passe "
        "initial (VALABLE 15 MINUTES) et l'adresse d'accès au site d'administration, avec le rappel du "
        "changement de mot de passe OBLIGATOIRE à la première connexion ; l'e-mail part DE L'ADRESSE DU "
        "SERVICE INFORMATIQUE configurée (panneau SMTP → « E-mail du service informatique ») ; la "
        "RÉACTIVATION d'un compte expiré génère un NOUVEAU mot de passe UNIQUE (historique complet) envoyé "
        "par le même canal — envois journalisés, jamais bloquants."))
    STORY.append(bul(
        "<b>Pièces jointes aux notifications employé (v0.2.106)</b> : le document final tamponné et signé "
        "répondant à la demande est JOINT à l'e-mail de l'employé pour TOUS les types, par import direct "
        "comme par réponse e-mail IMAP ; les copies envoyées au manager / service RH restent SANS pièces "
        "jointes (ils possèdent déjà le document)."))
    STORY.append(bul(
        "<b>Décision par réponse e-mail (v0.2.108)</b> : la consigne « VALIDATION PAR E-MAIL » porte "
        "« Acceptée » / « Refusée » ; la décision par réponse s'applique à TOUS les types — avec ou sans "
        "pièce jointe : statut mis à jour automatiquement (traitePar « Manager responsable (e-mail) » ou "
        "« Auto-RH (e-mail) »), pièce jointe importée puis jointe à l'e-mail de l'employé et disponible "
        "dans son portail ; un filet de détection explicite (« accept… » / « refus… », y compris dans le "
        "sujet et sous la citation) évite tout faux « En attente » ; le dialogue « Répondre avec un "
        "document » de l'administration porte une décision explicite (Aucune / Acceptée / Refusée)."))
    STORY.append(bul(
        "<b>Accès portail par mot de passe (v0.2.109 → v0.2.110)</b> : la colonne « Matricule » dispose de "
        "son propre en-tête (9 en-têtes pour 9 colonnes) ; les colonnes « Nom » / « Prénom » sont remplies "
        "AUTOMATIQUEMENT depuis les fiches de paie à l'importation — premier mot = Nom, mots suivants = "
        "Prénom, composés « Ben »/« Bel »/« Bou » conservés ensemble (ex. « Saidani Mohamed Amine » → "
        "Nom « Saidani » / Prénom « Mohamed Amine ») — pré-remplissage jamais destructif (une correction "
        "du RH au crayon n'est jamais écrasée) ; la recherche du tableau porte aussi sur le prénom ; le "
        "Prénom porte son propre crayon d'édition, la modification étant propagée dans toutes les fiches "
        "du CIN."))
    STORY.append(bul(
        "<b>Certificats électroniques + clés privées associées (v0.2.111 → v0.2.112)</b> : coffres "
        ".p12/.pfx (clé incluse, mot de passe chiffré), clés séparées .pem/.key/.der (PKCS#8/PKCS#1, "
        "claire ou chiffrée), PEM combiné reconnu ; certificat SEUL accepté quand la clé privée est déjà "
        "disponible — association VÉRIFIÉE par appariement cryptographique ; fichiers chiffrés au repos, "
        "mots de passe chiffrés en base, jamais renvoyés à l'interface ; le dialogue « Répondre avec un "
        "document » porte son PROPRE import de certificat."))
    STORY.append(bul(
        "<b>API de certification &amp; signature (v0.2.114 → v0.2.126)</b> : signature PAdES LOCALE (moteur "
        "100 % node : node:crypto + node-forge, PKCS#7/CMS — aucune dépendance à openssl) ou API_EXTERNE "
        "(URL Test/Production, Bearer/API-Key/Basic, secret chiffré jamais renvoyé) ; fiches signées à "
        "l'import (cache par empreinte), réponses signées AVANT envoi, copies signées conservées et "
        "vérification d'intégrité ; CONFIGURATION RÉSERVÉE AU SUPERADMINISTRATEUR depuis la v0.2.126."))
    STORY.append(bul(
        "<b>Cachet « SIGNATURE ÉLECTRONIQUE » (v0.2.119 → v0.2.128)</b> : alimenté EN DIRECT par le "
        "certificat du module, forme RECTANGLE ou ROND d'entreprise, apposé sur PDF, images, Word et Excel "
        "avec position/taille propres aux périmètres Import et Réponses ; GARANTIE : le cachet n'est "
        "apposé QUE si la signature PAdES réussit sur les mêmes octets ; depuis la v0.2.128, AUCUNE "
        "information du certificat par défaut — formulaire « Contenu du cachet » (Signataire, "
        "Organisation, Émetteur, Validité, Empreinte SHA-256, ligne personnalisée) avec interrupteurs "
        "propres à chaque périmètre."))
    STORY.append(bul(
        "<b>Désignation des managers (v0.2.131 → v0.2.133)</b> : case « Manager » + liste « Manager "
        "responsable » dans l'onglet « Accès portail » (fenêtre « Mot de passe initial — CIN » et bouton "
        "« Manager » du tableau ouvrant la fenêtre dédiée « Modifier le manager ») — enregistrement "
        "automatique, liste mise à jour au fur et à mesure, contrôles serveur (responsable actif et coché "
        "« Manager », auto-référence refusée, décochage remettant les subordonnés à « Aucun »), mot de "
        "passe STRICTEMENT intouché."))
    STORY.append(bul(
        "<b>Matricule employé dans les demandes (v0.2.107)</b> : le matricule extrait des fiches de paie "
        "accompagne chaque demande — colonnes « Matricule » dans « Toutes les fiches », « Accès portail » "
        "et « Demandes » (valeur manuelle de l'accès prioritaire) et ligne « Matricule » dans TOUS les "
        "e-mails du circuit."))
    STORY.append(bul(
        "<b>Décision finale à deux étapes et pièces jointes (v0.2.168 → v0.2.173)</b> : pour le congé et "
        "l'autorisation de sortie, la réponse du manager ne CLÔT PAS la demande — la matrice "
        "calculerStatutFinalDeuxEtapes recalcule le statut final après CHAQUE réponse (manager OU service "
        "RH, quel que soit l'ordre) : acceptation des deux = « Acceptée » + PDF signé automatique ; refus "
        "de l'un = « Refusée » immédiat (refuseePar = MANAGER ou RH) sans attendre l'autre ; le correctif "
        "du statut manager (réponse manager APRÈS celle du RH désormais prise en compte) est vérifié en "
        "production réelle. Les pièces jointes fournies par les décideurs sont toutes transmises à "
        "l'employé avec le PDF (dédoublonnage, octets exacts)."))
    STORY.append(bul(
        "<b>Réponses par e-mail</b> : le Message-ID de l'envoi principal est mémorisé — la réponse du "
        "manager ou du RH est reconnue par IMAP (In-Reply-To / References) même si le sujet est modifié ; "
        "le document reçu est chiffré, associé à la demande et tamponné selon la configuration dédiée des "
        "réponses. Réception renforcée (v0.2.165 → v0.2.172) : curseurs UID persistants (survivent aux "
        "redémarrages, dédoublonnage Message-ID INBOX/Envoyés) et durcissements réseau (timeouts connexion "
        "20 s, socket 120 s, relâchement forcé du verrou de scrutation après 120 s)."))
    STORY.append(bul(
        "<b>Référence</b> : classeur « AutoRH-Map-routage-emails-demandes » téléchargeable via "
        "/api/download-routage."))


# ---- Assemblage -------------------------------------------------------------

ENTETE = "AutoRH — Documentation technique et README officiel — édition resserrée " + EDITION


def _pied(canvas, doc):
    canvas.saveState()
    canvas.setFont("Serif", 8)
    canvas.setFillColor(GRIS)
    canvas.drawString(MARGE_G, MARGE_B - 0.45 * cm, ENTETE)
    canvas.drawRightString(LARG - MARGE_D, MARGE_B - 0.45 * cm, "page %d" % doc.page)
    canvas.restoreState()


def _premiere(canvas, doc):
    canvas.saveState()
    canvas.setFont("Serif", 8)
    canvas.setFillColor(GRIS)
    canvas.drawRightString(LARG - MARGE_D, MARGE_B - 0.45 * cm, "page 1")
    canvas.restoreState()


def verifier(pdf_path):
    from pypdf import PdfReader
    lecteur = PdfReader(pdf_path)
    nb = len(lecteur.pages)
    texte_complet = " ".join((lecteur.pages[i].extract_text() or "") for i in range(nb))
    attendus = [
        "V0.2.174", "AutoRH", "Mot de passe initial valable 15 MINUTES",
        "COMPTE_EXPIRE_INITIAL", "PasswordHistory", "Modifier le manager",
        "MANAGER RESPONSABLE", "Responsable N+1", "v0.2.131", "v0.2.132", "v0.2.133",
        "DEUX ÉTAPES", "calculerStatutFinalDeuxEtapes", "Refusée par le Manager",
        "Refusée par les RH", "v0.2.168", "v0.2.172", "SHA-256",
        "Annexe A", "Matrice des droits", "Annexe B", "Map de routage",
        "PAdES", "API de certification", "Contenu du cachet", "v0.2.126", "v0.2.128",
        "Onglets visibles", "SuperAdmin (8 onglets)", "RH (6 onglets)", "IT (2 onglets)",
        "240 000", "AES-256-GCM", "PAIESAGE1", "encbd1", "FONCTIONNALITE_NON_AUTORISEE_IT",
        "DEM-AAAA-NNNNN", "240 000 fiches · 20 ans",
        "Temps de développement et de test", "jours-homme", "12 septembre",
        "52 500", "Tableau 1.3", "257 scripts",
    ]
    sans_espaces = "".join(texte_complet.split())
    manquants = [a for a in attendus
                 if a not in texte_complet and a not in sans_espaces]
    assert not manquants, "texte manquant dans le PDF : %s" % manquants
    return nb


def md5f(p_):
    return hashlib.md5(open(p_, "rb").read()).hexdigest()


def main():
    doc = SimpleDocTemplate(
        PDF_CIBLE, pagesize=A4,
        leftMargin=MARGE_G, rightMargin=MARGE_D,
        topMargin=MARGE_H, bottomMargin=MARGE_B,
        title="AutoRH — README officiel — édition resserrée v0.2.174",
        author="AutoRH",
        subject="Documentation technique : fiches de paie, demandes administratives et documents RH",
        creator="AutoRH",
    )
    page_couverture()
    section_1()
    section_2()
    section_3()
    section_4()
    section_5()
    section_6()
    section_7()
    annexe_a()
    annexe_b()
    doc.build(STORY, onFirstPage=_premiere, onLaterPages=_pied)

    nb = verifier(PDF_CIBLE)
    os.makedirs(os.path.dirname(PDF_DL), exist_ok=True)
    shutil.copy2(PDF_CIBLE, PDF_DL)
    shutil.copy2(PDF_CIBLE, PDF_VERSIONNE)
    print("OK : édition %s — %d pages (tous les marqueurs de contrôle présents)." % (EDITION, nb))
    for p_ in (PDF_CIBLE, PDF_DL, PDF_VERSIONNE):
        print("  %s — %d octets — md5 %s" % (p_, os.path.getsize(p_), md5f(p_)))


if __name__ == "__main__":
    main()
