#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 197 (v0.2.94) — Map de configuration des e-mails des demandes du
portail employé (congé, autorisation de sortie, attestation de travail,
attestation de salaire, parrainage).

Audit du code réel v0.2.94 : prisma/schema.prisma (model MailConfig),
src/app/api/mail-config/route.ts (GET/PUT + validation), src/lib/mailer.ts,
src/components/payslip/mail-panel.tsx (section « Routage »),
scripts/portail-server.js (destinatairePourDemande, envois arrière-plan,
confirmations), preuves E2E scripts/test_v094_routage_emails.js (24/24 OK).

Génère : download/AutoRH-Map-routage-emails-demandes-v0.2.112.xlsx
(v0.2.112 : « Accès portail » — en-tête « Matricule » rétabli (plus de confusion avec l'e-mail d'accès) et colonnes « Nom » / « Prénom » remplies automatiquement depuis les fiches, composés « Ben »/« Bel »/« Bou » ensemble ;
v0.2.108 : décision par réponse e-mail pour TOUS les types — « Acceptée » / « Refusée » au féminin —, copie RH réservée aux décisions du N+1 ;
v0.2.107 : le matricule de l'employé figure dans les e-mails de demandes ;
v0.2.106 : la notification employé JOINT le document de réponse — tous types ;
marquage AutoRH — l'application couvre fiches de paie ET demandes administratives).
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

OUT = "/home/z/my-project/download/AutoRH-Map-routage-emails-demandes-v0.2.112.xlsx"

# ---------------------------------------------------------------- helpers
OUI_F = lambda: Font(name=FONT_NAME, size=11, color=ACCENT_POSITIVE)
NON_F = lambda: Font(name=FONT_NAME, size=11, color=ACCENT_NEGATIVE)
NEW_F = lambda: Font(name=FONT_NAME, size=11, color=ACCENT_WARNING, bold=True)
CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)


def _disp_w(s):
    w = 0.0
    for ch in str(s):
        w += 1.7 if unicodedata.east_asian_width(ch) in ("W", "F") else 1.0
    return w


def auto_fit_safe(ws, min_width=8, max_width=42, data_start_row=5):
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


def finalize_text_rows(ws, text_cols, data_start_row=5, cap=150):
    merged = {c.coordinate for rng in ws.merged_cells.ranges for row in ws[rng.coord] for c in row}
    for row_idx in range(data_start_row, ws.max_row + 1):
        max_lines = 1
        touched = False
        for letter in text_cols:
            cell = ws[f"{letter}{row_idx}"]
            if isinstance(cell, MergedCell) or cell.coordinate in merged:
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


def notes_row(ws, row, text, last_col):
    cell = ws.cell(row=row, column=2, value=text)
    cell.font = font_caption()
    cell.alignment = Alignment(horizontal="left", vertical="top", wrap_text=True)
    ws.merge_cells(start_row=row, start_column=2, end_row=row, end_column=last_col)


wb = Workbook()

# ================================================================ FEUILLE 1
ws = wb.active
ws.title = "Synthèse du routage"
HEAD1 = ["Type de demande", "Destinataire PRINCIPAL", "Repli si l'adresse dédiée est vide",
         "Copie automatique (arrière-plan)", "Confirmation au demandeur",
         "Champ de configuration"]
last_col = len(HEAD1) + 1  # B..G
setup_sheet(ws, title="AutoRH — Map de routage e-mail des demandes (portail employé, v0.2.112)", last_col=last_col)
for i, h in enumerate(HEAD1, start=2):
    ws.cell(row=4, column=i, value=h)
style_header_row(ws, row_num=4, col_start=2, col_end=last_col)

