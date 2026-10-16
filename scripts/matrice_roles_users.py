#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 178/194/198 — Matrice détaillée des rôles de TOUS les utilisateurs Auto-RH.
Audit du code source réel (état v0.2.95) : schéma Prisma, src/lib/auth.ts,
middleware, gardes des 32 routes API livrées (+ /api/download-routage v0.2.94),
page.tsx (onglets), portail-server.js.
Task 198 : routage des e-mails des demandes intégré (MailConfig + 4 champs
dédiés v0.2.94, confirmations au demandeur pour les 5 types, route publique
download-routage, référence API et middleware à jour).
Génère : download/Auto-RH-Matrice-roles-utilisateurs-v0.2.95.xlsx
Ré-exécutable à l'identique.
"""
import sys, os

XLSX_SKILL_DIR = "/home/z/my-project/skills/xlsx"
for sub in [XLSX_SKILL_DIR, os.path.join(XLSX_SKILL_DIR, "templates")]:
    if sub not in sys.path:
        sys.path.insert(0, sub)

from base import *  # noqa: F401,F403 — design tokens + helpers du skill
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.cell.cell import MergedCell
from openpyxl.utils import get_column_letter
import math, unicodedata

OUT = "/home/z/my-project/download/Auto-RH-Matrice-roles-utilisateurs-v0.2.95.xlsx"

# ---------------------------------------------------------------- helpers
OUI_F = lambda: Font(name=FONT_NAME, size=11, color=ACCENT_POSITIVE)
NON_F = lambda: Font(name=FONT_NAME, size=11, color=ACCENT_NEGATIVE)
LIM_F = lambda: Font(name=FONT_NAME, size=11, color=ACCENT_WARNING)
OUI_FILL = PatternFill("solid", fgColor="E8F5E9")
NON_FILL = PatternFill("solid", fgColor="FDEDEC")
LIM_FILL = PatternFill("solid", fgColor="FEF9E7")
CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)


def status_cell(cell, val):
    """Statut Oui / Non / Limité / — stylé avec les accents du design system."""
    cell.value = val
    cell.alignment = CENTER
    if val == "Oui":
        cell.font = OUI_F(); cell.fill = OUI_FILL
    elif val == "Non":
        cell.font = NON_F(); cell.fill = NON_FILL
    elif val == "Limité":
        cell.font = LIM_F(); cell.fill = LIM_FILL
    else:  # "—" non applicable
        cell.font = Font(name=FONT_NAME, size=11, color=NEUTRAL_600)
        cell.alignment = CENTER


def _disp_w(s):
    """Largeur d'affichage estimée (CJK ~1,7 ; autres ~1)."""
    w = 0.0
    for ch in str(s):
        w += 1.7 if unicodedata.east_asian_width(ch) in ("W", "F") else 1.0
    return w


def auto_fit_safe(ws, min_width=8, max_width=40, data_start_row=5):
    """Comme auto_fit_columns du skill, mais tolère les cellules fusionnées
    (lignes de section) et ignore les formules."""
    merged = set()
    for rng in ws.merged_cells.ranges:
        for row in ws[rng.coord]:
            for c in row:
                merged.add(c.coordinate)
    for col_idx in range(2, ws.max_column + 1):
        letter = get_column_letter(col_idx)
        widest = 0.0
        for row_idx in range(data_start_row, ws.max_row + 1):
            cell = ws.cell(row=row_idx, column=col_idx)
            if cell.coordinate in merged or isinstance(cell, MergedCell):
                continue
            v = cell.value
            if v is None or (isinstance(v, str) and v.startswith("=")):
                continue
            widest = max(widest, _disp_w(v))
        ws.column_dimensions[letter].width = max(min_width, min(max_width, widest + 2))


def finalize_text_rows(ws, text_cols, data_start_row=5, cap=140):
    """Active le retour à la ligne sur les colonnes de texte longues et
    dimensionne la hauteur de chaque ligne de données en conséquence."""
    for row_idx in range(data_start_row, ws.max_row + 1):
        cell0 = ws.cell(row=row_idx, column=2)
        if cell0.coordinate in {c.coordinate for rng in ws.merged_cells.ranges for row in ws[rng.coord] for c in row} and cell0.value is None:
            continue
        max_lines = 1
        touched = False
        for letter in text_cols:
            cell = ws[f"{letter}{row_idx}"]
            if cell.coordinate in {c.coordinate for rng in ws.merged_cells.ranges for row in ws[rng.coord] for c in row} or isinstance(cell, MergedCell):
                continue
            v = cell.value
            if not v or (isinstance(v, str) and v.startswith("=")):
                continue
            touched = True
            col_w = ws.column_dimensions[letter].width or 10
            lines = max(1, math.ceil(_disp_w(v) / max(8.0, col_w - 2)))
            max_lines = max(max_lines, lines)
            cell.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
        if touched:
            ws.row_dimensions[row_idx].height = max(22, min(cap, max_lines * 15 + 7))


def section_row(ws, row, text, last_col):
    """Ligne de section : fond SECONDARY, texte PRIMARY 12 pt (font_subheader)."""
    for c in range(2, last_col + 1):
        cell = ws.cell(row=row, column=c)
        cell.fill = PatternFill("solid", fgColor=SECONDARY)
        cell.font = Font(name=FONT_NAME, size=12, bold=HEADER_BOLD, color=PRIMARY)
    ws.cell(row=row, column=2, value=text)
    ws.merge_cells(start_row=row, start_column=2, end_row=row, end_column=last_col)
    ws.cell(row=row, column=2).alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[row].height = 24


def notes_row(ws, row, text, last_col):
    cell = ws.cell(row=row, column=2, value=text)
    cell.font = font_caption()
    cell.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
    ws.merge_cells(start_row=row, start_column=2, end_row=row, end_column=last_col)


wb = Workbook()

# ================================================================ FEUILLE 1
ws = wb.active
ws.title = "Synthèse des rôles"
HEAD1 = ["Rôle", "Zone", "Qui / mission", "Création du compte", "Connexion",
         "Onglets administration", "Permissions « Oui »", "Permissions « Limité »",
         "Principales restrictions"]
last_col = len(HEAD1) + 1  # B..J
setup_sheet(ws, title="Auto-RH — Synthèse des rôles et des utilisateurs", last_col=last_col)
for i, h in enumerate(HEAD1, start=2):
    ws.cell(row=4, column=i, value=h)
style_header_row(ws, row_num=4, col_start=2, col_end=last_col)

