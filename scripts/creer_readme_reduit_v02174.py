#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 254 — README officiel AutoRH, ÉDITION RÉDUITE v0.2.174 (~12-14 pages).

Fondée sur le code livré v0.2.174 (succède à l'édition v0.2.134 ; inclut la
VALIDATION À DEUX ÉTAPES des congés/autorisations — v0.2.168 : acceptation
manager ET service RH, PDF signé après double acceptation, refus immédiat,
correctif du statut manager —, le transfert au demandeur de TOUTES les
pièces jointes des réponses — v0.2.168 → v0.2.172, certifié campagne réelle
42/42 — et les durcissements IMAP v0.2.172). Priorités conservées en détail :
  • Installation et démarrage (section 3 de l'édition complète) ;
  • Exploitation et dépannage (commandes, routine, remèdes vérifiés) ;
  • Annexe — matrice des droits des rôles (complète).
Le reste (architecture, capacité, routage des e-mails) tient en un résumé
(section 1). L'édition COMPLÈTE v0.2.174 (19 pages) reste la référence
architecturale et n'est PAS modifiée.

Sorties (aucune modification du README complet servi par /api/download-readme) :
  download/servicerh-readme-technique-reduit.pdf
  download/servicerh-readme-technique-reduit-v0.2.174.pdf
  servicerh-readme-technique-reduit.pdf (racine, pour l'archive ZIP)
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
PDF_RACINE = os.path.join(RACINE, "servicerh-readme-technique-reduit.pdf")
PDF_DL = os.path.join(RACINE, "download", "servicerh-readme-technique-reduit.pdf")
PDF_VERSIONNE = os.path.join(
    RACINE, "download", "servicerh-readme-technique-reduit-v0.2.174.pdf")
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


# === CONTENU ================================================================
STORY = []


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


def page_couverture():
    STORY.append(Paragraph(espacer("README OFFICIEL · ÉDITION RÉDUITE · V0.2.174"), S["bande"]))
    STORY.append(p("AutoRH", "titre"))
    STORY.append(p("Fiches de paie, demandes administratives et documents RH", "sous-titre"))
    STORY.append(p(
        "Édition RÉDUITE de la documentation technique, fondée sur le code livré v0.2.174. Les chapitres "
        "utiles au quotidien — installation et démarrage, exploitation et dépannage, matrice des droits — "
        "y sont traités en détail ; le reste (architecture, capacité, routage des e-mails) tient en un "
        "résumé de la section 1. Elle COMPLÈTE l'édition complète v0.2.174 (19 pages), qui reste la "
        "référence pour les détails d'architecture, la procédure de chiffrement pas à pas et l'annexe de "
        "routage complète. AutoRH (anciennement Auto-RH) couvre les fiches de paie ET les demandes "
        "administratives : le service RH importe en masse les bulletins produits par Sage (PDF, images, "
        "ZIP, Excel, Word) ; l'application détecte automatiquement CIN, nom, période, net à payer et "
        "matricule, puis indexe chaque fiche dans une base SQLite. Chaque employé consulte SES fiches — "
        "signées électroniquement — et suit ses demandes via un portail sécurisé par CIN, mot de passe et "
        "code OTP. La désignation des <b>MANAGERS</b> se fait dans l'onglet « Accès portail » ; les "
        "demandes de congé et d'autorisation partent automatiquement au manager responsable (validation "
        "par e-mail), avec copie au service RH et confirmation à l'employé (v0.2.132). Depuis la v0.2.168, "
        "ces deux types suivent une <b>VALIDATION À DEUX ÉTAPES</b> : acceptation du manager ET du service "
        "RH requise — aucun PDF signé tant que les deux n'ont pas accepté, refus immédiat de l'un des "
        "deux, correctif du statut manager lorsque le service RH répond en premier — et TOUTES les pièces "
        "jointes fournies par les décideurs sont transmises à l'employé avec le PDF (v0.2.168 → v0.2.172). "
        "Le mot de passe initial des comptes RH/IT est <b>valable 15 minutes</b> (v0.2.129). Le tableau "
        "« Accès portail » bénéficie d'un affichage amélioré (v0.2.134 : colonnes redimensionnables, "
        "défilement fluide, boutons sans chevauchement)."))
    STORY.append(p("Administration 4000  ·  Portail 4001  ·  Pont d'aperçu 3000  ·  CIN 8 chiffres  ·  "
                   "AES-256-GCM  ·  240 000 fiches · 20 ans", "badges"))
    STORY.append(filet())
    STORY.append(p("<b>Sommaire</b>", "corps"))
    sommaire = [
        "1. Présentation et résumé technique — services et ports, pile, sécurité en bref, routage des e-mails",
        "2. Fonctionnalités essentielles — import, portail, comptes et managers, demandes, signature",
        "3. Installation et démarrage — prérequis, lanceurs, réseau local, secrets, liste de contrôle",
        "4. Capacité, matériel et fiabilité — mesures à 240 000 fiches, projection sur 20 ans",
        "5. Exploitation et dépannage — commandes, routine, remèdes vérifiés",
        "6. Recommandations",
        "Annexe — Matrice des droits des rôles (SuperAdmin, RH, IT ; portail employé)",
    ]
    for s_ in sommaire:
        STORY.append(p(s_, "bul"))
    STORY.append(Spacer(1, 6))
    STORY.append(filet())
    blocs = [
        ("D I F F U S I O N",
         "Les quatre livrables sont téléchargeables sans connexion depuis l'administration : "
         "/api/download-readme (édition COMPLÈTE v0.2.174), /api/download-scripts (archive du code), "
         "/api/download-matrice (matrice des rôles Excel), /api/download-routage (map de routage des "
         "e-mails). Le présent fichier : "
         "download/servicerh-readme-technique-reduit-v0.2.174.pdf."),
        ("S O U R C E S",
         "Code source livré v0.2.174 · README-DEPLOIEMENT-LOCAL.md (guide d'installation illustré) · "
         "notes LIRE-MOI-CORRECTIF-*.txt (détail de chaque livraison)."),
        ("D A T E   D ' É D I T I O N",
         "10 octobre 2026 — fondée sur le code v0.2.174 ; maintenue à jour au fil des livraisons (R21)."),
    ]
    for titre, corps in blocs:
        STORY.append(p(titre, "pivot"))
        STORY.append(p(corps))
    STORY.append(Spacer(1, 8))
    STORY.append(p("F I C H E S   D E   P A I E   E T   D E M A N D E S   A D M I N I S T R A T I V E S   ·   F R",
                   "badges"))


def section_1():
    STORY.append(h1("1. Présentation et résumé technique"))
    STORY.append(p(
        "AutoRH (anciennement Auto-RH) est une application web de gestion des services RH : fiches "
        "de paie ET demandes administratives, pour un service RH assisté par l'informatique. Le service "
        "RH importe en masse les bulletins produits par Sage (PDF, images, archives ZIP, classeurs "
        "Excel, documents Word) ; l'application détecte automatiquement le CIN, le nom de l'employé, la "
        "période, le net à payer et le matricule dans le contenu des documents, puis indexe chaque fiche "
        "dans une base SQLite. Chaque employé consulte ensuite SES fiches — signées électroniquement — "
        "et suit ses demandes via un portail sécurisé par CIN, mot de passe et code OTP. Deux services "
        "cohabitent sur la même machine et partagent la base et le stockage chiffré :"))
    STORY.append(tableau(
        ["Service", "Port et surcharge", "Rôle"],
        [["Administration (RH, IT, SuperAdmin)",
          "4000 — PORT ou AUTO_RH_PORT_ADMIN",
          "Serveur Next.js standalone : import, recherche paginée, gestion des fiches, comptes et "
          "managers, configuration SMTP et du module de signature (scripts/start-prod.js)."],
         ["Portail employés",
          "4001 — PORTAL_PORT ou AUTO_RH_PORT_PORTAIL",
          "Serveur Node HTTP natif (scripts/portail-server.js) : consultation après CIN + mot de passe + "
          "code OTP, fiches du CIN de session uniquement, demandes administratives."],
         ["Pont d'aperçu",
          "3000 — AUTO_RH_PORT_PONT (désactivable)",
          "Pont 3000 → administration 4000 pour l'entrée Caddy 81 : aperçu et téléchargements publics "
          "(/api/download-*) sans connexion."]],
        [3.1 * cm, 4.4 * cm, LARGE_UTILE - 7.5 * cm]))
    STORY.append(legende(
        "Tableau 1.1 — Les services livrés. Écoute 0.0.0.0 : ouvrir 4000 et 4001 en TCP dans le pare-feu ; "
        "les services partagent db/custom.db et storage/."))
    STORY.append(h2("Pile technique"))
    STORY.append(tableau(
        ["Composant", "Rôle dans AutoRH"],
        [["Next.js / React (build standalone, App Router)",
          "Framework de l'administration : import, recherche paginée, fiches, comptes, configuration "
          "SMTP et du module de signature."],
         ["Prisma + SQLite (db/custom.db)",
          "Base de données embarquée — aucune autre base à installer."],
         ["Tailwind CSS 4 + shadcn/ui",
          "Interface responsive mobile (palette logo : boutons orange, fond blanc chaud)."],
         ["tesseract.js + sharp",
          "OCR des fiches peu textuelles (modèle français local)."],
         ["pdf-parse, pdf-lib, mammoth, exceljs, xlsx, jszip",
          "Extraction PDF, Word, Excel et archives ZIP ; découpage des fichiers multi-fiches."],
         ["nodemailer, qrcode, node:crypto, node-forge, jsqr",
          "Envoi SMTP, QR codes TOTP et signature cryptographique PAdES (PKCS#7/CMS, 100 % node sans "
          "openssl)."]],
        [6.4 * cm, LARGE_UTILE - 6.4 * cm]))
    STORY.append(legende(
        "Tableau 1.2 — Technologies embarquées (versions fixées par package-lock.json ; conteneurisation "
        "Docker node:20-slim en option)."))
    STORY.append(h2("Sécurité en bref"))
    STORY.append(bul(
        "<b>Comptes et sessions</b> : mots de passe hachés scrypt (jamais déchiffrables, 8 caractères "
        "minimum, 4 classes), expiration 15 jours avec changement forcé ; sessions admin par cookie "
        "httpOnly signé HMAC-SHA256, révoquées au changement de mot de passe. Mot de passe initial des "
        "comptes RH/IT VALABLE 15 MINUTES puis désactivation automatique — réactivation par un NOUVEAU "
        "mot de passe UNIQUE (historique PasswordHistory) ; aucune réutilisation d'un ancien mot de "
        "passe (v0.2.129)."))
    STORY.append(bul(
        "<b>Anti force-brute et double authentification</b> : 10 échecs admin par IP en 10 minutes puis "
        "429 ; 5 échecs portail puis verrouillage persistant de 15 minutes (423) avec temporisation "
        "anti-énumération. Portail à double facteur TOTP (RFC 6238) : QR d'enrôlement affiché une seule "
        "fois, code à 6 chiffres à chaque connexion. Journal de sécurité : logs/auth-securite.log (une "
        "ligne JSON par événement, exploitable par grep ou un SIEM)."))
    STORY.append(bul(
        "<b>Chiffrement AES-256-GCM double</b> : champs sensibles de la base (middleware Prisma) ET "
        "chaque fichier sur disque (en-tête PAIESAGE1) — fiches, tampons, certificats et documents des "
        "demandes. La recherche CIN utilise des empreintes déterministes CHIFFRÉES : aucune donnée "
        "sensible en clair en base. Tout repose sur le fichier .env (AUTH_SECRET, AUTO_RH_STORAGE_KEY) : "
        "sa perte rend les fiches mathématiquement irrécupérables — le sauvegarder AVEC les données et "
        "ne JAMAIS régénérer les clés sur une installation existante (rotation : édition complète, §4)."))
    STORY.append(bul(
        "<b>Autorisations et hygiène</b> : session requise sur toutes les API ; rôles appliqués côté "
        "serveur ET éléments masqués dans l'interface (double restriction — matrice en annexe) ; en-têtes "
        "HTTP anti-clickjacking, nosniff, HSTS, CSP ; droits disque restrictifs imposés au démarrage sur "
        ".env, db, storage, logs, backups ; pages publiques limitativement énumérées (connexion, "
        "téléchargements, vérification QR sous jeton HMAC)."))
    STORY.append(h2("Routage des e-mails des demandes (résumé)"))
    STORY.append(p(
        "Depuis la v0.2.132, l'employé ne saisit PLUS AUCUN destinataire : le champ « Responsable N+1 » "
        "a été supprimé des formulaires de congé et d'autorisation de sortie. Le DESTINATAIRE PRINCIPAL "
        "de ces deux types est le MANAGER RESPONSABLE affecté par le RH dans l'onglet « Accès portail » "
        "(case « Manager » + liste « Manager responsable » — fenêtre « Mot de passe initial — CIN » ou "
        "bouton « Manager ») ; sa réponse contenant « Acceptée » ou « Refusée » met le statut à jour "
        "automatiquement. Le service RH reçoit une COPIE informative et l'employé une CONFIRMATION avec "
        "récapitulatif ; les attestations et le parrainage partent vers leur adresse DÉDIÉE. Repli "
        "systématique sur la boîte RH, envoi en arrière-plan JAMAIS bloquant, chaque envoi journalisé "
        "(logs/journal-emails.log). Map complète : annexe B de l'édition complète et classeur "
        "/api/download-routage."))
    STORY.append(tableau(
        ["Type de demande", "Destinataire principal", "Copie automatique", "Conf."],
        [["Attestation de travail",
          "Adresse DÉDIÉE attestationTravailEmail ; vide → boîte RH.", "(aucune)", "Oui"],
         ["Attestation de salaire",
          "Adresse DÉDIÉE attestationSalaireEmail ; vide → boîte RH.", "(aucune)", "Oui"],
         ["Congé",
          "MANAGER RESPONSABLE (v0.2.132) ; aucun manager → boîte RH.",
          "COPIE adresse dédiée congeEmail ; vide → copie boîte RH.", "Oui"],
         ["Autorisation de sortie",
          "MANAGER RESPONSABLE (v0.2.132) ; repli : boîte RH.",
          "COPIE adresse dédiée autorisationEmail ; vide → copie boîte RH.", "Oui"],
         ["Parrainage",
          "Adresse DÉDIÉE parrainageEmail ; vide → boîte RH.", "(aucune)", "Oui"]],
        [3.3 * cm, 6.6 * cm, 5.2 * cm, LARGE_UTILE - 15.1 * cm], centre=[3]))
    STORY.append(legende(
        "Tableau 1.3 — Routage par type de demande (résumé) ; confirmation automatique au demandeur pour "
        "les 5 types. Map complète en annexe B de l'édition complète."))
    STORY.append(h2("Capacité mesurée et matériel"))
    STORY.append(p(
        "Charge cible : 1 000 employés, 1 000 fiches par mois, 20 ans d'historique — 240 000 fiches au "
        "terme. Performances mesurées à 240 000 fiches : liste paginée de 0,02 s (première page) à "
        "0,73 s (fin de table), recherche CIN 0,64 s (index SQL déterministe chiffré, jamais de balayage "
        "complet), mémoire du serveur stable sans fuite. Volume vivant estimé à ≈ 27-130 Go sur 20 ans "
        "(base + PDF + journaux), marge interne + 50 % et sauvegardes externes 3-2-1. Matériel "
        "recommandé : CPU 8 cœurs à 3 GHz (OCR, chiffrement AES, scrypt), 16 Go de RAM, SSD système "
        "500 Go + données 2 × 1 To en miroir RAID 1, LAN 1 Gbit/s, onduleur avec arrêt propre "
        "automatique (section 4)."))
    STORY.append(h2("Temps de développement et de test (estimation)"))
    STORY.append(p(
        "Projet réalisé du 12 septembre au 3 octobre 2026 en cycles courts : 55 chantiers documentés, "
        "environ 135 versions numérotées (v0.2.1 à v0.2.135), environ 52 500 lignes de code "
        "applicatif, 36 points d'entrée API, 63 composants d'interface, 13 modèles de données et 548 "
        "scripts livrés, dont 257 dédiés aux tests et vérifications. Chaque version passait par un "
        "build de production, des tests de fumée sur les trois services, des scénarios d'API et des "
        "parcours E2E automatisés au navigateur. Effort équivalent estimé par analogie&nbsp;— ordres de "
        "grandeur à titre indicatif :"))
    STORY.append(tableau(
        ["Poste", "Estimation"],
        [["Développement&nbsp;— conception, code, corrections, documentation",
          "Environ 65 à 90 jours-homme"],
         ["Tests et validation&nbsp;— automatisation, E2E, recette, QA",
          "Environ 25 à 40 jours-homme (près de 30 % du total)"],
         ["Effort total équivalent",
          "Environ 90 à 130 jours-homme&nbsp;— de l'ordre de 4 à 6 mois-homme"]],
        [10.2 * cm, LARGE_UTILE - 10.2 * cm]))
    STORY.append(legende(
        "Tableau 1.4 — Temps de développement et de test (estimation). Calendrier réel : 21 jours "
        "calendaires, plusieurs livraisons par jour ; estimations destinées à dimensionner une "
        "reprise ou une extension du projet."))


def section_2():
    STORY.append(h1("2. Fonctionnalités essentielles"))
    STORY.append(p(
        "Les fonctionnalités ci-dessous sont vérifiables dans le code livré v0.2.174 et décrites telles "
        "qu'elles se manifestent à l'écran et dans les API. L'installation est détaillée en section 3, "
        "l'exploitation quotidienne en section 5 ; la matrice des droits par rôle figure en annexe."))
    STORY.append(h2("Import, extraction et découpage"))
    STORY.append(bul(
        "<b>Import multi-formats</b> : PDF, PNG, JPG, ZIP, XLSX/XLSM/XLS, DOCX — tout autre format est "
        "refusé avec message explicite. Limite de 500 Mo par fichier (erreur 413 au-delà) ; envoi par "
        "lots de 5 fichiers légers, fichiers de plus de 20 Mo envoyés seuls ; archives ZIP profondeur 2 "
        "et 300 entrées maximum. Une ligne ImportLog par fichier traité, avec le taux de fiabilité des "
        "CIN du lot."))
    STORY.append(bul(
        "<b>Extraction et découpage</b> : CIN tunisienne à 8 chiffres isolés (carte biométrique récente "
        "à 9 chiffres reconnue) — la recherche exige le numéro COMPLET (séparateurs intérieurs et casse "
        "tolérés) ; nom, période (plus de 10 formats de dates), net à payer et matricule détectés avec "
        "exclusion des faux positifs ; OCR adaptatif (Tesseract.js, modèle français local) si le texte "
        "extrait est trop court ; un PDF multi-bulletins (y compris scanné), un classeur Excel ou un "
        "document Word regroupant plusieurs employés est découpé en une fiche individuelle par employé, "
        "copies identiques séparées automatiquement."))
    STORY.append(bul(
        "<b>Vérification automatique des CIN après chaque import</b> : chaque fiche est classée « vrai » "
        "(format tunisien authentique : 8 chiffres classique ou 9 biométrique), « faux » (valeur détectée "
        "hors format) ou « non détecté » (aucun CIN lisible) ; le taux de fiabilité s'affiche dans un "
        "encadré du panneau d'import, en badge vert/rouge devant chaque CIN et dans le journal. La "
        "détection des incohérences de nom/prénom (faute de frappe, ordre inversé, écriture différente) "
        "est elle aussi NON BLOQUANTE : le RH garde la décision finale."))
    STORY.append(h2("Recherche et portail employés"))
    STORY.append(bul(
        "<b>Recherche à grande échelle</b> : liste d'administration paginée côté serveur (100 fiches par "
        "page, plafond de l'API à 1 000) et recherche CIN par index SQL déterministe chiffré — parcours "
        "d'index, jamais de balayage complet de la base ; fluide à 240 000 fiches. Garde-fous : recherche "
        "refusée avec message clair tant que l'indexation initiale est incomplète ; CIN de moins de "
        "6 caractères refusé sur une base volumineuse."))
    STORY.append(bul(
        "<b>Portail employés</b> : connexion par CIN + mot de passe + code TOTP — QR d'enrôlement affiché "
        "une seule fois à la première connexion. Liste de toutes les fiches du CIN de session, paginée ou "
        "illimitée (« Tout afficher ») ; chaque fiche s'ouvre ou se télécharge avec sa COPIE SIGNÉE "
        "(PAdES), le tampon étant appliqué à la volée, original intact ; demandes administratives et "
        "documents reçus accessibles depuis le portail ; aucune fiche d'un autre employé n'est accessible "
        "(contrôle côté serveur)."))
    STORY.append(bul(
        "<b>Le fichier stocké n'est jamais réécrit</b> : le tampon est dessiné à la volée sur la copie "
        "servie ; en cas d'erreur de dessin, la fiche est servie sans tampon (jamais bloquant). Les images "
        "de tampon importées sont chiffrées sur le disque (storage/tampons, en-tête PAIESAGE1), comme les "
        "fiches."))
    STORY.append(h2("Comptes, managers, e-mails et demandes"))
    STORY.append(bul(
        "<b>Comptes et managers</b> : quatre rôles appliqués côté serveur — SUPERADMIN, IT, RH et employé "
        "(matrice complète en annexe). Les comptes RH et IT sont créés exclusivement par le "
        "superadministrateur ; l'e-mail automatique au nouvel utilisateur porte un mot de passe initial "
        "VALABLE 15 MINUTES (v0.2.129 : désactivation automatique au-delà, réactivation par un nouveau "
        "mot de passe UNIQUE — historique PasswordHistory). Désignation des managers côté EMPLOYÉS dans "
        "l'onglet « Accès portail » : case « Manager » + liste « Manager responsable », dans la fenêtre "
        "« Mot de passe initial — CIN » ou via le bouton « Manager » du tableau (fenêtre dédiée « Modifier "
        "le manager ») — la modification S'ENREGISTRE AUTOMATIQUEMENT SANS toucher au mot de passe "
        "(v0.2.131 → v0.2.133) ; garde-fous serveur : responsable actif et coché « Manager », "
        "auto-référence impossible, décochage remettant les subordonnés à « Aucun »."))
    STORY.append(bul(
        "<b>E-mails SMTP</b> : panneau réservé aux rôles IT et SUPERADMIN — préréglage Gmail (port 465, "
        "mot de passe d'application de 16 caractères obligatoire) et serveur personnalisé (587 par "
        "défaut) ; sécurité déduite du port (465 = SSL/TLS direct, tout autre port = STARTTLS/plain). "
        "Identifiants chiffrés en base (le mot de passe n'est jamais renvoyé à l'interface) ; chaque "
        "tentative est journalisée dans logs/journal-emails.log avec la réponse SMTP brute."))
    STORY.append(bul(
        "<b>Demandes administratives</b> : cinq types créés depuis le portail — attestations (un seul "
        "bouton, aucune saisie), congé, autorisation de sortie (PLUS AUCUN « Responsable N+1 », v0.2.132), "
        "parrainage ; référence DEM-AAAA-NNNNN. Aiguillage automatique : e-mail PRINCIPAL au manager avec "
        "la consigne « VALIDATION PAR E-MAIL », COPIE informative au service RH, CONFIRMATION avec "
        "récapitulatif à l'employé — envoi en ARRIÈRE-PLAN jamais bloquant, repli service RH à défaut de "
        "manager. <b>Validation à DEUX ÉTAPES (v0.2.168)</b> pour le congé et l'autorisation : l'acceptation "
        "du manager ET du service RH est requise — aucun PDF signé tant que les deux n'ont pas accepté "
        "(quel que soit l'ordre des réponses, statut manager correctif inclus), refus de l'un des deux = "
        "« Refusée » immédiat (« Refusée par le Manager » / « Refusée par les RH ») sans attendre l'autre ; "
        "TOUTES les pièces jointes fournies par les décideurs sont transmises à l'employé avec le PDF de "
        "décision, acceptée comme refusée, sans aucune perte (v0.2.168 → v0.2.172, certifié campagne "
        "réelle 42/42). Le document de réponse, tamponné et signé, est visible dans « Mes documents » et "
        "JOINT à la notification de l'employé pour TOUS les types."))
    STORY.append(bul(
        "<b>Signature PAdES et cachet</b> : module « API de certification &amp; signature » configuré par "
        "le SUPERADMINISTRATEUR seul (v0.2.126 — mode LOCALE, moteur 100 % node : node:crypto + "
        "node-forge, ou API_EXTERNE Test/Production) ; fiches signées AUTOMATIQUEMENT à l'import (cache "
        "par empreinte), réponses signées AVANT envoi, copies signées conservées et téléchargeables par "
        "l'employé ; cachet « SIGNATURE ÉLECTRONIQUE » (rectangle ou rond) alimenté par le certificat, "
        "contenu choisi via le formulaire « Contenu du cachet » (v0.2.128) — JAMAIS apposé si la "
        "signature PAdES échoue sur les mêmes octets."))
    STORY.append(bul(
        "<b>Tampon et QR configurables</b> : image de cachet/signature (PNG/JPEG jusqu'à 8 Mo), ligne de "
        "texte, mention légale datée, QR à quatre modes de contenu (données de la fiche avec empreinte de "
        "contrôle HMAC, URL de vérification, image fournie, texte libre) ; positionnement libre sur toute "
        "la feuille — décalages horizontal/vertical, largeur/taille de 40 à 1 200 points, rotation de "
        "0° à 360° par élément, aperçu A4 interactif avec glisser-déposer ; configurations PROPRES pour "
        "l'Import et les Réponses, chacune avec SON certificat de signature DÉDIÉ."))
    STORY.append(h2("Tableau « Accès portail » (v0.2.134) et outils d'exploitation"))
    STORY.append(bul(
        "<b>Tableau « Accès portail » (v0.2.134)</b> : affichage amélioré — colonnes redimensionnables "
        "par glisser avec largeurs minimales garanties par colonne (double-clic sur la séparation pour "
        "réinitialiser), défilement horizontal fluide sans déformation des colonnes, boutons d'action "
        "(Envoyer l'e-mail, Manager, Réinitialiser, Désactiver…) sans chevauchement et sans jamais masquer "
        "le nom, le prénom, le matricule, l'e-mail ou le statut."))
    STORY.append(bul(
        "<b>Outils d'exploitation intégrés</b> : chiffrement outillé (chiffrer-base.js — idempotent, "
        "sauvegarde préalable automatique ; chiffrer-storage.js --verifier) ; sauvegarde de base chiffrée "
        "au format .pgb (AES-256-GCM, rotation de 10) avec options --liste et --restaurer (contrôle "
        "sha256) ; mode silencieux Windows (démarrage/arrêt/état sans fenêtre, PIDs dans "
        "logs/auto-rh-processus.json) ; sécurisation disque automatique à chaque démarrage — droits "
        "restrictifs sur .env, db, storage, logs, backups (scripts/securiser-auto.js)."))


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
    STORY.append(h2("Mise en service rapide — liste de contrôle"))
    for etape in [
        "<b>1.</b> Extraire l'archive servicerh-scripts-site-web.zip dans un dossier sans accents ni "
        "espaces (ex. C:\\AutoRH) et installer Node.js 22 LTS.",
        "<b>2.</b> npm install · npx prisma generate · npx prisma db push · npm run build.",
        "<b>3.</b> Démarrer (DEMARRER-SILENCIEUX-WINDOWS.vbs ou DEMARRER-TOUT-LINUX-MAC.sh) et vérifier "
        "http://localhost:4000 — état détaillé dans logs/demarrage-etat.txt.",
        "<b>4.</b> Créer le SuperAdmin (CREER-SUPERADMIN-WINDOWS.bat), puis le premier compte RH/IT "
        "(onglet Utilisateurs) — mot de passe initial reçu par e-mail, valable 15 minutes.",
        "<b>5.</b> Configurer le SMTP (onglet Paramètres — rôles IT/SuperAdmin) et tester l'envoi.",
        "<b>6.</b> Import d'essai (dossier test-data, 20 fiches) puis recherche d'un CIN complet — une "
        "recherche partielle doit donner 0 résultat.",
        "<b>7.</b> Créer un accès portail (onglet Accès portail) et vérifier la connexion employé sur le "
        "port 4001 (CIN + mot de passe + code OTP).",
        "<b>8.</b> Sauvegarde de contrôle (SAUVEGARDER-BD-WINDOWS.bat) et copie de .env hors du serveur.",
    ]:
        STORY.append(bul(etape))


def capacite():
    STORY.append(h1("4. Capacité, matériel et fiabilité (20 ans)"))
    STORY.append(p(
        "Charge cible du projet : environ 1 000 employés, 1 000 fiches importées par mois et une "
        "conservation sur 20 ans, soit 240 000 fiches au terme. Les performances ont été mesurées à "
        "240 000 fiches exactes sur les routes HTTP authentifiées : page de liste de 0,02 s (première "
        "page) à 0,73 s au pire (fin de table), recherche CIN à 0,64 s (index SQL déterministe chiffré — "
        "parcours d'index, jamais de balayage complet), mémoire du serveur stable (103 Mo au démarrage, "
        "192 Mo après tous les scénarios, aucune fuite). Le test de charge HTTP simultanée du portail "
        "(jour de paie, 100 à 150 utilisateurs) reste à exécuter avant engagement (R1)."))
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
        "Tableau 4.1 — Projection de stockage à 20 ans (ordres de grandeur décimaux ; 1 Go = "
        "1 000 000 000 octets)."))
    STORY.append(p(
        "Configuration matérielle recommandée : CPU 8 cœurs physiques à 3 GHz ou plus (16 threads — OCR "
        "multi-passes pendant les imports, chiffrement AES sur chaque lecture/écriture, scrypt coûteux à "
        "chaque connexion) ; RAM 16 Go (ECC de préférence), extensible à 32 Go ; disque système 500 Go "
        "SSD ; disque données 2 × 1 To SSD/NVMe identiques en miroir RAID 1 (le SSD réduit la latence des "
        "accès aléatoires SQLite) ; Windows Server 2016+ ou Linux LTS avec Node.js 22, Docker en option ; "
        "LAN 1 Gbit/s ; onduleur (UPS) avec arrêt propre automatique — une coupure pendant une écriture "
        "SQLite peut corrompre la base."))
    STORY.append(bul(
        "<b>Fiabilité sur 20 ans</b> : miroir RAID 1 et remplacement préventif des disques tous les 5 à "
        "7 ans ; règle 3-2-1 pour les sauvegardes externes avec test de restauration trimestriel ; "
        "renouvellement du serveur tous les 5 à 7 ans — migration testée : copier db, storage, backups et "
        ".env vers le nouveau serveur puis restaurer. Taux d'erreur en exploitation : chaque opération "
        "écrit une trace vérifiable (ImportLog par fichier, journal-emails.log avec succes:true/false — "
        "seuil d'alerte indicatif : 2 % sur une journée de paie). Aucune corruption silencieuse n'est "
        "possible : toute altération d'un fichier ou d'un champ invalide l'authentification AES-256-GCM "
        "et déclenche une erreur explicite."))
    STORY.append(bul(
        "<b>Durée de vie</b> : prévoir 3 à 4 générations de matériel et 4 à 6 migrations majeures du "
        "socle (Node, Next.js, Prisma) sur 20 ans ; exporter périodiquement les PDF en clair vers une "
        "archive pérenne (PDF/A si exigence légale) ; au-delà de 2 000 employés ou en multi-sites, "
        "évoluer vers PostgreSQL/MySQL — Prisma change de provider sans réécriture applicative ; revue "
        "annuelle de capacité pour décider à temps. Disponibilité cible : supérieure à 99,5 %."))