ROWS1 = [
    ["Attestation de travail",
     "Adresse DÉDIÉE attestationTravailEmail (NOUVEAU v0.2.94) ; sinon boîte RH.",
     "Boîte RH (rhEmail) — comportement historique Task 116 conservé.",
     "— (la demande part à son destinataire principal).",
     "Oui — automatique (v0.2.94 : tous les types).",
     "attestationTravailEmail"],
    ["Attestation de salaire",
     "Adresse DÉDIÉE attestationSalaireEmail (NOUVEAU v0.2.94) ; sinon boîte RH.",
     "Boîte RH (rhEmail).",
     "—.",
     "Oui — automatique (v0.2.94).",
     "attestationSalaireEmail"],
    ["Congé",
     "E-mail du N+1 saisi par l'employé dans le formulaire (emailN1) — INCHANGÉ.",
     "— (sans e-mail N+1 : aucun envoi, motif journalisé, la demande reste dans l'onglet Demandes).",
     "COPIE SYSTÉMATIQUE à l'adresse dédiée congeEmail (NOUVEAU v0.2.94) ; vide → copie à la boîte RH (comportement v0.2.88 conservé).",
     "Oui — automatique (v0.2.94).",
     "congeEmail"],
    ["Autorisation de sortie",
     "Responsable N+1 indiqué par l'employé (responsableN1) — INCHANGÉ (v0.2.88).",
     "En cascade : responsable du département (table des responsables) → ligne DEFAUT → boîte RH.",
     "COPIE SYSTÉMATIQUE à l'adresse dédiée autorisationEmail (NOUVEAU v0.2.94) ; vide → copie à la boîte RH.",
     "Oui — automatique (v0.2.94).",
     "autorisationEmail"],
    ["Parrainage",
     "Adresse DÉDIÉE parrainageEmail (v0.2.49 / routage exclusif v0.2.92) — le N+1 n'est plus saisi.",
     "Boîte RH (rhEmail) — la demande doit toujours aboutir quelque part.",
     "— (l'adresse dédiée EST le destinataire principal).",
     "Oui — automatique (v0.2.92, premier type confirmé).",
     "parrainageEmail"],
]
for i, row in enumerate(ROWS1):
    r = 5 + i
    for j, v in enumerate(row, start=2):
        ws.cell(row=r, column=j, value=v)
    style_data_row(ws, row_num=r, col_start=2, col_end=last_col, row_index=i)
    ws.cell(row=r, column=6).font = OUI_F()
    ws.cell(row=r, column=6).alignment = CENTER
    champ = ws.cell(row=r, column=7)
    champ.font = Font(name="Consolas", size=10, color=PRIMARY)
    champ.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)

notes_row(ws, 5 + len(ROWS1) + 1,
          "Destinataires prouvés par SMTP puits (capture RCPT TO) — preuve E2E scripts/test_v094_routage_emails.js : "
          "24/24 OK. « Vide » = champ laissé vide dans le panneau SMTP → routage (l'adresse n'est jamais obligatoire). "
          "v0.2.108 : la réponse du destinataire prévu décide la demande (« Acceptée » / « Refusée » — libellés au féminin) pour "
          "TOUS les types ; le statut est mis à jour automatiquement, la pièce jointe éventuelle est jointe à l'e-mail de "
          "l'employé et disponible dans son portail ; la copie au service RH n'est envoyée que lorsque la décision vient du "
          "responsable N+1. v0.2.112 : dans « Accès portail », la colonne « Matricule » retrouve son propre en-tête "
          "(plus de confusion avec l'e-mail d'accès) et les colonnes « Nom » / « Prénom » se remplissent automatiquement "
          "depuis les fiches de paie — composés « Ben »/« Bel »/« Bou » ensemble.",
          last_col)
auto_fit_safe(ws)
finalize_text_rows(ws, ["C", "D", "E", "F", "G"])
ws.column_dimensions["B"].width = 20
ws.column_dimensions["G"].width = 24
ws.freeze_panes = "B5"

# ================================================================ FEUILLE 2
ws2 = wb.create_sheet("Champs de configuration")
HEAD2 = ["Champ (base de données)", "Libellé dans l'interface", "Rôle du champ",
         "Qui peut le modifier", "Validation à l'enregistrement", "Introduit en"]
last_col2 = len(HEAD2) + 1  # B..G
setup_sheet(ws2, title="Champs de routage — panneau « Paramètres » → SMTP → Routage des demandes", last_col=last_col2)
for i, h in enumerate(HEAD2, start=2):
    ws2.cell(row=4, column=i, value=h)
style_header_row(ws2, row_num=4, col_start=2, col_end=last_col2)