ROWS1 = [
    ["SUPERADMIN", "Administration (port 4000)",
     "Superadministrateur : tous les droits — gestion complète des comptes RH et IT et de tous les paramètres.",
     "Script CREER-SUPERADMIN-WINDOWS.bat uniquement (jamais depuis l'interface, Task 34).",
     "E-mail + mot de passe (politique 15 jours).",
     "6 (tous)",
     None, None,
     "Aucune restriction fonctionnelle ; ne peut pas créer d'autres SUPERADMIN via l'interface (script uniquement) ; le dernier superadmin actif est protégé (suppression / désactivation refusées)."],
    ["RH", "Administration (port 4000)",
     "Ressources humaines : métier de la paie — recherche, consultation, import, accès portail employé, demandes administratives, tampon signature & QR.",
     "Créé par le SUPERADMIN (onglet « Utilisateurs », Task 172).",
     "E-mail + mot de passe (politique 15 jours).",
     "5",
     None, None,
     "Aucune gestion des comptes ; ne configure pas le SMTP (utilise « Send Mail » une fois la configuration posée par IT/SUPERADMIN) ; pas de journal IMAP ; consulte la configuration SMTP sous forme du seul booléen « configurée »."],
    ["IT", "Administration (port 4000)",
     "Informatique : paramètres techniques uniquement — configuration du serveur de messagerie (SMTP / IMAP), routage des demandes administratives (boîtes dédiées par type, v0.2.94) et consultation des comptes.",
     "Créé par le SUPERADMIN (onglet « Utilisateurs », Task 172).",
     "E-mail + mot de passe (politique 15 jours).",
     "2 (Paramètres, Utilisateurs)",
     None, None,
     "Droits limités (Tasks 172/173/176) : ni fiches de paie, ni import, ni accès portail, ni demandes administratives, ni tampon/signature, ni création de comptes — toute tentative API reçoit un 403 dédié (refusIT)."],
    ["EMPLOYÉ", "Portail employé (port 4001)",
     "Consultation de SES fiches de paie et gestion de SES demandes administratives — interface dédiée indépendante de l'administration.",
     "Accès créé par le RH / SUPERADMIN (onglet « Accès portail ») : mot de passe initial à usage unique, communiqué via « Send Mail » (SMTP requis).",
     "CIN + mot de passe, puis QR code (TOTP d'application d'authentification) à CHAQUE connexion.",
     "— (interface dédiée)",
     None, None,
     "Voit UNIQUEMENT ses propres données (CIN de la session) ; aucune fonction d'administration ; verrouillage temporaire après échecs consécutifs ; mot de passe obligatoirement changé à la 1re connexion puis tous les 15 jours."],
]
for i, row in enumerate(ROWS1):
    r = 5 + i
    for j, v in enumerate(row, start=2):
        ws.cell(row=r, column=j, value=v)
    style_data_row(ws, row_num=r, col_start=2, col_end=last_col, row_index=i)
    # Formules vivantes : comptage depuis la feuille Matrice
    ws.cell(row=r, column=8).value = f"=COUNTIF('Matrice des permissions'!$G$5:$G$120,\"Oui\")"
    ws.cell(row=r, column=9).value = f"=COUNTIF('Matrice des permissions'!$G$5:$G$120,\"Limité\")"
    ws.cell(row=r, column=8).alignment = Alignment(horizontal="center", vertical="center")
    ws.cell(row=r, column=9).alignment = Alignment(horizontal="center", vertical="center")

# comptes par rôle (colonnes E=RH, F=IT, G=SUPERADMIN, H=EMPLOYÉ de la matrice)
ws.cell(row=5, column=8).value = "=COUNTIF('Matrice des permissions'!$G$5:$G$120,\"Oui\")"   # SUPERADMIN
ws.cell(row=5, column=9).value = "=COUNTIF('Matrice des permissions'!$G$5:$G$120,\"Limité\")"
ws.cell(row=6, column=8).value = "=COUNTIF('Matrice des permissions'!$E$5:$E$120,\"Oui\")"   # RH
ws.cell(row=6, column=9).value = "=COUNTIF('Matrice des permissions'!$E$5:$E$120,\"Limité\")"
ws.cell(row=7, column=8).value = "=COUNTIF('Matrice des permissions'!$F$5:$F$120,\"Oui\")"   # IT
ws.cell(row=7, column=9).value = "=COUNTIF('Matrice des permissions'!$F$5:$F$120,\"Limité\")"
ws.cell(row=8, column=8).value = "=COUNTIF('Matrice des permissions'!$H$5:$H$120,\"Oui\")"   # EMPLOYÉ
ws.cell(row=8, column=9).value = "=COUNTIF('Matrice des permissions'!$H$5:$H$120,\"Limité\")"

notes_row(ws, 5 + len(ROWS1) + 2,
          "Les compteurs « Permissions » sont des formules vivantes (COUNTIF) calculées depuis la feuille "
          "« Matrice des permissions ». « Limité » = droit partiel (voir le détail dans la matrice). "
          "Audit du code source réel — état v0.2.95 (routage des e-mails des demandes v0.2.94 inclus).", last_col)
auto_fit_safe(ws, min_width=10, max_width=40)
finalize_text_rows(ws, text_cols=("C", "D", "E", "F", "G", "J"))
ws.freeze_panes = "C5"

# ================================================================ FEUILLE 2
ws2 = wb.create_sheet("Matrice des permissions")
HEAD2 = ["Réf", "Fonctionnalité", "Détail / garde serveur", "RH", "IT", "SUPERADMIN", "EMPLOYÉ"]
last2 = len(HEAD2) + 1  # B..H
setup_sheet(ws2, title="Auto-RH — Matrice détaillée des permissions par rôle", last_col=last2)
for i, h in enumerate(HEAD2, start=2):
    ws2.cell(row=4, column=i, value=h)
style_header_row(ws2, row_num=4, col_start=2, col_end=last2)