def section_4():
    STORY.append(h1("5. Exploitation et dépannage"))
    STORY.append(p(
        "Le projet fournit lanceurs d'état, journaux dédiés, sauvegarde chiffrée outillée et sécurisation "
        "automatique des droits. Ce chapitre réunit l'essentiel : commandes, routine recommandée, mise à "
        "niveau et remèdes aux incidents documentés."))
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
    STORY.append(legende("Tableau 5.1 — Commandes en ligne de commande (options vérifiées dans chaque script)."))
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
    STORY.append(legende("Tableau 5.2 — Routine d'exploitation."))
    STORY.append(p(
        "Point de vigilance capital : une sauvegarde sans le fichier .env (AUTH_SECRET et "
        "AUTO_RH_STORAGE_KEY) est une sauvegarde morte — les fiches seraient irrécupérables après "
        "restauration. Mise à niveau : même séquence que « Après chaque mise à jour » ci-dessus ; les "
        "fichiers multi-fiches importés par une ancienne version (restés fusionnés) se redécoupent par les "
        "scripts scinder-*."))
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
          "À défaut de manager, la demande part au service RH (repli) — le champ « Responsable N+1 » saisi "
          "n'existe plus depuis la v0.2.132."],
         ["Fiches illisibles : « clé de chiffrement du stockage ne correspond pas »",
          "AUTH_SECRET ou AUTO_RH_STORAGE_KEY a changé : restaurer le .env d'origine ; ne JAMAIS "
          "régénérer les clés sur une base existante (rotation de clé : édition complète, §4)."],
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
          "d'import, le journal, l'e-mail du destinataire et le détail de la demande ; jamais bloquante."],
         ["« Port déjà utilisé » au démarrage",
          "ARRETER-SILENCIEUX-WINDOWS.vbs (ou node scripts/auto-rh.js stop) puis redémarrer ; "
          "vérifier avec ETAT-SILENCIEUX-WINDOWS.vbs."],
         ["Employé verrouillé : « Trop de tentatives » (423)",
          "Attendre 15 minutes ou bouton « Déverrouiller » de l'onglet Accès portail ; mot de passe expiré "
          "(15 jours) : changement imposé à la connexion ou réinitialisation par le RH."],
         ["Sessions invalidées après chaque redémarrage Docker",
          "Définir AUTH_SECRET et AUTO_RH_STORAGE_KEY dans le compose ou monter un .env restreint."]],
        [6.2 * cm, LARGE_UTILE - 6.2 * cm]))
    STORY.append(legende("Tableau 5.3 — Dépannage : incidents d'exploitation et remèdes vérifiés."))


