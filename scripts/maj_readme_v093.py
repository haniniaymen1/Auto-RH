#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 195 — Met à jour le README PDF (auto-rh-readme-technique.pdf) sur l'état v0.2.93.

1) Repart TOUJOURS de l'édition condensée d'origine (19 pages, sauvegarde
   /tmp/my-project/auto-rh-readme-technique-v0.2.65-avant-matrice.pdf) —
   aucune retouche des pages existantes, aucune chirurgie d'octets.
2) Génère avec ReportLab (mêmes familles de polices que le document existant) :
   - Annexe A — Matrice des droits des rôles, refaite sur le code v0.2.93
     (29 lignes en 7 groupes, onglets corrigés 6/5/2, bloc portail employé,
     principes actualisés) ;
   - Annexe B — Évolutions de l'application v0.2.83 à v0.2.93 (8 évolutions
     vérifiées : QR publics HMAC, certificat multi-formats, positionnement
     libre, modifier-email, parrainage simplifié, scope=reponse, aperçu A4,
     diffusion des livrables).
3) Fusionne via pypdf, vérifie (nombre de pages + marqueurs de texte), écrit :
   - auto-rh-readme-technique.pdf (racine)
   - download/auto-rh-readme-technique.pdf
   - download/auto-rh-readme-technique-v0.2.95.pdf (édition versionnée,
     servie en priorité par la route publique /api/download-readme)

Task 196 (27/09/2026) — CORRECTION : dans l'édition initiale de l'annexe A,
les colonnes RH et IT étaient INVERSÉES sur 19 lignes (ex. consultation des
fiches affichée RH=Non / IT=Oui alors que le code donne RH=Oui / IT=Non 403
refusIT). Ré-audit complet des 31 routes API v0.2.93 (/tmp/audit-v093) et des
onglets page.tsx ; valeurs rétablies conformes à la matrice Excel officielle
(Auto-RH-Matrice-roles-utilisateurs-v0.2.93.xlsx, elle-même conforme).
Un auto-contrôle en début de script bloque toute ré-inversion future.

Task 197 (27/09/2026) — v0.2.94 : NOUVELLE LIGNE en annexe B — map de
configuration des mails (une adresse e-mail DÉDIÉE par type de demande :
attestations = destinataire principal avec repli RH ; congé / autorisation =
N+1 principal + COPIE systématique à la boîte dédiée avec repli RH ;
parrainage inchangé) et confirmation automatique au demandeur ÉTENDUE à tous
les types. Marqueurs et édition versionnée passés à v0.2.94.