# (réf, fonctionnalité, détail, RH, IT, SUPERADMIN, EMPLOYÉ)
MATRIX = [
    ("SECTION", "A. Fiches de paie (administration — port 4000)"),
    ("A.1", "Recherche par CIN", "GET /api/payslips — recherche par égalité sur l'index chiffré déterministe.", "Oui", "Non", "Oui", "Non"),
    ("A.2", "Liste « Toutes les fiches »", "GET /api/payslips — pagination serveur (jusqu'à 240 000 fiches).", "Oui", "Non", "Oui", "Non"),
    ("A.3", "Détail d'une fiche", "GET /api/payslips/{id}.", "Oui", "Non", "Oui", "Non"),
    ("A.4", "Affichage du fichier d'une fiche", "GET /api/payslips/{id}/file — tampon appliqué à la volée, original intact.", "Oui", "Non", "Oui", "Non"),
    ("A.5", "Suppression d'une fiche", "DELETE /api/payslips/{id}.", "Oui", "Non", "Oui", "Non"),
    ("A.6", "Suppression multiple", "POST /api/payslips/delete-many.", "Oui", "Non", "Oui", "Non"),
    ("A.7", "Redétection du contenu", "POST /api/payslips/redetect — relit la bonne page des PDF multi-fiches.", "Oui", "Non", "Oui", "Non"),
    ("A.8", "Indexation de la base", "POST /api/payslips/indexation — alimente l'index de recherche chiffré.", "Oui", "Non", "Oui", "Non"),
    ("A.9", "Répertoire des employés", "GET /api/payslips/employes — liste utilisée par l'onglet « Accès portail ».", "Oui", "Non", "Oui", "Non"),
    ("A.10", "Statistiques du tableau de bord", "GET /api/stats — aucune restriction de rôle au-delà de la session valide.", "Oui", "Oui", "Oui", "Non"),
    ("A.11", "QR « Fiche en ligne » — page publique", "Page /verification/fiche/{id} + GET /api/payslips/qr/{id}/file — accès PUBLIC sous jeton HMAC signé par fiche, aucune session (Task 180) ; activation et configuration du mode : RH + SUPERADMIN.", "Oui", "Non", "Oui", "—"),
    ("SECTION", "B. Importation & tampon (administration — port 4000)"),
    ("B.1", "Import de fiches de paie (PDF Sage)", "POST /api/payslips/upload — PDF multi-fiches, extraction, détection d'anomalies de nom.", "Oui", "Non", "Oui", "Non"),
    ("B.2", "Tampon signature & QR — consultation", "GET /api/signature-config (Task 176 : l'IT n'a plus AUCUN accès au tampon).", "Oui", "Non", "Oui", "Non"),
    ("B.3", "Tampon signature & QR — modification", "PUT /api/signature-config — image, texte, position, taille, opacité, décalages, rotation.", "Oui", "Non", "Oui", "Non"),
    ("B.4", "Aperçu du tampon", "POST /api/signature-config — PDF témoin généré avant enregistrement.", "Oui", "Non", "Oui", "Non"),
    ("B.5", "Import du certificat de signature (multi-formats)", "PUT /api/signature-config champ certFichier — .p12/.pfx/.pkcs7/.p7s/.p7m/.xml/.ps7x/.pem/.cer/.crt/.der ; fichier CHIFFRÉ sur disque + métadonnées extraites (Task 181). ⚠ la route dédiée /api/signature-config/certificat est MORTE (colonnes absentes du schéma) : l'import réel passe par PUT.", "Oui", "Non", "Oui", "Non"),
    ("B.6", "Activation + positionnement libre du certificat", "Switch certActif (v0.2.88) ; position, décalages ±1500 pt et taille 50→300 % (v0.2.92) — bloc dessiné dans les 4 moteurs (PDF/image/DOCX/XLSX).", "Oui", "Non", "Oui", "Non"),
    ("B.7", "Aperçu A4 interactif de l'Import", "Composant partagé ApercuPositionnement : clic = positionner, glisser = déplacer INDÉPENDAMMENT signature / QR / certificat ; curseurs synchronisés en temps réel (v0.2.89/0.2.93).", "Oui", "Non", "Oui", "Non"),
    ("SECTION", "C. Accès portail employé (administration — port 4000)"),
    ("C.1", "Liste des accès portail", "GET /api/portal-access — mot de passe jamais renvoyé à l'interface.", "Oui", "Non", "Oui", "Non"),
    ("C.2", "Création d'un accès employé", "action « create » — mot de passe initial affiché UNE seule fois.", "Oui", "Non", "Oui", "Non"),
    ("C.3", "Réinitialisation du mot de passe employé", "action « reset » — remet le changement OBLIGATOIRE à la prochaine connexion.", "Oui", "Non", "Oui", "Non"),
    ("C.4", "Activation / désactivation d'un accès", "action « toggle » — sans suppression.", "Oui", "Non", "Oui", "Non"),
    ("C.5", "Déverrouillage après échecs", "action « unlock » — lève le verrou anti force-brute (lockedUntil).", "Oui", "Non", "Oui", "Non"),
    ("C.6", "Suppression d'un accès", "action « delete ».", "Oui", "Non", "Oui", "Non"),
    ("C.7", "Affichage du QR d'inscription", "action « qr » — page « uniquement le QR », affichée une seule fois.", "Oui", "Non", "Oui", "Non"),
    ("C.8", "Réinitialisation du QR d'inscription", "action « reset-qr » — nouveau secret, QR redevenant affichable.", "Oui", "Non", "Oui", "Non"),
    ("C.9", "Envoi des identifiants par e-mail", "action « send-mail » — CIN + mot de passe initial + URL du portail (nécessite le SMTP configuré par IT/SUPERADMIN).", "Oui", "Non", "Oui", "Non"),
    ("C.10", "Modification du nom et prénom", "action « modifier-nom » — répercutée automatiquement sur toutes les fiches de paie du même CIN (Task 173).", "Oui", "Non", "Oui", "Non"),
    ("C.11", "Modification de l'e-mail de l'employé", "action « modifier-email » (v0.2.91) — champ PortalAccess.email CHIFFRÉ ; répercuté sur les notifications de suivi des demandes et le destinataire proposé de « Envoyer l'e-mail » (repli mailEnvoyeA conservé). Ne touche PAS aux fiches de paie.", "Oui", "Non", "Oui", "Non"),
    ("SECTION", "D. Demandes administratives (administration — port 4000)"),
    ("D.1", "Liste des demandes", "GET /api/demandes — filtres type/statut, recherche, compteurs.", "Oui", "Non", "Oui", "Non"),
    ("D.2", "Détail d'une demande", "GET /api/demandes/{id}.", "Oui", "Non", "Oui", "Non"),
    ("D.3", "Traitement (statut + commentaire)", "POST /api/demandes/{id} — Acceptée / Refusée / Information requise + notification e-mail à l'employé.", "Oui", "Non", "Oui", "Non"),
    ("D.4", "Réponse avec document (import direct)", "POST /api/demandes/{id}/repondre — modes aucun/auto/manuel ; le tampon automatique lit la config DÉDIÉE des réponses (v0.2.93) ; stockage chiffré + notification ; l'API admet RH, IT et SUPERADMIN mais AUCUNE interface n'est exposée à l'IT (onglet masqué).", "Oui", "Limité", "Oui", "Non"),
    ("D.5", "Téléchargement d'un document de réponse", "GET /api/demandes/{id}/documents/{docId} — session d'administration requise, sans contrôle de rôle au-delà.", "Oui", "Limité", "Oui", "Non"),
    ("D.6", "Journal IMAP des demandes", "GET /api/demandes/journal — diagnostic de la réception automatique des réponses (300 derniers envois).", "Non", "Oui", "Oui", "Non"),
    ("D.7", "QR « Réponse en ligne » — page publique", "Page /verification/reponse/{reference} + GET /api/demandes/qr/{reference}/file — accès PUBLIC sous jeton HMAC signé par référence (v0.2.88) ; activation/config : RH + SUPERADMIN.", "Oui", "Non", "Oui", "—"),
    ("D.8", "Configuration DÉDIÉE du tampon des réponses", "GET/PUT/POST /api/signature-config?scope=reponse (v0.2.93) — interrupteurs, textes, positions, décalages, rotations, case à cocher certificat et positionnement PROPRES (panneau « Configuration des réponses » de l'onglet Demandes) ; actifs importés (images, fichier certificat) PARTAGÉS en lecture seule depuis l'Import ; mode FICHE exclu.", "Oui", "Non", "Oui", "Non"),
    ("SECTION", "E. Paramètres techniques — messagerie (port 4000)"),
    ("E.1", "Consultation de la configuration SMTP", "GET /api/mail-config — le RH ne reçoit que le booléen « configurée » ; IT/SUPERADMIN reçoivent la configuration complète.", "Limité", "Oui", "Oui", "Non"),
    ("E.2", "Modification de la configuration SMTP", "PUT /api/mail-config — hôte, port, compte chiffré, IMAP et routage des demandes (8 champs : rhEmail, itEmail, responsablesMap, parrainageEmail + 4 boîtes dédiées par type, v0.2.94).", "Non", "Oui", "Oui", "Non"),
    ("E.3", "Test SMTP (e-mail de test)", "POST /api/mail-config.", "Non", "Oui", "Oui", "Non"),
    ("E.4", "Test de la réception IMAP", "POST /api/mail-config — action « test-imap ».", "Non", "Oui", "Oui", "Non"),
    ("E.5", "Routage des demandes administratives — boîtes dédiées par type", "v0.2.94 : attestationTravailEmail / attestationSalaireEmail = destinataire PRINCIPAL des attestations (repli boîte RH) ; congeEmail / autorisationEmail = COPIE systématique des congés / autorisations (le N+1 saisi reste principal, repli RH) ; confirmation automatique au demandeur pour les 5 types ; panneau SMTP → « Routage des demandes administratives ».", "Non", "Oui", "Oui", "Non"),
    ("SECTION", "F. Comptes utilisateurs (administration — port 4000)"),
    ("F.1", "Liste des comptes", "GET /api/users — l'IT consulte SANS aucun bouton d'action (consultation seule, Task 173).", "Non", "Oui", "Oui", "Non"),
    ("F.2", "Création d'un compte RH ou IT", "POST /api/users — SUPERADMIN uniquement (Task 172).", "Non", "Non", "Oui", "Non"),
    ("F.3", "Activation / désactivation d'un compte", "PATCH /api/users/{id} — désactivation sans suppression.", "Non", "Non", "Oui", "Non"),
    ("F.4", "Suppression d'un compte", "DELETE /api/users/{id} — le DERNIER superadmin actif est protégé.", "Non", "Non", "Oui", "Non"),
    ("F.5", "Réinitialisation du mot de passe d'un compte", "POST /api/users/{id}/password — révoque immédiatement toutes les sessions antérieures.", "Non", "Non", "Oui", "Non"),
    ("F.6", "Changement de rôle RH ↔ IT", "POST /api/users/{id}/role — les comptes SUPERADMIN ne sont pas modifiables ici.", "Non", "Non", "Oui", "Non"),
    ("SECTION", "G. Compte personnel (tous les comptes de l'administration)"),
    ("G.1", "Connexion à l'administration", "POST /api/auth/login — e-mail + mot de passe, limitation des tentatives (anti force-brute).", "Oui", "Oui", "Oui", "Non"),
    ("G.2", "Profil de session", "GET /api/auth/me.", "Oui", "Oui", "Oui", "Non"),
    ("G.3", "Changement de mot de passe", "POST /api/auth/change-password — OBLIGATOIRE tous les 15 jours (tous les rôles).", "Oui", "Oui", "Oui", "Non"),
    ("G.4", "Session « Se souvenir de moi »", "30 jours — révoquée immédiatement par tout changement / réinitialisation de mot de passe.", "Oui", "Oui", "Oui", "Non"),
    ("G.5", "Déconnexion", "POST /api/auth/logout.", "Oui", "Oui", "Oui", "Non"),
    ("SECTION", "H. Portail employé (port 4001 — serveur dédié scripts/portail-server.js)"),
    ("H.1", "Connexion CIN + mot de passe + OTP", "POST /api/verify puis POST /api/otp/verify — 2FA TOTP à CHAQUE connexion, QR standard otpauth, tolérance ±1 fenêtre, anti-rejeu.", "Non", "Non", "Non", "Oui"),
    ("H.2", "Première connexion : choix du mot de passe", "POST /api/premiere — mot de passe initial à usage unique ; inscription QR affichée une seule fois, fenêtre de 10 minutes.", "Non", "Non", "Non", "Oui"),
    ("H.3", "Changement de mot de passe (15 jours)", "POST /api/change-password — expiration automatique et changement OBLIGATOIRE.", "Non", "Non", "Non", "Oui"),
    ("H.4", "Consultation de SES fiches de paie", "GET /api/my-fiches — filtrées par le CIN de la session (aucun autre employé visible).", "Non", "Non", "Non", "Oui"),
    ("H.5", "Recherche parmi SES fiches", "GET /api/search — REFUSÉE si le CIN demandé diffère du CIN de la session ; limitation de débit.", "Non", "Non", "Non", "Oui"),
    ("H.6", "Visualisation / téléchargement", "PDF, image (PNG/JPG), DOCX, XLSX/XLSM — tampon signature/QR/mention appliqué à la volée, original intact ; .xls servi tel quel.", "Non", "Non", "Non", "Oui"),
    ("H.7", "Renseigner son e-mail de notification", "GET/POST /api/mon-email — stocké chiffré ; sert aux notifications de suivi de SES demandes.", "Non", "Non", "Non", "Oui"),
    ("H.8", "Création d'une demande administrative", "POST /api/demandes — 5 types : attestation de travail, attestation de salaire, congé, autorisation de sortie, parrainage.", "Non", "Non", "Non", "Oui"),
    ("H.9", "Suivi de SES demandes", "GET /api/mes-demandes — statut, commentaires, documents reçus.", "Non", "Non", "Non", "Oui"),
    ("H.10", "Documents de réponse — visualiser / télécharger", "GET /api/mes-demandes/documents/{id} — documents envoyés par le service RH (réponse e-mail ou import direct).", "Non", "Non", "Non", "Oui"),
    ("H.11", "Notifications e-mail automatiques", "À la création, aux changements de statut (acceptée / refusée / information requise) et quand un document est disponible.", "Non", "Non", "Non", "Oui"),
    ("H.12", "Parrainage simplifié (v0.2.92)", "Champ « N+1 / responsable hiérarchique » SUPPRIMÉ du formulaire (résiduel IGNORÉ côté serveur) ; routage automatique vers l'adresse DÉDIÉE parrainageEmail (config IT/SUPERADMIN, repli rhEmail) + confirmation e-mail AUTOMATIQUE au demandeur ; identité du parrain résolue côté serveur (nomPrenom RH / fiches).", "Non", "Non", "Non", "Oui"),
    ("H.13", "Accusé de réception automatique de SES demandes (v0.2.94)", "À la création de l'une de SES demandes (5 types), l'employé reçoit un e-mail de confirmation (récapitulatif + référence) à son adresse de notification (PortalAccess.email chiffré, repli mailEnvoyeA).", "Non", "Non", "Non", "Oui"),
]
r = 5
data_idx = 0
for entry in MATRIX:
    if entry[0] == "SECTION":
        section_row(ws2, r, entry[1], last2)
    else:
        for j, v in enumerate(entry, start=2):
            ws2.cell(row=r, column=j, value=v)
        style_data_row(ws2, row_num=r, col_start=2, col_end=last2, row_index=data_idx)
        for c in range(5, 9):  # colonnes E..H = statuts
            status_cell(ws2.cell(row=r, column=c), ws2.cell(row=r, column=c).value)
        data_idx += 1
    r += 1