def section_5():
    STORY.append(h1("6. Recommandations"))
    STORY.append(p(
        "Ordonnées par priorité au regard de l'objectif déclaré (1 000 employés, 1 000 fiches par mois, "
        "20 ans d'historique). Toutes les versions se cumulent : installer la dernière revient à "
        "bénéficier de l'ensemble des correctifs."))
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
        "<b>R21 — Maintenir le présent README à chaque livraison</b> : intégrer les nouveautés, retirer "
        "l'obsolète, actualiser les annexes (édition complète ET réduite).",
    ]:
        STORY.append(bul(r))


def annexe():
    STORY.append(h1("Annexe — Matrice des droits des rôles"))
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
        ("Modifier la configuration SMTP — dont le routage des demandes : adresses dédiées par type (résumé en section 1) — et tests d'envoi SMTP / IMAP", "Oui", "Non", "Oui"),
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
        "<b>SuperAdmin (8 onglets)</b> : Recherche CIN&nbsp;· Toutes les fiches&nbsp;· Importer (tampon, signature, "
        "certificat)&nbsp;· Accès portail&nbsp;· Demandes (avec la configuration des réponses)&nbsp;· Signature&nbsp;· "
        "Paramètres (module « API de certification &amp; signature »)&nbsp;· Utilisateurs."))
    STORY.append(bul(
        "<b>RH (6 onglets)</b> : Recherche CIN&nbsp;· Toutes les fiches&nbsp;· Importer (tampon, signature)&nbsp;· Accès "
        "portail&nbsp;· Demandes (configuration des réponses)&nbsp;· Signature — ni « Utilisateurs », ni "
        "« Paramètres » (aucun accès SMTP)."))
    STORY.append(bul(
        "<b>IT (2 onglets)</b> : Paramètres (SMTP seul)&nbsp;· Utilisateurs (consultation seule) — le tampon, "
        "la signature, le certificat, les fiches, les accès portail et les demandes en sont retirés."))
    STORY.append(h2("Le portail employé (port 4001)"))
    STORY.append(bul(
        "Connexion CIN + mot de passe + code OTP (2FA TOTP à chaque connexion) ; mot de passe initial à "
        "usage unique, changé obligatoirement à la première connexion puis tous les 15 jours."))
    STORY.append(bul(
        "Consultation de SES fiches de paie uniquement (CIN de la session) — copies SIGNÉES "
        "téléchargeables, tampon appliqué à la volée, original intact ; e-mail de notification "
        "renseignable (stocké chiffré)."))
    STORY.append(bul(
        "Demandes administratives (5 types) : attestations en un seul bouton ; congé et autorisation de "
        "sortie sans « Responsable N+1 » (aiguillage automatique manager + copie RH + confirmation "
        "employé) ; parrainage. Suivi dans « Mes demandes », documents de réponse dans « Mes documents » ; "
        "aucune fonction d'administration, aucune API d'administration exposée."))
    STORY.append(h2("Principes appliqués"))
    STORY.append(bul(
        "Toute restriction est DOUBLE : réponse 403 côté serveur (code FONCTIONNALITE_NON_AUTORISEE_IT "
        "pour le rôle IT) ET masquage de l'élément dans l'interface — jamais l'un sans l'autre."))
    STORY.append(bul(
        "Aucune inscription libre : les comptes RH et IT sont créés exclusivement par le "
        "superadministrateur ; mot de passe initial valable 15 minutes, aucun ancien mot de passe "
        "réutilisable (historique PasswordHistory) ; mot de passe expiré : toute API de données répond 403 "
        "jusqu'au changement, et tout changement révoque TOUTES les sessions antérieures."))
    STORY.append(bul(
        "La modification du manager d'un employé (bouton « Manager » de l'onglet Accès portail) ne touche "
        "JAMAIS à son mot de passe : aucun mot de passe initial n'est émis, les sessions restent valides "
        "(v0.2.133)."))
    STORY.append(bul(
        "Données sensibles chiffrées AES-256-GCM : fiches de paie, adresses e-mail, certificat de "
        "signature ; mots de passe hachés scrypt (sel aléatoire) — ni chiffrés ni déchiffrables, par "
        "conception. Le portail employé reste accessible indépendamment des trois rôles d'administration."))