Task 198 (27/09/2026) — v0.2.95 : NOUVELLE ANNEXE C « Map de routage des
e-mails des demandes du portail employé » (routage par type, 8 champs de
configuration, mécanique commune — alignée sur le classeur Excel servi par
/api/download-routage) ; annexe A : ligne messagerie étendue au routage et
pages publiques à jour (4 téléchargements) ; annexe B : ligne v0.2.95 ;
matrice Excel officielle régénérée en v0.2.95 (66 permissions). Édition
versionnée et marqueurs passés à v0.2.95.
"""
import io
import os
import shutil
import hashlib

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader, PdfWriter

RACINE = "/home/z/my-project"
PDF_CIBLE = os.path.join(RACINE, "auto-rh-readme-technique.pdf")
PDF_DL = os.path.join(RACINE, "download", "auto-rh-readme-technique.pdf")
PDF_VERSIONNE = os.path.join(RACINE, "download", "auto-rh-readme-technique-v0.2.95.pdf")
SAUVEGARDE = "/tmp/my-project/auto-rh-readme-technique-v0.2.65-avant-matrice.pdf"

# ---- Polices (mêmes familles que le README existant) -----------------------
pdfmetrics.registerFont(TTFont("Serif", "/usr/share/fonts/truetype/freefont/FreeSerif.ttf"))
pdfmetrics.registerFont(TTFont("Serif-B", "/usr/share/fonts/truetype/freefont/FreeSerifBold.ttf"))
pdfmetrics.registerFont(TTFont("Serif-I", "/usr/share/fonts/truetype/freefont/FreeSerifItalic.ttf"))
pdfmetrics.registerFont(TTFont("Mono", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"))

LARG, HAUT = A4
MARGE_G, MARGE_D, MARGE_H, MARGE_B = 2.0 * cm, 2.0 * cm, 1.9 * cm, 1.8 * cm
LARGE_UTILE = LARG - MARGE_G - MARGE_D

ENCRE = colors.HexColor("#1a1a1a")
GRIS = colors.HexColor("#555555")
ACCENT = colors.HexColor("#0f4c46")
LIGNE = colors.HexColor("#c9d4d2")
FOND_GROUPE = colors.HexColor("#eef4f3")
FOND_ENTETE = colors.HexColor("#0f4c46")
FOND_NEUTRE = colors.HexColor("#f5f5f2")
VERT_OUI = colors.HexColor("#1c6b40")
ROUGE_NON = colors.HexColor("#9c2f2f")

# ---- Annexe A : matrice (état du code vérifié v0.2.95, archive livrée) -----
# Valeurs dans l'ordre : SuperAdmin, RH, IT.
# Task 196 : colonnes RH/IT rétablies conformément au code réel — les groupes
# « Fiches de paie », « Tampon, signature et certificat », « Accès portail »
# et l'essentiel de « Demandes administratives » sont gardés par refusIT
# (RH admis, IT refusé 403) ; l'IT n'a l'avantage que sur le journal IMAP,
# le SMTP, la liste des comptes (consultation) et les nuances « Limité ».
GROUPES = [
    ("Fiches de paie", [
        ("Consultation — recherche par CIN, toutes les fiches, détail, fichier tamponné à la volée (original intact)", "Oui", "Oui", "Non"),
        ("Importer des fiches de paie (PDF Sage, détection d'anomalies de nom)", "Oui", "Oui", "Non"),
        ("Supprimer des fiches (unitaire et multiple)", "Oui", "Oui", "Non"),
        ("Maintenance — redétection du contenu, indexation de la base", "Oui", "Oui", "Non"),
        ("QR « Fiche en ligne » — page publique sous jeton HMAC (nouveau v0.2.88) : activation et configuration", "Oui", "Oui", "Non"),
    ]),
    ("Tampon, signature et certificat", [
        ("Configuration du tampon signature et QR des fiches (consultation, modification, aperçu)", "Oui", "Oui", "Non"),
        ("Import du certificat de signature — 10 formats (.p12, .pfx, .pem, .cer…), fichier chiffré sur disque (nouveau v0.2.88)", "Oui", "Oui", "Non"),
        ("Activation (interrupteur) et positionnement libre du certificat — décalages ± 1500 pt, taille de 50 à 300 % (v0.2.88 / 0.2.92)", "Oui", "Oui", "Non"),
        ("Aperçu A4 interactif — clic et glisser indépendants signature / QR / certificat, curseurs synchronisés (v0.2.89 / 0.2.93)", "Oui", "Oui", "Non"),
    ]),
    ("Accès portail par mot de passe", [
        ("Créer / réinitialiser / activer-désactiver / débloquer / supprimer un accès", "Oui", "Oui", "Non"),
        ("QR code d'accès / réinitialisation du QR", "Oui", "Oui", "Non"),
        ("Envoyer le mot de passe initial par e-mail (adresse enregistrée sur le compte)", "Oui", "Oui", "Non"),
        ("Modifier « Nom et prénom » (répercuté sur toutes les fiches du CIN)", "Oui", "Oui", "Non"),
        ("Modifier l'e-mail de l'employé — champ chiffré, notifications de suivi et « Send Mail » (nouveau v0.2.91)", "Oui", "Oui", "Non"),
    ]),
    ("Demandes administratives", [
        ("Liste, détail, traitement (statut + commentaire + notification e-mail)", "Oui", "Oui", "Non"),
        ("Réponse avec document (import direct ; tampon automatique lu dans la config des réponses)", "Oui", "Oui", "Limité"),
        ("Téléchargement des documents de réponse", "Oui", "Oui", "Limité"),
        ("Journal d'envoi IMAP (outil de diagnostic de la réception automatique)", "Oui", "Non", "Oui"),
        ("QR « Réponse en ligne » — page publique sous jeton HMAC (nouveau v0.2.88) : activation et configuration", "Oui", "Oui", "Non"),
        ("Configuration DÉDIÉE du tampon des réponses — panneau « Configuration des réponses » (nouveau v0.2.93)", "Oui", "Oui", "Non"),
    ]),
    ("Paramètres techniques — messagerie", [
        ("Consulter la configuration SMTP", "Oui", "Booléen « configurée » seul", "Oui"),
        ("Modifier la configuration SMTP — dont le routage des demandes : 4 boîtes e-mail dédiées par type (v0.2.94, détails en annexe C) — et tests d'envoi SMTP / IMAP (l'onglet « Paramètres » n'est exposé qu'au rôle IT)", "Oui", "Non", "Oui"),
    ]),
    ("Comptes utilisateurs", [
        ("Lister les comptes", "Oui", "Non", "Oui (consultation seule)"),
        ("Créer un compte RH ou IT", "Oui", "Non", "Non"),
        ("Activer / désactiver / supprimer un compte", "Oui", "Non", "Non"),
        ("Réinitialiser le mot de passe d'un compte (révoque les sessions)", "Oui", "Non", "Non"),
        ("Changer le rôle d'un compte (RH ↔ IT)", "Oui", "Non", "Non"),
    ]),
    ("Divers", [
        ("Statistiques du tableau de bord", "Oui", "Oui", "Oui"),
        ("Changement de son propre mot de passe (expiration 15 jours)", "Oui", "Oui", "Oui"),
    ]),
]

ONGLETS = [
    ("SuperAdmin (6 onglets)", "Recherche CIN · Toutes les fiches · Importer (tampon, signature, certificat) · Accès portail · Demandes (avec la configuration des réponses) · Utilisateurs"),
    ("RH (5 onglets)", "les mêmes onglets sauf « Utilisateurs »"),
    ("IT (2 onglets)", "Paramètres (SMTP seul) · Utilisateurs (consultation seule) — le tampon, la signature et le certificat en sont retirés"),
]

PORTAIL = [
    "Connexion CIN + mot de passe + code OTP (2FA TOTP à chaque connexion) ; mot de passe initial à usage unique, changé obligatoirement à la première connexion puis tous les 15 jours.",
    "Consultation de SES fiches de paie uniquement (CIN de la session) — PDF, image, DOCX, XLSX, tampon appliqué à la volée, original intact.",
    "Renseigner son e-mail de notification (stocké chiffré) — utilisé pour le suivi de SES demandes.",
    "Créer des demandes administratives (5 types : attestation de travail, attestation de salaire, congé, autorisation de sortie, parrainage), les suivre et recevoir les documents de réponse.",
    "Parrainage simplifié (v0.2.92) : plus aucun champ N+1 saisi — confirmation e-mail automatique envoyée au demandeur.",
    "Routage des e-mails des demandes (v0.2.94) : attestations → adresse dédiée (repli boîte RH), congé et autorisation de sortie → responsable N+1 principal + copie à l'adresse dédiée (repli boîte RH), parrainage → adresse dédiée ; accusé de réception automatique au demandeur pour les 5 types (détails en annexe C).",
    "Aucune fonction d'administration : verrouillage temporaire après échecs consécutifs, aucune API d'administration exposée.",
]

PRINCIPES = [
    "Toute restriction est DOUBLE : réponse 403 côté serveur (code FONCTIONNALITE_NON_AUTORISEE_IT pour le rôle IT) ET masquage de l'élément dans l'interface — jamais l'un sans l'autre.",
    "L'inscription libre (« Créer un compte » avec code d'activation) n'existe plus : les comptes RH et IT sont créés exclusivement par le superadministrateur (onglet Utilisateurs).",
    "Mot de passe expiré (politique 15 jours, tous les comptes) : toute API de données répond 403 jusqu'au changement effectif ; tout changement ou réinitialisation révoque immédiatement TOUTES les sessions antérieures (jetons liés à la version du mot de passe).",
    "Le portail employé (CIN + mot de passe + code OTP) reste accessible aux employés indépendamment des trois rôles d'administration.",
    "Pages publiques limitativement énumérées (v0.2.94) : /login, /api/auth/*, téléchargement du README, des scripts, de la matrice des rôles et de la map de routage des e-mails, pages de vérification QR (fiche et réponse) sous jeton HMAC signé.",
    "Données sensibles chiffrées (AES-256-GCM) : fiches de paie, adresses e-mail, mots de passe (scrypt), certificat de signature stocké sur disque.",
    "Références : gestion des rôles v0.2.78 (Task 173), retrait du tampon/signature à l'IT v0.2.81 (Task 176), certificat multi-formats v0.2.88 (Task 181), modification de l'e-mail employé v0.2.91 (Task 192), séparation des configurations de tampon v0.2.93, routage des e-mails des demandes par type v0.2.94 (Task 197) — preuves E2E conservées dans scripts/.",
]

# ---- Auto-contrôle (Task 196) : interdit toute ré-inversion RH/IT ---------
# Les trois premiers groupes et 5 des 6 lignes « Demandes » sont gardés par
# refusIT côté serveur : RH doit y être « Oui » et IT « Non » ou « Limité ».
_GARDES_REFUSIT = {
    "Fiches de paie",
    "Tampon, signature et certificat",
    "Accès portail par mot de passe",
    "Demandes administratives",
}
for _g, _lignes in GROUPES:
    if _g not in _GARDES_REFUSIT:
        continue
    for _t, _sa, _rh, _it in _lignes:
        if _g == "Demandes administratives" and "IMAP" in _t:
            continue  # exception vérifiée : /api/demandes/journal = IT + SuperAdmin
        assert _rh == "Oui", "RH doit être Oui (refusIT) dans : " + _t
        assert _it in ("Non", "Limité"), "IT doit être Non ou Limité (refusIT) dans : " + _t

# ---- Annexe B : évolutions v0.2.83 à v0.2.93 -------------------------------
B_INTRO = (
    "Cette annexe récapitule les évolutions livrées depuis l'édition v0.2.82 du présent README, "
    "toutes vérifiées dans le code source livré v0.2.95 et couvertes par des preuves E2E conservées "
    "dans le dossier scripts/. L'édition condensée des 19 premières pages décrit l'architecture, "
    "l'installation et les procédures de chiffrement ; les évolutions ci-dessous s'ajoutent sans "
    "modifier ces fondements. La matrice complète des 66 permissions et des 56 endpoints API est "
    "publiée dans le classeur Excel « Auto-RH-Matrice-roles-utilisateurs-v0.2.95.xlsx », "
    "téléchargeable via la route /api/download-matrice."
)

B_ROWS = [
    ("v0.2.88",
     "QR « Fiche en ligne » et « Réponse en ligne » : deux pages de vérification PUBLIQUES (sans session), servies sous jeton HMAC signé par fiche / par référence de demande ; l'activation et la configuration restent réservées aux rôles RH et SUPERADMIN (Task 180).",
     "Lecture publique ; configuration RH + SuperAdmin"),
    ("v0.2.88",
     "Certificat de signature électronique multi-formats : 10 formats acceptés (.p12, .pfx, .pkcs7, .p7s, .p7m, .xml, .ps7x, .pem, .cer/.crt/.der), fichier CHIFFRÉ sur disque, métadonnées extraites à l'import, interrupteur d'activation (Task 181).",
     "RH + SuperAdmin"),
    ("v0.2.89 / 0.2.92",
     "Positionnement libre du tampon : signature, QR et certificat positionnables au clic et déplaçables au glisser sur l'aperçu A4 ; décalages fins ± 1500 points, taille de 50 à 300 % — bloc dessiné dans les quatre moteurs (PDF, image, DOCX, XLSX).",
     "RH + SuperAdmin"),
    ("v0.2.91",
     "Modification de l'e-mail d'un employé : nouvelle action dans l'onglet « Accès portail » (champ chiffré) ; répercutée sur les notifications de suivi des demandes et le destinataire proposé de « Send Mail » ; ne touche pas aux fiches de paie (Task 192).",
     "RH + SuperAdmin (IT : 403)"),
    ("v0.2.92",
     "Parrainage simplifié : champ « N+1 / responsable hiérarchique » supprimé du formulaire (résiduel ignoré côté serveur) ; routage automatique vers l'adresse e-mail DÉDIÉE au parrainage (configurée dans le SMTP par IT / SuperAdmin, repli : adresse RH) ; confirmation AUTOMATIQUE envoyée au demandeur ; identité du parrain résolue côté serveur.",
     "Employé · RH · SuperAdmin"),
    ("v0.2.93",
     "Séparation des configurations de tampon : l'Import et les Demandes/Réponses disposent DÉSORMAIS de configurations PROPRES (interrupteurs, textes, positions, décalages, rotations, case à cocher certificat) via le paramètre scope=reponse ; les actifs importés (images, fichier certificat) restent partagés en lecture seule depuis l'onglet Importer.",
     "RH + SuperAdmin"),
    ("v0.2.93",
     "Aperçu A4 interactif : aperçu fidèle au format A4 avec glisser-déposer INDÉPENDANT des trois éléments (signature, QR, certificat) et synchronisation en temps réel des curseurs de position et de taille.",
     "RH + SuperAdmin"),
    ("v0.2.93",
     "Documentation et diffusion : matrice des rôles refaite sur le code v0.2.93 (64 permissions en 8 sections, 56 endpoints, 19 règles de sécurité) ; les livrables (README PDF, archive du code, matrice Excel) sont téléchargeables sans connexion via /api/download-readme, /api/download-scripts et /api/download-matrice.",
     "Documenté pour tous les rôles"),
    ("v0.2.94",
     "Map de configuration des mails : une adresse e-mail DÉDIÉE par type de demande, configurable dans le panneau SMTP → routage — quatre nouveaux champs : attestationTravailEmail et attestationSalaireEmail (attestations : destinataire PRINCIPAL, repli boîte RH), congeEmail et autorisationEmail (congé et autorisation de sortie : le N+1 saisi reste principal et la boîte dédiée reçoit une COPIE systématique, repli boîte RH) ; parrainage inchangé. CONFIRMATION automatique au demandeur ÉTENDUE à tous les types. Journal : nouvelle action « demande-creation-copie-dediee ». Documentée dans le classeur « Auto-RH-Map-routage-emails-demandes-v0.2.94.xlsx », téléchargeable via /api/download-routage ; preuve E2E 24/24 (scripts/test_v094_routage_emails.js).",
     "IT + SuperAdmin (configuration) ; Employé (confirmations) ; RH + SuperAdmin (traitement)"),
    ("v0.2.95",
     "Documentation : NOUVELLE annexe C « Map de routage des e-mails des demandes du portail employé » (destinataires principaux, copies automatiques, confirmations au demandeur, 8 champs de configuration) ; matrice des rôles mise à jour — routage des demandes v0.2.94 (MailConfig + 4 champs dédiés), route publique /api/download-routage, les 4 téléchargements publics documentés dans la référence des API ; archive v0.2.95 régénérée.",
     "Documenté pour tous les rôles"),
]

B_NOTE = (
    "Nuances d'audit documentées dans la matrice de référence : les routes /api/demandes/{id}/repondre "
    "et /api/demandes/{id}/documents/{docId} admettent l'IT côté serveur sans qu'aucune interface ne lui "
    "soit exposée (« Limité ») ; /api/stats reste ouverte à toute session valide ; l'import de fiches ne "
    "vérifie pas l'expiration du mot de passe ; la route /api/signature-config/certificat est morte "
    "(colonnes absentes du schéma) — l'import réel du certificat passe par PUT /api/signature-config "
    "(champ certFichier)."
)

# ---- Annexe C : map de routage des e-mails des demandes (Task 198) ---------
C_INTRO = (
    "Depuis la v0.2.94, chaque type de demande du portail employé dispose de son propre routage e-mail, "
    "configurable par l'IT ou le superadministrateur dans l'onglet « Paramètres » → panneau SMTP → section "
    "« Routage des demandes administratives ». Les deux attestations partent vers une adresse DÉDIÉE (boîte RH en "
    "repli) ; le congé et l'autorisation de sortie restent adressés au responsable N+1 saisi par l'employé, avec "
    "COPIE systématique à l'adresse dédiée (boîte RH en repli) ; le parrainage conserve son adresse dédiée "
    "exclusive. Dans tous les cas l'employé reçoit un accusé de réception automatique, et aucun envoi n'est perdu : "
    "un champ laissé vide retombe toujours sur la boîte RH. Les e-mails partent en arrière-plan (la création de la "
    "demande répond immédiatement) et chaque envoi est journalisé."
)

C_TYPES = [
    ("Attestation de travail",
     "Adresse DÉDIÉE attestationTravailEmail ; vide → boîte RH (rhEmail).",
     "(aucune)",
     "Oui"),
    ("Attestation de salaire",
     "Adresse DÉDIÉE attestationSalaireEmail ; vide → boîte RH (rhEmail).",
     "(aucune)",
     "Oui"),
    ("Congé",
     "Responsable N+1 saisi par l'employé (emailN1), inchangé.",
     "COPIE systématique à l'adresse DÉDIÉE congeEmail ; vide → copie boîte RH.",
     "Oui"),
    ("Autorisation de sortie",
     "Responsable N+1 indiqué par l'employé (cascade : responsable du département → ligne DEFAUT → boîte RH), inchangé.",
     "COPIE systématique à l'adresse DÉDIÉE autorisationEmail ; vide → copie boîte RH.",
     "Oui"),
    ("Parrainage",
     "Adresse DÉDIÉE parrainageEmail (le N+1 n'est plus saisi) ; vide → boîte RH.",
     "(aucune)",
     "Oui"),
]

C_CHAMPS = [
    ("rhEmail",
     "Boîte commune du service RH : repli des attestations et du parrainage sans adresse dédiée, copie des congés / autorisations sans adresse dédiée.",
     "Task 116"),
    ("itEmail",
     "Notifications techniques éventuelles — aucun routage automatique actuel.",
     "Task 116"),
    ("responsablesMap",
     "Table de repli des autorisations de sortie : DEPARTEMENT=email, ligne DEFAUT=email pour les départements sans règle.",
     "Task 116"),
    ("parrainageEmail",
     "Destinataire PRINCIPAL du parrainage (routage exclusif).",
     "v0.2.49"),
    ("attestationTravailEmail",
     "Destinataire PRINCIPAL des attestations de travail.",
     "v0.2.94 (nouveau)"),
    ("attestationSalaireEmail",
     "Destinataire PRINCIPAL des attestations de salaire.",
     "v0.2.94 (nouveau)"),
    ("congeEmail",
     "Reçoit une COPIE de chaque demande de congé (le N+1 saisi reste principal).",
     "v0.2.94 (nouveau)"),
    ("autorisationEmail",
     "Reçoit une COPIE de chaque autorisation de sortie (le N+1 saisi reste principal).",
     "v0.2.94 (nouveau)"),
]

C_MECANIQUE = [
    "Envoi en arrière-plan : la création d'une demande répond 201 immédiatement ; les e-mails partent ensuite, JAMAIS bloquants. Sans destinataire résolu, rien n'est envoyé, l'échec est journalisé (DESTINATAIRE_ABSENT) et la demande reste traitable dans l'onglet « Demandes ».",
    "Repli RH systématique : aucune adresse dédiée n'est obligatoire — un champ laissé vide retombe sur la boîte RH (comportement historique conservé), aucune demande ne peut être perdue.",
    "Anti-doublon : la copie dédiée n'est jamais envoyée lorsque son adresse est identique au destinataire principal.",
    "Confirmation au demandeur (les 5 types, v0.2.94) : récapitulatif et référence envoyés à l'adresse de notification de l'employé (PortalAccess.email, chiffré ; repli mailEnvoyeA — dernière adresse utilisée pour l'envoi du mot de passe initial).",
    "Journal d'envoi (logs/journal-emails.log, consultable IT / SuperAdmin — onglet Demandes) : demande-creation, demande-creation-copie-rh, demande-creation-copie-dediee (nouveau v0.2.94), demande-creation-confirmation-demandeur.",
    "Réponses par e-mail : le Message-ID de l'envoi principal est mémorisé — la réponse du responsable est reconnue par IMAP (In-Reply-To / References) même si le sujet est modifié ; le document reçu est chiffré, associé à la demande et tamponné selon la configuration dédiée des réponses (v0.2.93).",
    "Référence et preuve : classeur « Auto-RH-Map-routage-emails-demandes-v0.2.94.xlsx » téléchargeable via /api/download-routage ; preuve E2E 24/24 (scripts/test_v094_routage_emails.js — destinataires vérifiés par SMTP puits, capture RCPT TO).",
]

# ---- État partagé du canvas ------------------------------------------------
ETAT = {"annexe": "A", "page": 1}
PIEDS = {
    "A": "Annexe A : matrice des droits des rôles (état du code v0.2.95)",
    "B": "Annexe B : évolutions v0.2.83 à v0.2.95",
    "C": "Annexe C : map de routage des e-mails des demandes (v0.2.94)",
}


def lignes_texte(texte, largeur, police="Serif", taille=9.2):
    mots, lignes, courante = texte.split(), [], ""
    for m in mots:
        essai = (courante + " " + m).strip()
        if pdfmetrics.stringWidth(essai, police, taille) <= largeur:
            courante = essai
        else:
            if courante:
                lignes.append(courante)
            courante = m
    if courante:
        lignes.append(courante)
    return lignes


def dessine_paragraphe(c, x, y, largeur, texte, police="Serif", taille=9.2, pas=10.6):
    c.setFillColor(ENCRE)
    c.setFont(police, taille)
    for ln in lignes_texte(texte, largeur, police, taille):
        c.drawString(x, y, ln)
        y -= pas
    return y


def cellule_valeur(c, x, y, largeur, hauteur, texte, couleur):
    c.setFillColor(couleur)
    c.setFont("Serif-B", 8.6)
    c.drawCentredString(x + largeur / 2.0, y + (hauteur - 8.6) / 2.0 + 1.5, texte)


def pied(c):
    c.setFont("Serif", 8)
    c.setFillColor(GRIS)
    c.drawString(MARGE_G, MARGE_B - 0.45 * cm,
                 "Auto-RH — Documentation technique et README officiel — " + PIEDS[ETAT["annexe"]])
    c.drawRightString(LARG - MARGE_D, MARGE_B - 0.45 * cm,
                      "%s-%d" % (ETAT["annexe"], ETAT["page"]))


def nouvelle_page(c, avec_entete=None):
    pied(c)
    c.showPage()
    ETAT["page"] += 1
    if avec_entete is not None:
        return avec_entete(c, True)
    return HAUT - MARGE_H


def dessine_annexes():
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setTitle("Auto-RH — README officiel — Annexes A, B et C (état v0.2.95)")
    c.setAuthor("Auto-RH")

    # ================= ANNEXE A ============================================
    def entete_A(c, continue_):
        if not continue_:
            c.setFillColor(ACCENT)
            c.setFont("Serif-B", 16)
            c.drawString(MARGE_G, HAUT - MARGE_H - 0.05 * cm, "Annexe A — Matrice des droits des rôles")
            c.setFillColor(GRIS)
            c.setFont("Serif", 9.2)
            c.drawString(MARGE_G, HAUT - MARGE_H - 0.62 * cm,
                         "Complément à l'édition condensée (v0.2.65) — état du code vérifié v0.2.95 (archive livrée), 27 septembre 2026.")
            c.drawString(MARGE_G, HAUT - MARGE_H - 0.97 * cm,
                         "Trois rôles d'administration (SuperAdmin, RH, IT) sur le port 4000 ; l'employé dispose du portail dédié 4001 (bloc ci-après).")
            return HAUT - MARGE_H - 1.45 * cm
        c.setFillColor(ACCENT)
        c.setFont("Serif-B", 11)
        c.drawString(MARGE_G, HAUT - MARGE_H, "Annexe A — Matrice des droits (suite)")
        return HAUT - MARGE_H - 0.55 * cm

    y = entete_A(c, False)

    col_f = LARGE_UTILE * 0.44
    col_r = (LARGE_UTILE - col_f) / 3.0
    h_entete = 0.72 * cm
    pad = 0.14 * cm
    pas_ligne = 8.6

    def dessiner_entete_tableau():
        nonlocal y
        c.setFillColor(FOND_ENTETE)
        c.rect(MARGE_G, y - h_entete, LARGE_UTILE, h_entete, stroke=0, fill=1)
        c.setFillColor(colors.white)
        c.setFont("Serif-B", 9)
        c.drawString(MARGE_G + 6, y - h_entete + (h_entete - 9) / 2 + 1.5, "Fonctionnalité")
        c.drawCentredString(MARGE_G + col_f + col_r / 2, y - h_entete + (h_entete - 9) / 2 + 1.5, "SuperAdmin")
        c.drawCentredString(MARGE_G + col_f + col_r * 1.5, y - h_entete + (h_entete - 9) / 2 + 1.5, "RH")
        c.drawCentredString(MARGE_G + col_f + col_r * 2.5, y - h_entete + (h_entete - 9) / 2 + 1.5, "IT")
        y -= h_entete

    dessiner_entete_tableau()

    for groupe, lignes in GROUPES:
        h_groupe = 0.52 * cm
        if y - h_groupe < MARGE_B:
            y = nouvelle_page(c, entete_A)
            dessiner_entete_tableau()
        c.setFillColor(FOND_GROUPE)
        c.rect(MARGE_G, y - h_groupe, LARGE_UTILE, h_groupe, stroke=0, fill=1)
        c.setFillColor(ACCENT)
        c.setFont("Serif-B", 9.4)
        c.drawString(MARGE_G + 6, y - h_groupe + (h_groupe - 9.4) / 2 + 1.5, groupe)
        y -= h_groupe

        for texte, v_sup, v_rh, v_it in lignes:
            nl = len(lignes_texte(texte, col_f - 12))
            h = max(0.58 * cm, nl * pas_ligne * 0.0353 * cm + 2 * pad)
            if y - h < MARGE_B:
                y = nouvelle_page(c, entete_A)
                dessiner_entete_tableau()
            yy = y - pad - 7.5
            c.setFillColor(ENCRE)
            c.setFont("Serif", 9.2)
            for ln in lignes_texte(texte, col_f - 12):
                c.drawString(MARGE_G + 6, yy, ln)
                yy -= pas_ligne
            c.setStrokeColor(LIGNE)
            c.setLineWidth(0.5)
            for i in (1, 2, 3):
                c.line(MARGE_G + col_f + col_r * i, y - h, MARGE_G + col_f + col_r * i, y)
            c.line(MARGE_G, y - h, MARGE_G + LARGE_UTILE, y - h)
            cellule_valeur(c, MARGE_G + col_f, y - h, col_r, h, v_sup,
                           VERT_OUI if v_sup == "Oui" else (ROUGE_NON if v_sup == "Non" else GRIS))
            cellule_valeur(c, MARGE_G + col_f + col_r, y - h, col_r, h, v_rh,
                           VERT_OUI if v_rh == "Oui" else (ROUGE_NON if v_rh == "Non" else GRIS))
            cellule_valeur(c, MARGE_G + col_f + col_r * 2, y - h, col_r, h, v_it,
                           VERT_OUI if v_it == "Oui" else (ROUGE_NON if v_it == "Non" else GRIS))
            y -= h

    # note sous la matrice
    note = ("« Limité » = accès partiel (l'IT est admis côté serveur mais aucune interface ne lui est exposée) ; "
            "« Non » = refusé (403 côté serveur et/ou élément masqué dans l'interface). Le dernier compte "
            "superadministrateur actif est protégé contre la suppression et la désactivation.")
    y -= 0.28 * cm
    y = dessine_paragraphe(c, MARGE_G, y, LARGE_UTILE, note, "Serif-I", 8.4, 9.8)

    # ---- Page A-2 : onglets + portail + principes --------------------------
    def titre_bloc(txt):
        nonlocal y
        t_h = 0.7 * cm
        if y - t_h < MARGE_B:
            y = nouvelle_page(c, entete_A)
        c.setFillColor(ACCENT)
        c.setFont("Serif-B", 12)
        c.drawString(MARGE_G, y - 0.45 * cm, txt)
        y -= t_h + 0.12 * cm

    def bloc_lignes(entetes):
        nonlocal y
        for nom, detail in entetes:
            l1 = lignes_texte(nom, 4.4 * cm, "Serif-B", 9.2)
            l2 = lignes_texte(detail, LARGE_UTILE - 4.6 * cm)
            h = max(0.6 * cm, max(len(l1), len(l2)) * pas_ligne * 0.0353 * cm + 2 * pad)
            if y - h < MARGE_B:
                y = nouvelle_page(c, entete_A)
            yy = y - pad - 7.5
            c.setFillColor(ENCRE)
            c.setFont("Serif-B", 9.2)
            for ln in l1:
                c.drawString(MARGE_G, yy, ln)
                yy -= pas_ligne
            c.setFont("Serif", 9.2)
            x_detail = MARGE_G + 4.5 * cm
            yy = y - pad - 7.5
            for ln in l2:
                c.drawString(x_detail, yy, ln)
                yy -= pas_ligne
            y -= h
            c.setStrokeColor(LIGNE)
            c.setLineWidth(0.5)
            c.line(MARGE_G, y, MARGE_G + LARGE_UTILE, y)

    def bloc_puces(items):
        nonlocal y
        for p in items:
            l = lignes_texte(p, LARGE_UTILE - 0.55 * cm)
            h = len(l) * pas_ligne * 0.0353 * cm + 2 * pad
            if y - h < MARGE_B:
                y = nouvelle_page(c, entete_A)
            c.setFillColor(ACCENT)
            c.setFont("Serif-B", 9.2)
            c.drawString(MARGE_G, y - pad - 7.5, "•")
            yy = y - pad - 7.5
            c.setFillColor(ENCRE)
            c.setFont("Serif", 9.2)
            for ln in lignes_texte(p, LARGE_UTILE - 0.55 * cm):
                c.drawString(MARGE_G + 0.55 * cm, yy, ln)
                yy -= pas_ligne
            y -= h

    # les blocs suivent la matrice SANS saut de page inconditionnel :
    # titre_bloc / bloc_lignes / bloc_puces paginent proprement si besoin.
    y -= 0.35 * cm

    titre_bloc("Onglets visibles dans l'interface d'administration")
    bloc_lignes(ONGLETS)
    y -= 0.35 * cm

    # équilibre A-2 / A-3 : les blocs « portail employé » et « principes »
    # démarrent ensemble sur A-3 (sinon la dernière puce des principes se
    # retrouve orpheline au sommet d'une page quasi vide)
    y = nouvelle_page(c, entete_A)

    titre_bloc("Le portail employé (port 4001)")
    bloc_puces(PORTAIL)
    y -= 0.35 * cm

    titre_bloc("Principes appliqués")
    bloc_puces(PRINCIPES)

    # ================= ANNEXE B ============================================
    def entete_B(c, continue_):
        if not continue_:
            c.setFillColor(ACCENT)
            c.setFont("Serif-B", 16)
            c.drawString(MARGE_G, HAUT - MARGE_H - 0.05 * cm, "Annexe B — Évolutions de l'application v0.2.83 à v0.2.95")
            c.setFillColor(GRIS)
            c.setFont("Serif", 9.2)
            c.drawString(MARGE_G, HAUT - MARGE_H - 0.62 * cm,
                         "Complément à l'édition condensée et à l'annexe A — état du code livré v0.2.95, 27 septembre 2026.")
            c.drawString(MARGE_G, HAUT - MARGE_H - 0.97 * cm,
                         "Chaque évolution est couverte par des preuves E2E (dossier scripts/) ; le détail des gardes serveur figure dans l'annexe A.")
            return HAUT - MARGE_H - 1.45 * cm
        c.setFillColor(ACCENT)
        c.setFont("Serif-B", 11)
        c.drawString(MARGE_G, HAUT - MARGE_H, "Annexe B — Évolutions v0.2.83 à v0.2.95 (suite)")
        return HAUT - MARGE_H - 0.55 * cm

    pied(c)
    c.showPage()
    ETAT["annexe"] = "B"
    ETAT["page"] = 1
    y = entete_B(c, False)

    y = dessine_paragraphe(c, MARGE_G, y, LARGE_UTILE, B_INTRO, "Serif", 9.4, 11.0)
    y -= 0.35 * cm

    # tableau des évolutions : Version | Évolution | Rôles
    c_ver = 2.5 * cm
    c_roles = 3.9 * cm
    c_evol = LARGE_UTILE - c_ver - c_roles

    def dessiner_entete_evol():
        nonlocal y
        c.setFillColor(FOND_ENTETE)
        c.rect(MARGE_G, y - h_entete, LARGE_UTILE, h_entete, stroke=0, fill=1)
        c.setFillColor(colors.white)
        c.setFont("Serif-B", 9)
        c.drawString(MARGE_G + 6, y - h_entete + (h_entete - 9) / 2 + 1.5, "Version")
        c.drawString(MARGE_G + c_ver + 6, y - h_entete + (h_entete - 9) / 2 + 1.5, "Évolution (vérifiée dans le code livré v0.2.95)")
        c.drawString(MARGE_G + c_ver + c_evol + 6, y - h_entete + (h_entete - 9) / 2 + 1.5, "Rôles concernés")
        y -= h_entete

    dessiner_entete_evol()

    for ver, evo, roles in B_ROWS:
        l_v = lignes_texte(ver, c_ver - 12, "Serif-B", 8.8)
        l_e = lignes_texte(evo, c_evol - 12, "Serif", 8.8)
        l_r = lignes_texte(roles, c_roles - 12, "Serif-B", 8.2)
        nl = max(len(l_v), len(l_e), len(l_r))
        h = max(0.62 * cm, nl * 9.2 * 0.0353 * cm + 2 * pad)
        if y - h < MARGE_B:
            y = nouvelle_page(c, entete_B)
            dessiner_entete_evol()
        c.setFillColor(ENCRE)
        yy = y - pad - 7.5
        c.setFont("Serif-B", 8.8)
        for ln in l_v:
            c.drawString(MARGE_G + 6, yy, ln)
            yy -= 9.2
        yy = y - pad - 7.5
        c.setFont("Serif", 8.8)
        for ln in l_e:
            c.drawString(MARGE_G + c_ver + 6, yy, ln)
            yy -= 9.2
        c.setFillColor(GRIS)
        c.setFont("Serif-B", 8.2)
        yy = y - pad - 7.5
        for ln in l_r:
            c.drawString(MARGE_G + c_ver + c_evol + 6, yy, ln)
            yy -= 9.2
        c.setStrokeColor(LIGNE)
        c.setLineWidth(0.5)
        c.line(MARGE_G, y - h, MARGE_G + LARGE_UTILE, y - h)
        c.line(MARGE_G + c_ver, y - h, MARGE_G + c_ver, y)
        c.line(MARGE_G + c_ver + c_evol, y - h, MARGE_G + c_ver + c_evol, y)
        y -= h

    y -= 0.35 * cm
    c.setFillColor(FOND_NEUTRE)
    nl = len(lignes_texte(B_NOTE, LARGE_UTILE - 24, "Serif-I", 8.6))
    h_note = nl * 9.6 * 0.0353 * cm + 2 * pad
    if y - h_note < MARGE_B:
        y = nouvelle_page(c, entete_B)
    c.rect(MARGE_G, y - h_note, LARGE_UTILE, h_note, stroke=0, fill=1)
    dessine_paragraphe(c, MARGE_G + 12, y - pad - 7.2, LARGE_UTILE - 24, B_NOTE, "Serif-I", 8.6, 9.6)
    y -= h_note

    # ================= ANNEXE C ============================================
    def entete_C(c, continue_):
        if not continue_:
            c.setFillColor(ACCENT)
            c.setFont("Serif-B", 16)
            c.drawString(MARGE_G, HAUT - MARGE_H - 0.05 * cm, "Annexe C — Map de routage des e-mails des demandes")
            c.setFillColor(GRIS)
            c.setFont("Serif", 9.2)
            c.drawString(MARGE_G, HAUT - MARGE_H - 0.62 * cm,
                         "Configuration introduite en v0.2.94 (Task 197) — état du code v0.2.95, 27 septembre 2026.")
            c.drawString(MARGE_G, HAUT - MARGE_H - 0.97 * cm,
                         "Configuration par l'IT / le superadministrateur — panneau SMTP → « Routage des demandes administratives ».")
            return HAUT - MARGE_H - 1.45 * cm
        c.setFillColor(ACCENT)
        c.setFont("Serif-B", 11)
        c.drawString(MARGE_G, HAUT - MARGE_H, "Annexe C — Map de routage des e-mails (suite)")
        return HAUT - MARGE_H - 0.55 * cm

    pied(c)
    c.showPage()
    ETAT["annexe"] = "C"
    ETAT["page"] = 1
    y = entete_C(c, False)

    def titre_bloc_c(txt):
        nonlocal y
        t_h = 0.7 * cm
        if y - t_h < MARGE_B:
            y = nouvelle_page(c, entete_C)
        c.setFillColor(ACCENT)
        c.setFont("Serif-B", 12)
        c.drawString(MARGE_G, y - 0.45 * cm, txt)
        y -= t_h + 0.12 * cm

    def puces_c(items):
        nonlocal y
        for p in items:
            l = lignes_texte(p, LARGE_UTILE - 0.55 * cm)
            h = len(l) * pas_ligne * 0.0353 * cm + 2 * pad
            if y - h < MARGE_B:
                y = nouvelle_page(c, entete_C)
            c.setFillColor(ACCENT)
            c.setFont("Serif-B", 9.2)
            c.drawString(MARGE_G, y - pad - 7.5, "•")
            yy = y - pad - 7.5
            c.setFillColor(ENCRE)
            c.setFont("Serif", 9.2)
            for ln in lignes_texte(p, LARGE_UTILE - 0.55 * cm):
                c.drawString(MARGE_G + 0.55 * cm, yy, ln)
                yy -= pas_ligne
            y -= h

    def tableau_c(entetes, largeurs, rows, mono_col0=False, vert_derniere=False):
        nonlocal y
        def entete_t():
            nonlocal y
            c.setFillColor(FOND_ENTETE)
            c.rect(MARGE_G, y - h_entete, LARGE_UTILE, h_entete, stroke=0, fill=1)
            c.setFillColor(colors.white)
            c.setFont("Serif-B", 9)
            x = MARGE_G
            for t, w in zip(entetes, largeurs):
                c.drawString(x + 6, y - h_entete + (h_entete - 9) / 2 + 1.5, t)
                x += w
            y -= h_entete
        entete_t()
        for row in rows:
            colonnes = []
            for j, (v, w) in enumerate(zip(row, largeurs)):
                if j == 0 and mono_col0:
                    colonnes.append(lignes_texte(v, w - 12, "Mono", 8.4))
                else:
                    colonnes.append(lignes_texte(v, w - 12, "Serif-B" if j == 0 else "Serif", 8.8))
            nl = max(len(l) for l in colonnes)
            h = max(0.62 * cm, nl * 9.2 * 0.0353 * cm + 2 * pad)
            if y - h < MARGE_B:
                y = nouvelle_page(c, entete_C)
                entete_t()
            dern = len(largeurs) - 1
            for j, lns in enumerate(colonnes):
                x = MARGE_G + sum(largeurs[:j])
                if vert_derniere and j == dern:
                    c.setFillColor(VERT_OUI)
                    c.setFont("Serif-B", 8.8)
                    c.drawCentredString(x + largeurs[j] / 2, y - pad - 7.5, row[j])
                    continue
                yy = y - pad - 7.5
                if j == 0 and mono_col0:
                    c.setFillColor(ACCENT)
                    c.setFont("Mono", 8.4)
                elif j == 0:
                    c.setFillColor(ENCRE)
                    c.setFont("Serif-B", 8.8)
                else:
                    c.setFillColor(ENCRE)
                    c.setFont("Serif", 8.8)
                for ln in lns:
                    c.drawString(x + 6, yy, ln)
                    yy -= 9.2
            c.setStrokeColor(LIGNE)
            c.setLineWidth(0.5)
            xsep = MARGE_G
            for w in largeurs[:-1]:
                xsep += w
                c.line(xsep, y - h, xsep, y)
            c.line(MARGE_G, y - h, MARGE_G + LARGE_UTILE, y - h)
            y -= h

    y = dessine_paragraphe(c, MARGE_G, y, LARGE_UTILE, C_INTRO, "Serif", 9.4, 11.0)
    y -= 0.35 * cm

    titre_bloc_c("Routage par type de demande")
    tableau_c(["Type de demande", "Destinataire principal", "Copie automatique", "Confirmation"],
              [3.1 * cm, 6.6 * cm, 4.1 * cm, 3.2 * cm], C_TYPES, vert_derniere=True)
    y -= 0.35 * cm

    titre_bloc_c("Champs de configuration (model MailConfig)")
    tableau_c(["Champ", "Rôle dans le routage", "Introduit en"],
              [4.7 * cm, 9.3 * cm, 3.0 * cm], C_CHAMPS, mono_col0=True)
    y -= 0.35 * cm

    # équilibre les pages C-1 / C-2 : le bloc Mécanique commune démarre sur C-2
    # (sinon 3 puces isolées au sommet d'une page vide à 80 %)
    y = nouvelle_page(c, entete_C)
    titre_bloc_c("Mécanique commune")
    puces_c(C_MECANIQUE)

    pied(c)
    c.showPage()
    c.save()
    buf.seek(0)
    return buf


def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for bloc in iter(lambda: f.read(65536), b""):
            h.update(bloc)
    return h.hexdigest()


def main():
    assert os.path.exists(PDF_CIBLE), "README PDF introuvable : " + PDF_CIBLE
    assert os.path.exists(SAUVEGARDE), "Sauvegarde de l'édition condensée introuvable : " + SAUVEGARDE
    os.makedirs(os.path.dirname(PDF_DL), exist_ok=True)

    # ré-exécutable : on repart TOUJOURS de l'édition condensée d'origine
    shutil.copy2(SAUVEGARDE, PDF_CIBLE)
    base = PdfReader(PDF_CIBLE)
    nb_base = len(base.pages)
    print("Base restaurée : %d pages (édition condensée v0.2.65)." % nb_base)

    annexes = dessine_annexes()

    ecrivain = PdfWriter()
    for p in base.pages:
        ecrivain.add_page(p)
    annexe_reader = PdfReader(annexes)
    nb_annexe = len(annexe_reader.pages)
    for p in annexe_reader.pages:
        ecrivain.add_page(p)
    ecrivain.add_metadata({
        "/Title": "Auto-RH — README officiel (édition condensée + annexes A, B et C, état v0.2.95)",
        "/Author": "Auto-RH",
        "/Creator": "AutoRH",
        "/Subject": "Documentation technique Auto-RH — fiches de paie, portail employé, rôles et sécurité",
    })
    with open(PDF_CIBLE, "wb") as f:
        ecrivain.write(f)

    # ---- Vérification ------------------------------------------------------
    verif = PdfReader(PDF_CIBLE)
    nb_apres = len(verif.pages)
    assert nb_apres == nb_base + nb_annexe, "nombre de pages inattendu"
    texte_fin = "\n".join((verif.pages[i].extract_text() or "") for i in range(nb_base, nb_apres))
    attendus = ["Annexe A", "Matrice des droits des rôles", "v0.2.95", "SuperAdmin",
                "FONCTIONNALITE_NON_AUTORISEE_IT", "Onglets visibles", "Principes appliqués",
                "portail employé (port 4001)", "e-mail de l'employé",
                "Annexe B", "v0.2.83", "HMAC", "scope=reponse", "parrainage",
                "Send Mail", "Configuration des réponses",
                # Task 196 : canaris de colonnes (valeurs issues du code réel)
                "Booléen « configurée » seul", "Oui (consultation seule)",
                # Task 197 : canaris de la map de routage v0.2.94
                "Map de configuration des mails", "attestationTravailEmail",
                "demande-creation-copie-dediee", "/api/download-routage",
                # Task 198 : annexe C — map de routage des e-mails
                "Annexe C", "Routage par type de demande",
                "Destinataire principal", "Copie automatique",
                "Confirmation au demandeur", "attestationSalaireEmail",
                "congeEmail", "autorisationEmail", "parrainageEmail",
                "responsablesMap", "v0.2.94 (nouveau)", "mailEnvoyeA",
                "DESTINATAIRE_ABSENT", "test_v094_routage_emails", "model MailConfig"]
    manquants = [a for a in attendus if a not in texte_fin]
    assert not manquants, "texte manquant dans les annexes : %s" % manquants

    # ---- Copies de diffusion ----------------------------------------------
    shutil.copy2(PDF_CIBLE, PDF_DL)
    shutil.copy2(PDF_CIBLE, PDF_VERSIONNE)

    print("OK : %d pages -> %d pages (annexes : %d pages)" % (nb_base, nb_apres, nb_annexe))
    print("Extraction des annexes : tous les marqueurs présents (%d)." % len(attendus))
    for p in (PDF_CIBLE, PDF_DL, PDF_VERSIONNE):
        print("  %s — %d octets — md5 %s" % (p, os.path.getsize(p), md5(p)))


if __name__ == "__main__":
    main()
