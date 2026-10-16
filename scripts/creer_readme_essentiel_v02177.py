#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
README officiel AutoRH — ÉDITION ESSENTIELLE v0.2.177 (~10-11 pages).

Demande utilisateur : « dans le contenu de readme pdf faire réduire en
supprimant les informations inutiles et ajouter combien de temps prend ce
projet — ces informations existent dans les autres readme pdf mais dans le
nouveau readme pdf n'existe pas ». Cette édition :
  • RÉDUIT la documentation : la pile technique détaillée, le routage des
    e-mails détaillé, la projection de capacité à 20 ans, les recommandations
    R1-R21 et les longs développements historiques sont SUPPRIMÉS ;
  • AJOUTE la DURÉE DU PROJET (section 1.2, mise en avant dès la couverture) :
    calendrier réel 12 septembre → 11 octobre 2026 (30 jours calendaires,
    176 versions) + estimation d'effort 90-130 jours-homme (info présente
    dans les éditions v0.2.133/134/réduite, reprise et ACTUALISée ici) ;
  • DOCUMENTE le correctif 405 (v0.2.175), l'état v0.2.176 et la règle
    v0.2.177 « confidentialité de la décision finale » dans le portail employé
    (statut final affiché uniquement après les réponses des RH ET du manager,
    pièces jointes des réponses affichées en même temps).

Sorties (même contenu pour les deux noms, compatibilité des références) :
  download/servicerh-readme-technique-v0.2.177.pdf  (+ copie générique)
  download/servicerh-readme-technique-reduit-v0.2.177.pdf (+ copie générique)
  racine : servicerh-readme-technique.pdf / servicerh-readme-technique-reduit.pdf
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
EDITION = "v0.2.177"

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
FOND_CODE = colors.HexColor("#f4f6f5")
VERT_OUI = colors.HexColor("#1c6b40")
ROUGE_NON = colors.HexColor("#9c2f2f")

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


def tableau(entetes, lignes, largeurs, centre=None):
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
    t.setStyle(TableStyle(cmds))
    return t


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


def filet():
    return HRFlowable(width="100%", thickness=0.7, color=LIGNE, spaceBefore=2, spaceAfter=8)


def espacer(txt):
    return " ".join(list(txt.replace("·", "·")))


# === CONTENU ================================================================
STORY = []


def page_couverture():
    STORY.append(Paragraph(espacer("README OFFICIEL · ÉDITION ESSENTIELLE · V0.2.177"), S["bande"]))
    STORY.append(p("AutoRH", "titre"))
    STORY.append(p("Fiches de paie, demandes administratives et documents RH", "sous-titre"))
    STORY.append(p(
        "Édition ESSENTIELLE : les informations inutiles à l'exploitation ont été retirées, la "
        "documentation tient en une dizaine de pages. AutoRH couvre les fiches de paie ET les "
        "demandes administratives : le service RH importe en masse les bulletins produits par Sage "
        "(PDF, images, ZIP, Excel, Word) ; l'application détecte automatiquement CIN, nom, période, "
        "net à payer et matricule, puis indexe chaque fiche (SQLite). Chaque employé consulte SES "
        "fiches — signées électroniquement — et suit ses demandes via un portail sécurisé par CIN, "
        "mot de passe et code OTP. Les demandes de congé et d'autorisation partent automatiquement "
        "au manager responsable, avec copie au service RH et confirmation à l'employé. Depuis la "
        "v0.2.168, elles suivent une <b>VALIDATION À DEUX ÉTAPES</b> : acceptation du manager ET du "
        "service RH requise, refus immédiat de l'un des deux, et TOUTES les pièces jointes des "
        "décideurs sont transmises à l'employé avec le PDF signé (v0.2.168 → v0.2.172)."))
    STORY.append(p("Administration 4000  ·  Portail 4001  ·  Pont d'aperçu 3000  ·  CIN 8 chiffres  ·  "
                   "AES-256-GCM  ·  Durée du projet : 30 jours calendaires (90-130 jours-homme équivalents)",
                   "badges"))
    STORY.append(filet())
    STORY.append(p("<b>Sommaire</b>", "corps"))
    sommaire = [
        "1. Présentation express et durée du projet — services et ports, sécurité en bref, temps de développement et de test",
        "2. Fonctionnalités essentielles — import, portail, comptes et managers, demandes à deux étapes, signature",
        "3. Installation et démarrage — prérequis, lanceurs, secrets .env, liste de contrôle",
        "4. Exploitation et dépannage — commandes, routine, remèdes vérifiés",
        "5. Historique récent des versions",
        "Annexe — Matrice des droits des rôles (SuperAdmin, RH, IT ; portail employé)",
    ]
    for s_ in sommaire:
        STORY.append(p(s_, "bul"))
    STORY.append(Spacer(1, 6))
    STORY.append(filet())
    blocs = [
        ("D U R É E   D U   P R O J E T",
         "Réalisé du 12 septembre au 11 octobre 2026 — <b>30 jours calendaires</b>, 177 versions "
         "numérotées, plusieurs livraisons par jour. Effort équivalent estimé : <b>90 à 130 "
         "jours-homme</b> (4 à 6 mois-homme), dont 25 à 40 jours-homme de tests — détail en "
         "section 1.2."),
        ("D I F F U S I O N",
         "Les quatre livrables sont téléchargeables sans connexion depuis l'administration : "
         "/api/download-readme (présent README), /api/download-scripts (archive du code), "
         "/api/download-matrice (matrice des rôles Excel), /api/download-routage (map de routage "
         "des e-mails). Fichier : download/servicerh-readme-technique-v0.2.177.pdf."),
        ("S O U R C E S",
         "Code source livré v0.2.177 · README-DEPLOIEMENT-LOCAL.md (guide d'installation illustré) · "
         "notes LIRE-MOI-CORRECTIF-*.txt (détail de chaque livraison)."),
        ("D A T E   D ' É D I T I O N",
         "11 octobre 2026 — fondée sur le code v0.2.177 ; maintenue à jour au fil des livraisons."),
    ]
    for titre, corps in blocs:
        STORY.append(p(titre, "pivot"))
        STORY.append(p(corps))
    STORY.append(Spacer(1, 8))
    STORY.append(p("F I C H E S   D E   P A I E   E T   D E M A N D E S   A D M I N I S T R A T I V E S   ·   F R",
                   "badges"))