# ---- Assemblage -------------------------------------------------------------

ENTETE = "AutoRH — Documentation technique et README officiel — édition réduite " + EDITION


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
        "V0.2.174", "AutoRH", "ÉDITION RÉDUITE",
        "VALABLE 15 MINUTES", "COMPTE_EXPIRE_INITIAL",
        "PasswordHistory", "Modifier le manager", "MANAGER RESPONSABLE",
        "v0.2.126", "v0.2.128", "v0.2.129", "v0.2.131", "v0.2.132", "v0.2.133", "v0.2.134",
        "v0.2.168", "v0.2.172", "DEUX ÉTAPES", "Refusée par le Manager",
        "Refusée par les RH",
        "Matrice des droits", "PAdES", "API de certification", "Contenu du cachet",
        "Onglets visibles", "SuperAdmin (8 onglets)", "RH (6 onglets)", "IT (2 onglets)",
        "240 000", "AES-256-GCM", "PAIESAGE1", "DEM-AAAA-NNNNN",
        "VALIDATION PAR E-MAIL", "Responsable N+1", "FONCTIONNALITE_NON_AUTORISEE_IT",
        "AUTO_RH_STORAGE_KEY", "portail-server.js", "port 4000", "port 4001",
        "Tableau 1.1", "Tableau 1.2", "Tableau 1.3", "Tableau 4.1",
        "Tableau 5.1", "Tableau 5.2", "Tableau 5.3", "Mise en service rapide",
        "Temps de développement et de test", "jours-homme", "Tableau 1.4", "12 septembre",
    ]
    sans_espaces = "".join(texte_complet.split())
    # Comparaison robuste : le marqueur est aussi testé sous forme compacte
    # (les retours à la ligne de l'extraction peuvent couper une phrase).
    manquants = [a for a in attendus
                 if a not in texte_complet
                 and "".join(a.split()) not in sans_espaces]
    assert not manquants, "texte manquant dans le PDF : %s" % manquants
    return nb