last_data_row2 = r - 1
notes_row(ws2, r + 2,
          "« Oui » = accès complet ; « Limité » = accès partiel (voir colonne Détail) ; « Non » = refusé "
          "(403 côté serveur et/ou interface masquée) ; « — » = non applicable. Toute restriction est appliquée "
          "CÔTÉ SERVEUR (403) et doublée côté interface (Task 172 : « restriction double »).", last2)
auto_fit_safe(ws2, min_width=9, max_width=58)
finalize_text_rows(ws2, text_cols=("C", "D"))
ws2.freeze_panes = "D5"

print("Feuilles 1-2 construites :", ws.title, "/", ws2.title, "— lignes données :", data_idx)

# ================================================================ FEUILLE 3
ws3 = wb.create_sheet("Onglets de l'interface")
HEAD3 = ["Onglet", "RH", "IT", "SUPERADMIN", "Contenu"]
last3 = len(HEAD3) + 1  # B..F
setup_sheet(ws3, title="Auto-RH — Onglets de l'interface d'administration par rôle (port 4000)", last_col=last3)
for i, h in enumerate(HEAD3, start=2):
    ws3.cell(row=4, column=i, value=h)
style_header_row(ws3, row_num=4, col_start=2, col_end=last3)

ROWS3 = [
    ["Recherche CIN", "Oui", "—", "Oui", "Recherche par CIN avec pagination serveur et aperçu du PDF de la fiche."],
    ["Toutes les fiches", "Oui", "—", "Oui", "Liste paginée de toutes les fiches, consultation et suppression."],
    ["Importer", "Oui", "—", "Oui", "Import des PDF Sage + rubrique « Signature électronique & QR code » (tampon)."],
    ["Accès portail", "Oui", "—", "Oui", "Accès portail par mot de passe : création, Send Mail, nom et prénom (tableau + mobile)."],
    ["Demandes", "Oui", "—", "Oui", "Demandes administratives ; journal IMAP réservé IT/SUPERADMIN (en pratique SUPERADMIN seul) ; panneau « Configuration des réponses » du tampon avec aperçu A4 interactif (v0.2.93)."],
    ["Paramètres", "—", "Oui", "—", "Configuration du serveur de messagerie (SMTP / IMAP) et routage des demandes administratives (boîtes dédiées par type, v0.2.94) — fonctionnalité technique du rôle IT."],
    ["Utilisateurs", "—", "Limité", "Oui", "Gestion complète des comptes RH/IT par le SUPERADMIN ; l'IT consulte la liste en CONSULTATION SEULE (aucun bouton d'action)."],
]
for i, row in enumerate(ROWS3):
    r = 5 + i
    for j, v in enumerate(row, start=2):
        ws3.cell(row=r, column=j, value=v)
    style_data_row(ws3, row_num=r, col_start=2, col_end=last3, row_index=i)
    for c in range(3, 6):
        status_cell(ws3.cell(row=r, column=c), ws3.cell(row=r, column=c).value)