ROWS2 = [
    ["rhEmail", "E-mail du service RH (attestations)",
     "Boîte commune du service RH : repli des attestations sans adresse dédiée, repli du parrainage, copie des congés/autorisations sans adresse dédiée.",
     "IT + SuperAdmin", "E-mail valide (400 sinon).", "Task 116"],
    ["itEmail", "E-mail du service informatique (optionnel)",
     "Notifications techniques éventuelles — aucun routage automatique actuel.",
     "IT + SuperAdmin", "E-mail valide si renseigné.", "Task 116"],
    ["responsablesMap", "Responsables — autorisations de sortie (une règle par ligne)",
     "Table de repli du routage des autorisations : DEPARTEMENT=email, ligne DEFAUT=email pour les départements sans règle.",
     "IT + SuperAdmin", "Max 100 lignes ; chaque ligne « CLE=email » avec e-mail valide.", "Task 116"],
    ["parrainageEmail", "E-mail dédié des demandes de parrainage",
     "Destinataire PRINCIPAL du parrainage (v0.2.92 : l'employé ne saisit plus de N+1).",
     "IT + SuperAdmin", "E-mail valide si renseigné.", "v0.2.49"],
    ["attestationTravailEmail", "E-mail dédié — attestations de travail",
     "Destinataire PRINCIPAL des demandes d'attestation de travail.",
     "IT + SuperAdmin", "E-mail valide si renseigné (message dédié, 400).", "v0.2.94 (Task 197)"],
    ["attestationSalaireEmail", "E-mail dédié — attestations de salaire",
     "Destinataire PRINCIPAL des demandes d'attestation de salaire.",
     "IT + SuperAdmin", "E-mail valide si renseigné (message dédié, 400).", "v0.2.94 (Task 197)"],
    ["congeEmail", "E-mail dédié — demandes de congé (copie)",
     "Reçoit une COPIE de chaque demande de congé (le N+1 saisi reste principal).",
     "IT + SuperAdmin", "E-mail valide si renseigné (message dédié, 400).", "v0.2.94 (Task 197)"],
    ["autorisationEmail", "E-mail dédié — autorisations de sortie (copie)",
     "Reçoit une COPIE de chaque autorisation de sortie (le N+1 saisi reste principal).",
     "IT + SuperAdmin", "E-mail valide si renseigné (message dédié, 400).", "v0.2.94 (Task 197)"],
]
for i, row in enumerate(ROWS2):
    r = 5 + i
    for j, v in enumerate(row, start=2):
        ws2.cell(row=r, column=j, value=v)
    style_data_row(ws2, row_num=r, col_start=2, col_end=last_col2, row_index=i)
    c = ws2.cell(row=r, column=2)
    c.font = Font(name="Consolas", size=10, color=PRIMARY)
    if "Task 197" in row[5]:
        for j in range(2, last_col2 + 1):
            cell = ws2.cell(row=r, column=j)
            cell.fill = PatternFill("solid", fgColor="FEF9E7")
        ws2.cell(row=r, column=7).font = NEW_F()

notes_row(ws2, 5 + len(ROWS2) + 1,
          "Emplacement : administration (port 4000) → onglet « Paramètres » (rôle IT) → panneau SMTP → section "
          "« Routage des demandes administratives ». API : GET /api/mail-config (RH = booléen « configurée » seul) et "
          "PUT /api/mail-config (IT + SuperAdmin, sinon 403). Les adresses de routage restent en clair en base "
          "(comme host/from) — seuls le compte et le mot de passe SMTP sont chiffrés (AES-256-GCM).",
          last_col2)
auto_fit_safe(ws2)
finalize_text_rows(ws2, ["C", "D", "F"])
ws2.column_dimensions["B"].width = 24
ws2.column_dimensions["G"].width = 17
ws2.freeze_panes = "B5"

# ================================================================ FEUILLE 3
ws3 = wb.create_sheet("Mécanique commune")
HEAD3 = ["Mécanisme", "Comportement (code v0.2.94)"]
last_col3 = len(HEAD3) + 1  # B..D
setup_sheet(ws3, title="Mécanique commune à toutes les demandes — envoi, journal, réception", last_col=last_col3)
for i, h in enumerate(HEAD3, start=2):
    ws3.cell(row=4, column=i, value=h)
style_header_row(ws3, row_num=4, col_start=2, col_end=last_col3)