def section_1():
    STORY.append(h1("1. Présentation express et durée du projet"))
    STORY.append(p(
        "AutoRH est une application web de gestion des services RH, installable sur un poste du "
        "réseau interne (Windows, Linux ou macOS) sans aucune base de données externe. Deux services "
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
    STORY.append(h2("Sécurité en bref"))
    STORY.append(bul(
        "<b>Comptes et sessions</b> : mots de passe hachés scrypt (8 caractères minimum, 4 classes), "
        "expiration 15 jours avec changement forcé ; mot de passe initial des comptes RH/IT VALABLE "
        "15 MINUTES (v0.2.129) ; sessions admin par cookie httpOnly signé. Anti force-brute : 10 échecs "
        "admin par IP puis 429 ; 5 échecs portail puis verrouillage 15 minutes (423). Portail à double "
        "facteur TOTP : QR d'enrôlement affiché une seule fois, code à 6 chiffres à chaque connexion. "
        "Journal de sécurité : logs/auth-securite.log."))
    STORY.append(bul(
        "<b>Chiffrement AES-256-GCM double</b> : champs sensibles de la base (middleware Prisma) ET "
        "chaque fichier sur disque (en-tête PAIESAGE1) — fiches, tampons, certificats et documents des "
        "demandes. Tout repose sur le fichier .env (AUTH_SECRET, AUTO_RH_STORAGE_KEY) : sa perte rend "
        "les fiches mathématiquement irrécupérables — le sauvegarder AVEC les données et ne JAMAIS "
        "régénérer les clés sur une installation existante."))
    STORY.append(bul(
        "<b>Autorisations</b> : session requise sur toutes les API ; rôles appliqués côté serveur ET "
        "éléments masqués dans l'interface (double restriction — matrice en annexe) ; en-têtes HTTP "
        "anti-clickjacking, nosniff, HSTS, CSP ; droits disque restrictifs imposés au démarrage sur "
        ".env, db, storage, logs, backups (scripts/securiser-auto.js)."))
    STORY.append(h2("Durée du projet — développement et test"))
    STORY.append(p(
        "Le projet a été réalisé du <b>12 septembre au 11 octobre 2026</b>, soit <b>30 jours "
        "calendaires</b>, en cycles courts : <b>177 versions numérotées</b> (v0.2.1 à v0.2.177), "
        "plusieurs livraisons par jour, 755 scripts livrés dont plus de 330 dédiés aux tests et "
        "vérifications, environ 70 000 lignes de code applicatif, 34 points d'entrée API, 65 "
        "composants d'interface et 14 modèles de données. Chaque version passait par un build de "
        "production, des tests de fumée sur les trois services, des scénarios d'API et des parcours "
        "E2E automatisés ; les fonctionnalités sensibles ont été certifiées en conditions réelles "
        "(Gmail/Zoho) : transfert des pièces jointes 42/42 (v0.2.172), validation à deux étapes 36 "
        "vérifications (v0.2.173), correctif de l'erreur 405 à l'import 17/17 (v0.2.175). L'effort "
        "équivalent estimé par analogie — ordres de grandeur destinés à dimensionner une reprise ou "
        "une extension du projet :"))
    STORY.append(tableau(
        ["Poste", "Estimation"],
        [["Développement — conception, code, corrections, documentation",
          "Environ 65 à 90 jours-homme"],
         ["Tests et validation — automatisation, E2E, recette, QA",
          "Environ 25 à 40 jours-homme (près de 30 % du total)"],
         ["Effort total équivalent",
          "Environ 90 à 130 jours-homme — de l'ordre de 4 à 6 mois-homme"]],
        [10.2 * cm, LARGE_UTILE - 10.2 * cm]))
    STORY.append(legende(
        "Tableau 1.2 — Temps de développement et de test. Calendrier réel : 30 jours calendaires "
        "(12 septembre → 11 octobre 2026), plusieurs livraisons par jour ; les estimations d'effort "
        "restent indicatives."))
    STORY.append(h2("Routage des e-mails des demandes (résumé)"))
    STORY.append(p(
        "L'employé ne saisit AUCUN destinataire : le congé et l'autorisation de sortie partent au "
        "MANAGER RESPONSABLE affecté par le RH dans l'onglet « Accès portail » (v0.2.132), avec COPIE "
        "au service RH et CONFIRMATION à l'employé ; les attestations et le parrainage partent vers "
        "leurs adresses DÉDIÉES configurables (repli : boîte RH). Envoi en arrière-plan JAMAIS "
        "bloquant, chaque envoi journalisé (logs/journal-emails.log) ; map complète : classeur "
        "/api/download-routage."))


def section_2():
    STORY.append(h1("2. Fonctionnalités essentielles"))
    STORY.append(p(
        "Fonctionnalités vérifiables dans le code livré v0.2.177. Installation : section 3 ; "
        "exploitation quotidienne : section 4 ; droits par rôle : annexe."))
    STORY.append(h2("Import, extraction et découpage des fiches de paie"))
    STORY.append(bul(
        "<b>Import multi-formats</b> : PDF, PNG, JPG, ZIP, XLSX/XLSM/XLS, DOCX (500 Mo max par fichier, "
        "lots de 5 fichiers légers) ; CIN tunisienne à 8 chiffres isolée (biométrique 9 chiffres "
        "reconnue), nom, période (plus de 10 formats), net à payer et matricule détectés automatiquement ; "
        "OCR adaptatif hors ligne (Tesseract.js, modèle français local) si le texte extrait est trop "
        "court ; un PDF multi-bulletins, un classeur Excel ou un Word regroupant plusieurs employés est "
        "découpé en une fiche individuelle par employé. Vérification automatique des CIN après chaque "
        "import (vrai/faux/non détecté + taux de fiabilité affiché, détection d'incohérences de nom "
        "non bloquante)."))
    STORY.append(h2("Recherche et portail employés"))
    STORY.append(bul(
        "<b>Recherche</b> : liste d'administration paginée côté serveur (100 fiches/page) et recherche "
        "CIN par index SQL déterministe CHIFFRÉ — fluide à 240 000 fiches ; la recherche exige le numéro "
        "COMPLET. <b>Portail</b> : connexion CIN + mot de passe + code TOTP (QR d'enrôlement affiché une "
        "seule fois) ; liste des fiches du CIN de session, chaque fiche s'ouvre ou se télécharge avec sa "
        "COPIE SIGNÉE (PAdES), tampon appliqué à la volée, original intact ; « Mes demandes » et « Mes "
        "documents » ; aucune fiche d'un autre employé n'est accessible (contrôle côté serveur)."))
    STORY.append(h2("Comptes, managers et messagerie"))
    STORY.append(bul(
        "Quatre rôles appliqués côté serveur — SUPERADMIN, IT, RH, employé (annexe). Comptes RH/IT créés "
        "exclusivement par le superadministrateur (mot de passe initial par e-mail, VALABLE 15 MINUTES). "
        "Désignation des managers dans l'onglet « Accès portail » (case « Manager » + liste « Manager "
        "responsable ») — modification enregistrée SANS toucher au mot de passe. Panneau SMTP réservé "
        "aux rôles IT/SuperAdmin : préréglage Gmail (port 465, mot de passe d'application obligatoire) "
        "ou serveur personnalisé ; identifiants chiffrés en base, chaque envoi journalisé."))
    STORY.append(h2("Demandes administratives — validation à DEUX ÉTAPES"))
    STORY.append(bul(
        "Cinq types créés depuis le portail : attestations (un bouton), congé, autorisation de sortie, "
        "parrainage — référence DEM-AAAA-NNNNN. Pour le congé et l'autorisation, <b>l'acceptation du "
        "manager ET du service RH est requise</b> (v0.2.168) : aucun PDF signé tant que les deux n'ont "
        "pas accepté, quel que soit l'ordre des réponses (statut manager correctif inclus, v0.2.173) ; "
        "refus de l'un des deux = « Refusée par le Manager » / « Refusée par les RH » IMMÉDIAT sans "
        "attendre l'autre. Les réponses se font par simple e-mail (réponses RH via Gmail, manager via "
        "sa boîte) avec pièces jointes éventuelles : <b>TOUTES les pièces jointes des décideurs sont "
        "transmises à l'employé</b> avec le PDF de décision, acceptée comme refusée, sans aucune perte "
        "(v0.2.168 → v0.2.172, certifié campagne réelle 42/42). Le document de réponse, tamponné et "
        "signé, est visible dans « Mes documents » et joint à la notification."))
    STORY.append(h2("Signature électronique, tampon et QR"))
    STORY.append(bul(
        "Module « API de certification &amp; signature » configuré par le SUPERADMINISTRATEUR seul "
        "(mode LOCALE 100 % node : node:crypto + node-forge, ou API_EXTERNE) ; fiches signées "
        "AUTOMATIQUEMENT à l'import, réponses signées AVANT envoi, copies signées téléchargeables par "
        "l'employé. Cachet « SIGNATURE ÉLECTRONIQUE » (rectangle ou rond), image de cachet importée, "
        "QR à quatre modes de contenu, positionnement libre sur toute la feuille (aperçu A4 "
        "glisser-déposer) ; configurations PROPRES pour l'Import et les Réponses, chacune avec SON "
        "certificat DÉDIÉ — le cachet n'est JAMAIS apposé si la signature PAdES échoue."))
    STORY.append(h2("Chiffrement et outils d'exploitation"))
    STORY.append(bul(
        "Chiffrement outillé (chiffrer-base.js idempotent ; chiffrer-storage.js --verifier | --chiffrer | "
        "--dechiffrer) ; sauvegarde de base chiffrée .pgb (AES-256-GCM, rotation de 10, --liste / "
        "--restaurer) ; mode silencieux Windows (démarrage/arrêt/état sans fenêtre) ; sécurisation "
        "disque automatique à chaque démarrage ; lanceurs reconstruisant le build si le marqueur de "
        "version change (correctif de l'erreur 405, v0.2.175)."))


def section_3():
    STORY.append(h1("3. Installation et démarrage"))
    STORY.append(h2("Prérequis et commandes de base"))
    STORY.append(bul(
        "Node.js 22 LTS recommandé ; npm inclus ; aucune autre base à installer (SQLite embarqué via "
        "Prisma). Internet nécessaire uniquement à la première installation ; l'application fonctionne "
        "ensuite entièrement hors ligne. Extraire l'archive servicerh-scripts-site-web.zip dans un "
        "dossier sans accents ni espaces (par exemple C:\\AutoRH). En cas d'erreur ERESOLVE au "
        "npm install : utiliser package.json et package-lock.json livrés, supprimer node_modules et "
        "package-lock.json puis relancer (LIRE-MOI-FIX-INSTALL.txt)."))
    STORY.append(code(
        "npm install<br/>"
        "npx prisma generate &amp;&amp; npx prisma db push<br/>"
        "npm run build<br/>"
        "npm run start&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;# administration — port 4000<br/>"
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
        "AUTH_SECRET et AUTO_RH_STORAGE_KEY dans le compose ou monter un .env restreint. "
        "<b>Réseau local</b> : les deux serveurs écoutent sur 0.0.0.0 — http://192.168.x.x:4000 et :4001 ; "
        "si la page ne s'affiche pas depuis un autre poste : autoriser le trafic entrant TCP 4000 ET 4001 "
        "dans le pare-feu ; demander un bail DHCP fixe pour l'hébergeur."))
    STORY.append(h2("Secrets : fichier .env"))
    STORY.append(bul(
        "Trois valeurs clés : DATABASE_URL (chemin ABSOLU vers db/custom.db), AUTH_SECRET (généré "
        "automatiquement au premier démarrage) et AUTO_RH_STORAGE_KEY (clé de chiffrement du "
        "stockage). La perte de ces clés rend les fiches irrécupérables : sauvegarder .env avec les "
        "données, dans un coffre-fort de secrets ; ne jamais le partager ni régénérer les clés sur une "
        "installation existante. Ports surchargeables : AUTO_RH_PORT_ADMIN et AUTO_RH_PORT_PORTAIL."))
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


def section_4():
    STORY.append(h1("4. Exploitation et dépannage"))
    STORY.append(p(
        "Le projet fournit lanceurs d'état, journaux dédiés, sauvegarde chiffrée outillée et "
        "sécurisation automatique des droits. Ce chapitre réunit l'essentiel : commandes, routine "
        "recommandée et remèdes aux incidents documentés."))
    STORY.append(tableau(
        ["Objectif", "Commande"],
        [["Sauvegarde / restauration",
          "node scripts/sauvegarde-bd.js --liste ; --restaurer \"SERVICE-RH-BD-...\" --sortie db/custom.db"],
         ["Superadministrateur",
          "node scripts/creer-superadmin.js --creer --email a@b.tn --nom \"Nom\" --password XXX ; "
          "--promouvoir --email a@b.tn"],
         ["Chiffrement base / stockage",
          "node scripts/chiffrer-base.js (idempotent, sauvegarde préalable) ; "
          "node scripts/chiffrer-storage.js --verifier"],
         ["Services",
          "node scripts/auto-rh.js start | stop | restart | status"],
         ["Découpage des anciens fichiers",
          "node scripts/scinder-pdfs-multipages.js --verifier (idem scinder-excel- et scinder-docx-)"],
         ["État et journaux",
          "ETAT-SILENCIEUX-WINDOWS.vbs ; JOURNAUX-SILENCIEUX-WINDOWS.vbs ; logs/auto-rh-processus.json"]],
        [4.6 * cm, LARGE_UTILE - 4.6 * cm]))
    STORY.append(legende("Tableau 4.1 — Commandes en ligne de commande (options vérifiées dans chaque script)."))
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
    STORY.append(legende("Tableau 4.2 — Routine d'exploitation."))
    STORY.append(p(
        "Point de vigilance capital : une sauvegarde sans le fichier .env (AUTH_SECRET et "
        "AUTO_RH_STORAGE_KEY) est une sauvegarde morte — les fiches seraient irrécupérables après "
        "restauration."))
    STORY.append(h2("Dépannage : incidents d'exploitation et remèdes vérifiés"))
    STORY.append(tableau(
        ["Symptôme", "Remède vérifié"],
        [["« Node.js n'est pas reconnu » ou lanceur qui s'arrête immédiatement",
          "Réinstaller Node.js 22 LTS (nodejs.org), rouvrir le terminal puis relancer le lanceur."],
         ["Erreur 500 au démarrage, base absente",
          "Les lanceurs recréent le .env et exécutent prisma db push ; manuellement : npx prisma db push "
          "puis redémarrer."],
         ["Recherche lente ou 409 « indexation requise »",
          "Cliquer « Indexer la base pour la recherche » (idempotent, sans arrêt de service)."],
         ["Fiche importée introuvable en recherche",
          "La recherche exige le CIN COMPLET (séparateurs intérieurs et casse tolérés) ; un scan sans "
          "couche texte exige un réimport lisible (l'OCR ne s'applique qu'aux documents contenant "
          "quelques caractères)."],
         ["Erreur 405 à l'importation des fiches de paie",
          "Build PÉRIMÉ ne connaissant pas la route d'upload (correctif v0.2.175) : relancer npm run "
          "build puis redémarrer — les lanceurs livrés v0.2.175+ vérifient le marqueur de version et "
          "reconstruisent automatiquement si besoin."],
         ["« Ce compte a été automatiquement désactivé : le délai de 15 minutes … est dépassé »",
          "Le mot de passe initial n'a pas servi dans les 15 minutes : le SuperAdmin clique « Réactiver » "
          "dans l'onglet Utilisateurs — un NOUVEAU mot de passe unique est envoyé par e-mail."],
         ["Le manager ne reçoit pas les demandes de congé / autorisation",
          "Vérifier l'affectation « Manager responsable » dans l'onglet Accès portail : le manager doit "
          "être ACTIF et coché « Manager ». À défaut de manager, la demande part au service RH (repli)."],
         ["Statut resté « En attente » alors qu'une réponse a été donnée",
          "Corrigé en v0.2.173 : mettre à niveau — la réponse ULTÉRIEURE du second décideur achève la "
          "matrice et déclenche le PDF signé."],
         ["Fiches illisibles : « clé de chiffrement du stockage ne correspond pas »",
          "AUTH_SECRET ou AUTO_RH_STORAGE_KEY a changé : restaurer le .env d'origine ; ne JAMAIS "
          "régénérer les clés sur une base existante."],
         ["« Je ne reçois pas l'e-mail » (accès portail, test SMTP ou notification)",
          "Lire logs/journal-emails.log : chaque tentative y est consignée avec la réponse SMTP brute "
          "(Gmail : mot de passe d'application de 16 caractères obligatoire)."],
         ["Un document du dossier storage reste lisible sur le disque",
          "Il est chiffré AUTOMATIQUEMENT au démarrage du portail (balayage silencieux) ; pour forcer "
          "immédiatement : node scripts/chiffrer-storage.js. Les copies de tampons restent volontairement "
          "chiffrées (PAIESAGE1) et sont déchiffrées à la volée."],
         ["Après une mise à jour, le QR, la signature ou l'import ne fonctionnent plus",
          "Build PÉRIMÉ : relancer npm run build puis redémarrer (les lanceurs vérifient le marqueur "
          ".auto-rh-version et reconstruisent si besoin)."],
         ["« Port déjà utilisé » au démarrage",
          "ARRETER-SILENCIEUX-WINDOWS.vbs (ou node scripts/auto-rh.js stop) puis redémarrer ; "
          "vérifier avec ETAT-SILENCIEUX-WINDOWS.vbs."],
         ["Employé verrouillé : « Trop de tentatives » (423)",
          "Attendre 15 minutes ou bouton « Déverrouiller » de l'onglet Accès portail ; mot de passe "
          "expiré (15 jours) : changement imposé à la connexion ou réinitialisation par le RH."],
         ["Sessions invalidées après chaque redémarrage Docker",
          "Définir AUTH_SECRET et AUTO_RH_STORAGE_KEY dans le compose ou monter un .env restreint."]],
        [6.2 * cm, LARGE_UTILE - 6.2 * cm]))
    STORY.append(legende("Tableau 4.3 — Dépannage : incidents d'exploitation et remèdes vérifiés."))


def section_5():
    STORY.append(h1("5. Historique récent des versions"))
    STORY.append(p(
        "Toutes les versions se cumulent : installer la dernière revient à bénéficier de l'ensemble "
        "des correctifs. Les versions antérieures à v0.2.165 (détail complet dans les notes "
        "LIRE-MOI-CORRECTIF-*.txt de l'archive) ne sont pas reprises ici."))
    STORY.append(tableau(
        ["Version", "Apport principal"],
        [["v0.2.165", "Curseurs UID persistants du poller IMAP (aucune réponse relue deux fois)."],
         ["v0.2.168", "VALIDATION À DEUX ÉTAPES des congés/autorisations (matrice manager + RH, refus "
                      "immédiat) ; pièces jointes des réponses collectées."],
         ["v0.2.172", "Transfert au demandeur de TOUTES les pièces jointes des décideurs avec le PDF "
                      "signé — certifié campagne réelle Gmail/Zoho 42/42."],
         ["v0.2.173", "Correctif du statut manager resté « En attente » + campagne de tests obligatoires "
                      "en conditions réelles (36 vérifications) + rapport de test."],
         ["v0.2.174", "README PDF mis à jour dans toutes les parties (éditions complète et réduite)."],
         ["v0.2.175", "CORRECTIF de l'Erreur 405 à l'import des fiches de paie (route d'upload "
                      "restaurée + fra.traineddata OCR) — certifié 17/17."],
         ["v0.2.176", "README réduit à l'essentiel (informations inutiles supprimées) avec la DURÉE DU "
                      "PROJET ajoutée (section 1.2) ; livraison du projet vérifié fonctionnel."],
         ["v0.2.177", "CONFIDENTIALITÉ DE LA DÉCISION dans le portail employé : statut final des "
                      "congés/autorisations affiché uniquement après les réponses du manager ET des "
                      "RH — pièces jointes des réponses révélées en même temps."]],
        [2.6 * cm, LARGE_UTILE - 2.6 * cm]))
    STORY.append(legende("Tableau 5.1 — Historique récent (les versions se cumulent)."))


def annexe():
    STORY.append(h1("Annexe — Matrice des droits des rôles"))
    STORY.append(p(
        "État du code livré v0.2.177. Trois rôles d'administration (SuperAdmin, RH, IT) sur le port "
        "4000 ; l'employé dispose du portail dédié 4001 (bloc ci-après). Le classeur Excel "
        "/api/download-matrice reprend cette matrice."))
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
        ("Module « API de certification &amp; signature électronique » — configuration réservée au SuperAdmin (v0.2.126)", "Oui", "Non", "Non"),
        ("Cachet « Signature électronique » du tampon — rectangle ou rond, contenu choisi (v0.2.128), couvert par la signature PAdES", "Oui", "Oui", "Non"),
    ]))
    STORY.append(Spacer(1, 5))
    STORY.append(pivot("Accès portail par mot de passe"))
    STORY.append(matrice_tableau([
        ("Créer / réinitialiser / activer-désactiver / débloquer / supprimer un accès", "Oui", "Oui", "Non"),
        ("QR code d'accès / réinitialisation du QR", "Oui", "Oui", "Non"),
        ("Envoyer le mot de passe initial par e-mail (adresse enregistrée sur le compte)", "Oui", "Oui", "Non"),
        ("Modifier « Nom » / « Prénom » / « Matricule » / e-mail — répercuté sur toutes les fiches du CIN", "Oui", "Oui", "Non"),
        ("Désigner un employé « Manager » et choisir son « Manager responsable » — SANS réinitialiser le mot de passe", "Oui", "Oui", "Non"),
    ]))
    STORY.append(Spacer(1, 5))
    STORY.append(pivot("Demandes administratives"))
    STORY.append(matrice_tableau([
        ("Liste, détail, traitement (statut + commentaire + notification e-mail) — les 5 types", "Oui", "Oui", "Non"),
        ("Réponse avec document (import direct ; tampon et signature automatiques de la config des réponses)", "Oui", "Oui", "Non"),
        ("Téléchargement des documents de réponse", "Oui", "Oui", "Non"),
        ("Configuration DÉDIÉE du tampon des réponses ET de son certificat de signature", "Oui", "Oui", "Non"),
        ("Journal d'envoi IMAP (outil de diagnostic de la réception automatique)", "Oui", "Non", "Oui"),
    ]))
    STORY.append(Spacer(1, 5))
    STORY.append(pivot("Paramètres techniques — messagerie et comptes"))
    STORY.append(matrice_tableau([
        ("Consulter / modifier la configuration SMTP et tests d'envoi SMTP / IMAP", "Oui", "Non", "Oui"),
        ("Créer / réactiver / activer-désactiver / supprimer un compte RH ou IT ; changer le rôle", "Oui", "Non", "Non"),
        ("Lister les comptes", "Oui", "Non", "Oui (consultation seule)"),
        ("Statistiques du tableau de bord ; changement de son propre mot de passe (expiration 15 jours)", "Oui", "Oui", "Oui"),
    ]))
    STORY.append(legende(
        "« Non » = refusé (403 côté serveur et/ou élément masqué dans l'interface) — les refus IT sont "
        "appliqués proprement côté serveur, sans état intermédiaire. Le dernier compte superadministrateur "
        "actif est protégé contre la suppression et la désactivation."))
    STORY.append(h2("Onglets visibles dans l'interface d'administration"))
    STORY.append(bul(
        "<b>SuperAdmin (8 onglets)</b> : Recherche CIN · Toutes les fiches · Importer · Accès portail · "
        "Demandes · Signature · Paramètres · Utilisateurs. <b>RH (6 onglets)</b> : Recherche CIN · "
        "Toutes les fiches · Importer · Accès portail · Demandes · Signature. <b>IT (2 onglets)</b> : "
        "Paramètres (SMTP seul) · Utilisateurs (consultation seule)."))
    STORY.append(h2("Le portail employé (port 4001)"))
    STORY.append(bul(
        "Connexion CIN + mot de passe + code OTP (2FA TOTP à chaque connexion) ; mot de passe initial à "
        "usage unique, changé obligatoirement à la première connexion puis tous les 15 jours. "
        "Consultation de SES fiches uniquement — copies SIGNÉES téléchargeables ; demandes "
        "administratives (5 types), suivi dans « Mes demandes », documents de réponse dans « Mes "
        "documents » ; aucune fonction d'administration exposée."))
    STORY.append(bul(
        "<b>Confidentialité de la décision (v0.2.177)</b> : pour les demandes de congé et d'autorisation "
        "de sortie, le statut final n'est affiché dans « Mes demandes » QU'APRÈS les réponses du manager "
        "ET du service RH. Tant que la validation n'est pas complète, la demande reste « En attente » "
        "(les décisions d'étape, le commentaire de traitement et les pièces jointes des réponses restent "
        "masqués, une note l'indique à l'employé) ; le statut final et les pièces jointes transmises "
        "apparaissent ENSEMBLE dès que manager et RH ont répondu. Un refus, immédiat et définitif, "
        "est affiché dès qu'il est prononcé (il achève la validation). E-mails de décision et "
        "administration RH inchangés."))