notes_row(ws3, 5 + len(ROWS3) + 2,
          "L'employé (portail 4001) n'a AUCUN onglet d'administration : son interface dédiée indépendante propose "
          "la consultation de ses fiches et la section « Demandes administratives ». Répartition Task 172/173/176 : "
          "SUPERADMIN 6 onglets, RH 5 onglets, IT 2 onglets.", last3)
auto_fit_safe(ws3, min_width=10, max_width=52)
finalize_text_rows(ws3, text_cols=("B", "F"))
ws3.freeze_panes = "C5"

# ================================================================ FEUILLE 4
ws4 = wb.create_sheet("Sécurité transverse")
HEAD4 = ["Règle", "Concerne", "Détail / implémentation"]
last4 = len(HEAD4) + 1  # B..E
setup_sheet(ws4, title="Auto-RH — Règles de sécurité transverses (tous les rôles)", last_col=last4)
for i, h in enumerate(HEAD4, start=2):
    ws4.cell(row=4, column=i, value=h)
style_header_row(ws4, row_num=4, col_start=2, col_end=last4)

ROWS4 = [
    ["Middleware de session", "Toutes les pages et API d'administration",
     "Aucune page ni API sans cookie de session (redirection vers /login ou 401 JSON). Exceptions publiques (v0.2.94) : /login, /api/auth/*, téléchargement du README, des scripts, de la matrice des rôles et de la map de routage des e-mails, pages de vérification QR (verification, api/payslips/qr, api/demandes/qr — sous jeton HMAC), favicon/logo."],
    ["Revalidation complète par appel", "Toutes les API",
     "getSessionUser() revérifie à CHAQUE requête : signature du jeton, expiration, existence du compte ET activation en base (un compte désactivé est déconnecté immédiatement)."],
    ["Révocation immédiate des sessions", "Comptes RH / IT / SUPERADMIN",
     "Chaque jeton porte la version de session (pwv = horodatage du dernier changement de mot de passe) : tout changement ou réinitialisation invalide TOUTES les sessions antérieures, y compris « Se souvenir de moi »."],
    ["Expiration des mots de passe — 15 jours", "TOUS les comptes (RH, IT, SUPERADMIN, employé)",
     "Changement OBLIGATOIRE à la prochaine connexion ; en attendant, les API de données répondent 403 MOT_DE_PASSE_EXPIRE ; session de changement limitée à 15 minutes."],
    ["Hachage scrypt", "TOUS les comptes",
     "Aucun mot de passe en clair : format « scrypt:salt:hash », comparaison à temps constant."],
    ["Chiffrement AES-256-GCM en base", "Données sensibles",
     "CIN, noms, e-mails, contenus des fiches, mots de passe initiaux, secrets TOTP chiffrés (IV aléatoire ; mode déterministe pour les colonnes de recherche, indexées)."],
    ["Cookie de session signé HMAC-SHA256", "Administration + portail",
     "httpOnly, durée 1 jour (30 jours « Se souvenir de moi ») ; sans AUTH_SECRET un secret aléatoire est généré : aucun cookie ne peut être forgé."],
    ["Anti force-brute — administration", "Comptes RH / IT / SUPERADMIN",
     "Limitation des tentatives de connexion par poste (réponse 429 « Trop de tentatives »)."],
    ["Anti force-brute — portail", "Accès employé",
     "Compteur d'échecs consécutifs + verrouillage temporaire (lockedUntil) ; le déverrouillage est une action RH/SUPERADMIN (« unlock »)."],
    ["2FA TOTP du portail", "Employé",
     "QR code standard otpauth:// à CHAQUE connexion (Google/Microsoft Authenticator…) ; aucun code affiché en clair ; QR d'inscription affiché UNE seule fois, fenêtre de 10 minutes, anti-rejeu (fenêtre TOTP consommée)."],
    ["Restriction double 403 + interface", "Toutes les API restreintes",
     "Toute restriction est appliquée CÔTÉ SERVEUR (403 dédié : refusIT, forbidden, forbiddenSuperadmin) et doublée côté interface (onglets masqués, boutons absents) — principe Task 172."],
    ["Inscription publique supprimée", "Système",
     "Plus aucun auto-enregistrement (Task 173) : comptes RH/IT créés par le SUPERADMIN uniquement ; comptes SUPERADMIN créés par script (CREER-SUPERADMIN-WINDOWS.bat) uniquement."],
    ["Protection du dernier superadmin", "SUPERADMIN",
     "Suppression / désactivation du DERNIER compte superadmin actif refusée (message explicite : créer ou activer d'abord un autre superadmin)."],
    ["Portails séparés", "Système",
     "Administration port 4000 (login obligatoire) et portail employé port 4001 (serveur Node dédié) : le portail lit la même base chiffrée mais n'expose AUCUNE fonction d'administration."],
    ["Servage tamponné à la volée", "RH, SUPERADMIN, employé",
     "L'original stocké reste INTACT : signature électronique, QR code et mention légale sont apposés au moment du servage (consultation/téléchargement, administration ET portail) — la configuration peut changer sans toucher aux fichiers."],
    ["Traçabilité", "Système",
     "Journal des imports (ImportLog), journal IMAP des demandes (IT/SUPERADMIN), traçabilité des e-mails d'identifiants (mailEnvoyeA / mailEnvoyeLe), copies de contrôle des tampons importés (storage/tampons)."],
    ["QR publics sous jeton HMAC", "Pages /verification/*",
     "Les pages publiques « Fiche en ligne » et « Réponse en ligne » et leurs fichiers sont servis sous JETON HMAC-SHA256 signé par fiche/référence (comparaison à temps constant) : aucune session, aucun parcours possible entre fiches — seule la fiche/réponse désignée est accessible."],
    ["Certificat chiffré sur disque", "Tampon certificat (RH/SUPERADMIN)",
     "Le fichier du certificat importé (.p12/.pfx/.pem/…) est conservé CHIFFRÉ AES-256-GCM (storage/tampons/certificat-…) ; seules les MÉTADONNÉES publiques (titulaire, émetteur, série, validité, empreinte SHA-256) sont en base ; le bloc n'est dessiné que si le switch certActif est ON."],
    ["E-mails en arrière-plan", "Portail — création de demandes",
     "Les notifications de création (destinataire du traitement + confirmation au DEMANDEUR pour les 5 types, v0.2.94) sont envoyées en arrière-plan, JAMAIS bloquantes, journalisées (demande-creation, -copie-rh, -copie-dediee, -confirmation-demandeur) ; copie systématique aux boîtes dédiées congé / autorisation (repli RH) ; l'e-mail du demandeur = PortalAccess.email (sinon repli mailEnvoyeA)."],
]
for i, row in enumerate(ROWS4):
    r = 5 + i
    for j, v in enumerate(row, start=2):
        ws4.cell(row=r, column=j, value=v)
    style_data_row(ws4, row_num=r, col_start=2, col_end=last4, row_index=i)