ROWS3 = [
    ["Envoi en arrière-plan",
     "La création d'une demande répond 201 immédiatement ; les e-mails partent en arrière-plan (jamais bloquant). "
     "Sans destinataire résolu : rien n'est envoyé, l'échec est journalisé (code DESTINATAIRE_ABSENT) et la demande reste traitable dans l'onglet « Demandes »."],
    ["Expéditeur effectif",
     "Champ « from » s'il est renseigné ; sinon « Auto-RH <compte SMTP> » si le compte est un e-mail ; sinon « Auto-RH »."],
    ["Message-ID mémorisé",
     "Le Message-ID de l'e-mail principal est stocké (messageIdEnvoi) : la RÉPONSE du responsable N+1 est reconnue par les en-têtes "
     "In-Reply-To / References même si le sujet est modifié — jamais bloquant."],
    ["Confirmation au demandeur",
     "v0.2.94 (Task 197) : pour les 5 types, un e-mail de confirmation est envoyé à l'adresse de notification de l'employé "
     "(PortalAccess.email, chiffré ; repli Task 175 : dernière adresse utilisée pour l'envoi du mot de passe initial — mailEnvoyeA), "
     "avec le récapitulatif de la demande et sa référence."],
    ["Journal d'envoi",
     "logs/journal-emails.log — consultable dans l'administration (onglet Demandes → journal, IT + SuperAdmin, 300 dernières lignes). "
     "Actions : demande-creation (principal), demande-creation-copie-rh (repli RH), demande-creation-copie-dediee (NOUVEAU v0.2.94), "
     "demande-creation-confirmation-demandeur."],
    ["Réception des réponses (IMAP)",
     "Le RH répond à l'e-mail de la demande en joignant le document ; la pièce jointe est détectée par IMAP (boîte du compte d'envoi "
     "ou compte dédié), chiffrée sur le disque et associée automatiquement à la demande (portail employé → « Mes demandes »)."],
    ["Notification employé AVEC pièce jointe (v0.2.106)",
     "Le document de réponse est JOINT à la notification de l'employé pour TOUS les types de demandes : import direct (administration) "
     "comme réponse e-mail IMAP. La notification reste « NE PAS répondre » ; les copies RH / N+1 restent SANS pièces jointes."],
    ["Matricule employé dans les e-mails (v0.2.107)",
     "Le matricule de l'employé, récupéré automatiquement depuis ses fiches de paie (valeur manuelle de l'accès portail prioritaire), "
     "figure dans TOUS les e-mails du circuit : création au service traitant, confirmation au demandeur, changement de statut, "
     "notification du document — colonnes « Matricule » également affichées dans « Toutes les fiches », « Accès portail » et « Demandes »."],
    ["Matricule employé dans les e-mails (v0.2.107)",
     "Le matricule de l'employé, récupéré automatiquement depuis ses fiches de paie (valeur manuelle de l'accès portail prioritaire), "
     "figure dans TOUS les e-mails du circuit : création au service traitant, confirmation au demandeur, changement de statut, "
     "notification du document — colonnes « Matricule » également affichées dans « Toutes les fiches », « Accès portail » et « Demandes »."],
    ["Matricule employé dans les e-mails (v0.2.107)",
     "Le matricule de l'employé, récupéré automatiquement depuis ses fiches de paie (valeur manuelle de l'accès portail prioritaire), "
     "figure dans TOUS les e-mails du circuit : création au service traitant, confirmation au demandeur, changement de statut, "
     "notification du document — colonnes « Matricule » également affichées dans « Toutes les fiches », « Accès portail » et « Demandes »."],
    ["Tampon des documents de réponse",
     "Le document de réponse importé manuellement ou reçu par IMAP est tamponné selon la configuration DÉDIÉE des réponses "
     "(scope=reponse, v0.2.93) : interrupteurs, textes, positions, décalages, rotations, case à cocher certificat."],
    ["Garde-fous du portail",
     "Plafond de 30 demandes ouvertes par employé (429 au-delà) ; nom/prénom et e-mail du demandeur résolus AUTOMATIQUEMENT depuis "
     "l'administration (aucune saisie d'identité) ; e-mails et données chiffrés (AES-256-GCM)."],
]
for i, row in enumerate(ROWS3):
    r = 5 + i
    for j, v in enumerate(row, start=2):
        ws3.cell(row=r, column=j, value=v)
    style_data_row(ws3, row_num=r, col_start=2, col_end=last_col3, row_index=i)
    ws3.cell(row=r, column=2).font = Font(name=FONT_NAME, size=11, bold=HEADER_BOLD, color=PRIMARY)