# ---- Assemblage -------------------------------------------------------------

ENTETE = "AutoRH — Documentation technique et README officiel — édition essentielle " + EDITION


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
        "V0.2.177", "AutoRH", "ÉDITION ESSENTIELLE",
        "Durée du projet", "30 jours", "12 septembre", "11 octobre 2026",
        "177 versions", "Temps de développement et de test", "jours-homme", "Tableau 1.2",
        "Confidentialité de la décision", "les réponses du manager ET du service RH",
        "VALABLE 15 MINUTES", "mot de passe initial", "15 minutes",
        "MANAGER RESPONSABLE", "v0.2.129", "v0.2.132", "v0.2.168", "v0.2.172", "v0.2.173",
        "v0.2.175", "v0.2.176", "v0.2.177",
        "DEUX ÉTAPES", "Refusée par le Manager", "Refusée par les RH",
        "Matrice des droits", "PAdES", "API de certification",
        "AES-256-GCM", "PAIESAGE1", "DEM-AAAA-NNNNN",
        "AUTO_RH_STORAGE_KEY", "portail-server.js", "port 4000", "port 4001",
        "Tableau 1.1", "Tableau 4.1", "Tableau 4.2", "Tableau 4.3", "Tableau 5.1",
        "Mise en service rapide", "Erreur 405", "42/42", "17/17",
    ]
    sans_espaces = "".join(texte_complet.split())
    manquants = [a for a in attendus
                 if a not in texte_complet
                 and "".join(a.split()) not in sans_espaces]
    assert not manquants, "texte manquant dans le PDF : %s" % manquants
    return nb