notes_row(ws4, 5 + len(ROWS4) + 2,
          "Politique de mots de passe : complexité vérifiée à la création, au changement et à la réinitialisation "
          "(src/lib/password-policy.ts) — identique pour les trois rôles d'administration et pour l'employé.", last4)
auto_fit_safe(ws4, min_width=12, max_width=60)
finalize_text_rows(ws4, text_cols=("B", "C", "D"))
ws4.freeze_panes = "C5"

# ================================================================ FEUILLE 5
ws5 = wb.create_sheet("Référence API")
HEAD5 = ["Méthode", "Endpoint", "Fonctionnalité", "Rôles admis", "Garde serveur"]
last5 = len(HEAD5) + 1  # B..F
setup_sheet(ws5, title="Auto-RH — Référence des API et gardes de rôles", last_col=last5)
for i, h in enumerate(HEAD5, start=2):
    ws5.cell(row=4, column=i, value=h)
style_header_row(ws5, row_num=4, col_start=2, col_end=last5)

ADMIN = "RH, SUPERADMIN"
IT_SUP = "IT, SUPERADMIN"
TOUT = "RH, IT, SUPERADMIN (toute session valide)"
ROWS5 = [
    ["GET", "/api/payslips", "Recherche par CIN + liste paginée", ADMIN, "403 refusIT si IT"],
    ["POST", "/api/payslips/upload", "Import de fiches (PDF multi-fiches)", ADMIN, "403 refusIT si IT"],
    ["GET", "/api/payslips/{id}", "Détail d'une fiche", ADMIN, "403 refusIT si IT"],
    ["DELETE", "/api/payslips/{id}", "Suppression d'une fiche", ADMIN, "403 refusIT si IT"],
    ["POST", "/api/payslips/delete-many", "Suppression multiple", ADMIN, "403 refusIT si IT"],
    ["GET", "/api/payslips/{id}/file", "Fichier d'une fiche (tamponné)", ADMIN, "403 refusIT si IT"],
    ["GET", "/api/payslips/employes", "Répertoire des employés", ADMIN, "403 refusIT si IT"],
    ["POST", "/api/payslips/redetect", "Redétection du contenu", ADMIN, "403 refusIT si IT"],
    ["POST", "/api/payslips/indexation", "Indexation de la base", ADMIN, "403 refusIT si IT"],
    ["GET", "/api/stats", "Statistiques du tableau de bord", TOUT, "Session requise (aucun contrôle de rôle)"],
    ["GET", "/api/signature-config", "Tampon — consultation", ADMIN, "403 refusIT + 403 générique (Task 176)"],
    ["PUT", "/api/signature-config", "Tampon — modification", ADMIN, "403 refusIT + 403 générique (Task 176)"],
    ["POST", "/api/signature-config", "Tampon — aperçu PDF témoin", ADMIN, "403 refusIT + 403 générique (Task 176)"],
    ["GET", "/api/signature-config?scope=reponse", "Tampon réponses — consultation (config dédiée + actifs partagés)", ADMIN, "403 refusIT + 403 générique (v0.2.93)"],
    ["PUT", "/api/signature-config?scope=reponse", "Tampon réponses — enregistrement (actifs importés IGNORÉS : propriété de l'Import)", ADMIN, "403 refusIT + 403 générique (v0.2.93)"],
    ["POST", "/api/signature-config?scope=reponse", "Tampon réponses — aperçu PDF synthétique « RÉPONSE À UNE DEMANDE »", ADMIN, "403 refusIT + 403 générique (v0.2.93)"],
    ["POST/DELETE", "/api/signature-config/certificat", "Import/retrait du certificat (Task 181) — ⚠ ROUTE MORTE : écrit des colonnes absentes du schéma ; l'import réel passe par PUT /api/signature-config champ certFichier", ADMIN, "Garde calquée (403 refusIT) — à purger ou réaligner"],
    ["GET", "/api/payslips/qr/{id}/file", "Fichier de la fiche pour le QR « Fiche en ligne »", "Public (jeton HMAC par fiche)", "jetonFicheValide, comparaison à temps constant (Task 180)"],
    ["GET", "/api/demandes/qr/{reference}/file", "Fichier de la réponse pour le QR « Réponse en ligne »", "Public (jeton HMAC par référence)", "jetonReponseValide, comparaison à temps constant (v0.2.88)"],
    ["GET", "/api/portal-access", "Accès portail — liste", ADMIN, "403 refusIT si IT"],
    ["POST", "/api/portal-access", "Accès portail — 10 actions (create, reset, toggle, unlock, delete, qr, reset-qr, send-mail, modifier-nom, modifier-email)", ADMIN, "403 refusIT si IT"],
    ["GET", "/api/demandes", "Demandes — liste + compteurs", ADMIN, "403 refusIT si IT"],
    ["GET", "/api/demandes/{id}", "Demandes — détail", ADMIN, "403 refusIT si IT"],
    ["POST", "/api/demandes/{id}", "Demandes — traitement (statut + commentaire)", ADMIN, "403 refusIT si IT"],
    ["POST", "/api/demandes/{id}/repondre", "Réponse avec document (modes aucun/auto/manuel ; tampon auto sur la config DÉDIÉE des réponses, v0.2.93)", TOUT, "403 si autre rôle (IT admis côté API, aucune interface exposée)"],
    ["GET", "/api/demandes/{id}/documents/{docId}", "Téléchargement d'un document de réponse", TOUT, "Session requise (aucun contrôle de rôle)"],
    ["GET", "/api/demandes/journal", "Journal IMAP des demandes", IT_SUP, "403 forbidden sinon"],
    ["GET", "/api/mail-config", "SMTP — consultation", IT_SUP, "RH : seul le booléen « configurée » est renvoyé"],
    ["PUT", "/api/mail-config", "SMTP — enregistrement (dont routage des demandes : 8 champs, 4 boîtes dédiées v0.2.94)", IT_SUP, "403 sinon"],
    ["POST", "/api/mail-config", "Test SMTP + test IMAP", IT_SUP, "403 sinon"],
    ["GET", "/api/users", "Utilisateurs — liste", IT_SUP, "403 forbidden sinon"],
    ["POST", "/api/users", "Utilisateurs — création de compte RH/IT", "SUPERADMIN", "403 forbiddenSuperadmin"],
    ["PATCH", "/api/users/{id}", "Activation / désactivation", "SUPERADMIN", "403 forbiddenSuperadmin"],
    ["DELETE", "/api/users/{id}", "Suppression de compte", "SUPERADMIN", "403 (protection du dernier superadmin actif)"],
    ["POST", "/api/users/{id}/password", "Réinitialisation du mot de passe", "SUPERADMIN", "403 forbiddenSuperadmin"],
    ["POST", "/api/users/{id}/role", "Changement de rôle RH ↔ IT", "SUPERADMIN", "403 forbiddenSuperadmin"],
    ["POST", "/api/auth/login", "Connexion administration", "Public", "Anti force-brute (429)"],
    ["GET", "/api/auth/me", "Profil de session", TOUT, "Session requise"],
    ["POST", "/api/auth/change-password", "Changement de mot de passe", TOUT, "Session requise"],
    ["POST", "/api/auth/logout", "Déconnexion", TOUT, "Session requise"],
    ["GET", "/api/download-readme · /api/download-scripts · /api/download-matrice · /api/download-routage", "Téléchargements publics (README PDF, archive scripts, matrice des rôles, map de routage des e-mails v0.2.94)", "Public", "Hors middleware (exclusions explicites)"],
    ["SECTION", "Portail employé (port 4001 — scripts/portail-server.js)"],
    ["POST", "/api/verify", "Connexion CIN + mot de passe", "Employé (accès actif)", "scrypt + verrouillage après échecs"],
    ["POST", "/api/premiere", "Première connexion — choix du mot de passe", "Employé (mot de passe initial)", "À usage unique"],
    ["POST", "/api/otp/verify", "Confirmation 2FA (TOTP)", "Employé (session OTP)", "Tolérance ±1 fenêtre, anti-rejeu"],
    ["POST", "/api/change-password", "Changement de mot de passe (15 jours)", "Employé connecté", "Politique 15 jours"],
    ["GET", "/api/my-fiches", "Mes fiches de paie", "Employé connecté", "Filtrées par le CIN de la session"],
    ["GET", "/api/search", "Recherche de SA fiche", "Employé connecté", "CIN demandé = CIN session + limitation de débit"],
    ["GET/POST", "/api/mon-email", "E-mail de notification de l'employé", "Employé connecté", "Stocké chiffré"],
    ["POST", "/api/demandes", "Créer une demande (5 types) — routage v0.2.94 : attestations → boîte dédiée (repli RH), congé / autorisation → N+1 principal + copie boîte dédiée (repli RH), parrainage → boîte dédiée ; confirmation AUTOMATIQUE au demandeur pour les 5 types", "Employé connecté", "CIN de session + plafond 30 demandes en attente (429)"],
    ["GET", "/api/mes-demandes", "Suivi de mes demandes", "Employé connecté", "CIN de session"],
    ["GET", "/api/mes-demandes/documents/{id}", "Document de réponse — visualiser / télécharger", "Employé connecté", "Document lié à SES demandes"],
    ["POST", "/api/logout", "Déconnexion portail", "Employé connecté", "—"],
]
r = 5
for i, row in enumerate(ROWS5):
    if row[0] == "SECTION":
        section_row(ws5, r, row[1], last5)
        r += 1
        continue
    for j, v in enumerate(row, start=2):
        ws5.cell(row=r, column=j, value=v)
    style_data_row(ws5, row_num=r, col_start=2, col_end=last5, row_index=i)
    r += 1