auto_fit_safe(ws3)
ws3.column_dimensions["B"].width = 24
ws3.column_dimensions["C"].width = 100
finalize_text_rows(ws3, ["C"])
ws3.freeze_panes = "B5"

# ================================================================ FEUILLE 4
ws4 = wb.create_sheet("Sources")
HEAD4 = ["Fichier / preuve", "Contenu audité"]
last_col4 = len(HEAD4) + 1  # B..C
setup_sheet(ws4, title="Sources — état du code v0.2.94 (26 septembre 2026)", last_col=last_col4)
for i, h in enumerate(HEAD4, start=2):
    ws4.cell(row=4, column=i, value=h)
style_header_row(ws4, row_num=4, col_start=2, col_end=last_col4)

ROWS4 = [
    ["prisma/schema.prisma — model MailConfig",
     "8 champs de routage en clair : rhEmail, itEmail, responsablesMap, parrainageEmail (v0.2.49) et les 4 adresses dédiées "
     "attestationTravailEmail / attestationSalaireEmail / congeEmail / autorisationEmail (v0.2.94)."],
    ["src/app/api/mail-config/route.ts",
     "GET (RH = booléen « configurée » seul ; IT + SuperAdmin = configuration complète) et PUT (IT + SuperAdmin, 403 sinon) avec "
     "validation des 4 adresses dédiées (400 + message par type)."],
    ["src/lib/mailer.ts",
     "lireConfigMail / ConfigMailLue — expose les 8 champs de routage ; expéditeur effectif ; envoie les e-mails de test."],
    ["src/components/payslip/mail-panel.tsx",
     "Section « Routage des demandes administratives » : 4 nouveaux champs dédiés (attestations travail / salaire, congé copie, "
     "autorisation copie) + parrainage + table des responsables."],
    ["scripts/portail-server.js — destinatairePourDemande",
     "Routage par type : attestations → dédiée puis RH ; congé → emailN1 ; autorisation → responsableN1 puis table des responsables "
     "puis DEFAUT puis RH ; parrainage → parrainageEmail puis RH."],
    ["scripts/portail-server.js — envoyerEmailsDemandeEnArrierePlan",
     "E-mail principal + copie dédiée (congeEmail / autorisationEmail, sinon RH — action « demande-creation-copie-dediee ») + "
     "CONFIRMATION au demandeur ÉTENDUE à tous les types (v0.2.94)."],
    ["scripts/portail-server.js — envoyerEmailDemandeConfirmation",
     "Confirmation générique par type (« Votre demande « <libellé> » … ») — libellés Attestation de travail / Attestation de salaire / "
     "Demande de congé / Autorisation de sortie / Demande de parrainage."],
    ["scripts/test_v094_routage_emails.js — PREUVE E2E 24/24 OK",
     "SMTP puits (RCPT TO) : attestations parties aux adresses dédiées ; congé/autorisation → N+1 principal + copie dédiée ; "
     "parrainage → dédiée ; 5 confirmations au demandeur ; repli RH vérifié (adresse dédiée vidée en base) ; journal complet ; "
     "API : PUT/GET persistés + 400 sur adresse invalide."],
]
for i, row in enumerate(ROWS4):
    r = 5 + i
    for j, v in enumerate(row, start=2):
        ws4.cell(row=r, column=j, value=v)
    style_data_row(ws4, row_num=r, col_start=2, col_end=last_col4, row_index=i)
    ws4.cell(row=r, column=2).font = Font(name="Consolas", size=10, color=PRIMARY)
auto_fit_safe(ws4)
ws4.column_dimensions["B"].width = 46
ws4.column_dimensions["C"].width = 92
finalize_text_rows(ws4, ["C"])
ws4.freeze_panes = "B5"

wb.properties.creator = "AutoRH"
wb.save(OUT)
print("OK :", OUT)