def md5f(p_):
    return hashlib.md5(open(p_, "rb").read()).hexdigest()


def main():
    pdf_dl = os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.177.pdf")
    doc = SimpleDocTemplate(
        pdf_dl, pagesize=A4,
        leftMargin=MARGE_G, rightMargin=MARGE_D,
        topMargin=MARGE_H, bottomMargin=MARGE_B,
        title="AutoRH — README officiel — édition essentielle v0.2.177",
        author="AutoRH",
        subject="Documentation essentielle : fiches de paie, demandes administratives, durée du projet",
        creator="AutoRH",
    )
    page_couverture()
    section_1()
    section_2()
    section_3()
    section_4()
    section_5()
    annexe()
    doc.build(STORY, onFirstPage=_premiere, onLaterPages=_pied)

    nb = verifier(pdf_dl)
    cibles = [
        pdf_dl,
        os.path.join(RACINE, "download", "servicerh-readme-technique.pdf"),
        os.path.join(RACINE, "download", "servicerh-readme-technique-reduit-v0.2.177.pdf"),
        os.path.join(RACINE, "download", "servicerh-readme-technique-reduit.pdf"),
        os.path.join(RACINE, "servicerh-readme-technique.pdf"),
        os.path.join(RACINE, "servicerh-readme-technique-reduit.pdf"),
    ]
    for c in cibles:
        if os.path.abspath(c) != os.path.abspath(pdf_dl):
            shutil.copy2(pdf_dl, c)
    print("OK : édition essentielle %s — %d pages (tous les marqueurs de contrôle présents)." % (EDITION, nb))
    for c in cibles:
        print("  %s — %d octets — md5 %s" % (c, os.path.getsize(c), md5f(c)))


if __name__ == "__main__":
    main()