notes_row(ws5, r + 2,
          "Toutes les API d'administration sont derrière le middleware (401 sans cookie) puis revalident la session "
          "et l'expiration du mot de passe (403 MOT_DE_PASSE_EXPIRE) via getSessionUser(). Le portail employé tourne "
          "sur un serveur Node séparé (port 4001) avec ses propres sessions.", last5)
auto_fit_safe(ws5, min_width=9, max_width=52)
finalize_text_rows(ws5, text_cols=("C", "D", "E", "F"))
ws5.freeze_panes = "C5"

# ================================================================ FEUILLE 6
ws6 = wb.create_sheet("Sources")
HEAD6 = ["Source auditée", "Ce qu'elle démontre"]
last6 = len(HEAD6) + 1  # B..C
setup_sheet(ws6, title="Auto-RH — Sources de l'audit (code réel)", last_col=last6)
for i, h in enumerate(HEAD6, start=2):
    ws6.cell(row=4, column=i, value=h)
style_header_row(ws6, row_num=4, col_start=2, col_end=last6)

ROWS6 = [
    ["prisma/schema.prisma", "Modèles User (role « RH » | « IT » | « SUPERADMIN »), PortalAccess (compte employé), MailConfig, SignatureConfig, DemandeAdministrative."],
    ["src/lib/auth.ts", "Sessions signées, rôles, estSuperadmin, refusIT, matrice des rôles commentée (Task 172), révocation pwv."],
    ["src/lib/password-policy.ts", "Politique d'expiration des mots de passe (15 jours, tous les comptes)."],
    ["src/middleware.ts", "Protection des pages/API et exceptions publiques (login, auth, téléchargements)."],
    ["src/app/api/**/route.ts (32 routes livrées)", "Gardes de rôles audités un par un (401 / 403 refusIT / forbidden / forbiddenSuperadmin) — y compris routes QR publiques (jeton HMAC), scope=reponse (v0.2.93) et téléchargement public de la map de routage (v0.2.94)."],
    ["src/app/page.tsx", "Onglets visibles par rôle : SUPERADMIN 6, RH 5, IT 2 (Task 172/173/176)."],
    ["src/components/payslip/users-tab.tsx", "Gestion des comptes : SUPERADMIN complet, IT consultation seule."],
    ["src/components/payslip/demandes-tab.tsx", "Traitement des demandes, journal IMAP réservé au SUPERADMIN."],
    ["src/components/payslip/portal-access-tab.tsx", "Tableau « Accès portail par mot de passe » et ses 10 actions — colonne « E-mail d'accès » modifiable par RH/SUPERADMIN (v0.2.91)."],
    ["src/lib/signature-reponse.ts + src/lib/stamp.ts", "Config DÉDIÉE des réponses (continuité historique avant la 1re sauvegarde) et moteur de tampon (2022 lignes) : certificat dessiné dans les 4 formats, aperçu réponse."],
    ["src/components/payslip/signature-panel-reponses.tsx + apercu-positionnement.tsx", "Panneau « Configuration des réponses » (onglet Demandes) et aperçu A4 interactif partagé (clic/glisser indépendant des 3 éléments, curseurs synchronisés)."],
    ["scripts/test_v088…v094 + test_task180/181", "Preuves E2E : QR fiche/réponse en ligne, certificat multi-formats, positionnement libre, modifier-email (IT→403), parrainage sans N+1, séparation des configs Import vs Demandes/Réponses, routage des e-mails par type (24/24)."],
    ["scripts/test_v094_routage_emails.js + scripts/map_routage_emails.py", "Preuve E2E du routage des e-mails (destinataires prouvés par SMTP puits — capture RCPT TO) et générateur de la map Excel servie par /api/download-routage."],
    ["scripts/portail-server.js", "Portail employé (4001) : tous les endpoints, 2FA, filtrage par CIN de session, tampon à la volée."],
    ["scripts/creer-superadmin.js + CREER-SUPERADMIN-WINDOWS.bat", "Seule voie de création d'un compte SUPERADMIN."],
    ["scripts/maj_readme_matrice_droits.py", "Annexe A du README PDF (Task 177) — matrice SuperAdmin/RH/IT antérieure."],
    ["worklog.md", "Historique : Task 172 (droits limités IT), 173 (permissions IT/RH), 176 (retrait tampon à l'IT), 177 (matrice README), 192 (modifier-email), séparation des configs (v0.2.93), 197 (routage e-mails par type), 198 (présente matrice)."],
]
for i, row in enumerate(ROWS6):
    r = 5 + i
    for j, v in enumerate(row, start=2):
        ws6.cell(row=r, column=j, value=v)
    style_data_row(ws6, row_num=r, col_start=2, col_end=last6, row_index=i)