def md5f(p_):
    return hashlib.md5(open(p_, "rb").read()).hexdigest()


def main():
    doc = SimpleDocTemplate(
        PDF_DL, pagesize=A4,
        leftMargin=MARGE_G, rightMargin=MARGE_D,
        topMargin=MARGE_H, bottomMargin=MARGE_B,
        title="AutoRH — README officiel — édition réduite v0.2.174",
        author="AutoRH",
        subject="Documentation technique réduite : fiches de paie, demandes administratives et documents RH",
        creator="AutoRH",
    )
    page_couverture()
    section_1()
    section_2()
    section_3()
    capacite()
    section_4()
    section_5()
    annexe()
    doc.build(STORY, onFirstPage=_premiere, onLaterPages=_pied)

    nb = verifier(PDF_DL)
    shutil.copy2(PDF_DL, PDF_VERSIONNE)
    shutil.copy2(PDF_DL, PDF_RACINE)
    print("OK : édition réduite %s — %d pages (tous les marqueurs de contrôle présents)." % (EDITION, nb))
    for p_ in (PDF_DL, PDF_VERSIONNE, PDF_RACINE):
        print("  %s — %d octets — md5 %s" % (p_, os.path.getsize(p_), md5f(p_)))


if __name__ == "__main__":
    main()