notes_row(ws6, 5 + len(ROWS6) + 2,
          "Audit du code source réel refait le 27/09/2026 à la demande de l'utilisateur — état v0.2.95 : audit initial réalisé "
          "sur l'archive v0.2.93 (Task 194/196), mis à jour avec la v0.2.94 (routage des e-mails : MailConfig + 4 champs dédiés, "
          "confirmation au demandeur pour les 5 types, action journal « demande-creation-copie-dediee », route publique "
          "/api/download-routage). La matrice reflète le COMPORTEMENT DU CODE, y compris les nuances API/interface (cas « Limité »). "
          "Bilan v0.2.82→v0.2.94 : AUCUN changement de garde de rôle ; les nouveautés (modifier-email, certificat, positionnement "
          "libre, séparation des configs, parrainage, routage des demandes) héritent des gardes existantes RH + SUPERADMIN ou "
          "IT + SUPERADMIN, avec 2 routes publiques QR sous jeton HMAC et 4 téléchargements publics sans session.", last6)
auto_fit_safe(ws6, min_width=14, max_width=72)
finalize_text_rows(ws6, text_cols=("B", "C"))

# largeurs manuelles des colonnes de formules (feuille 1)
ws.column_dimensions["H"].width = 13
ws.column_dimensions["I"].width = 14

# ================================================================ SAVE
wb.properties.creator = "AutoRH"
os.makedirs(os.path.dirname(OUT), exist_ok=True)
wb.save(OUT)
print("Classeur écrit :", OUT)
print("Feuilles :", wb.sheetnames)
