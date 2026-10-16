#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 235 — v0.2.120 : README mis à jour avec la CHAÎNE DE SIGNATURE ÉLECTRONIQUE complète
(v0.2.113 → v0.2.120) : (1) API DE CERTIFICATION & SIGNATURE — signature cryptographique PAdES
des PDF par le serveur (mode LOCALE, certificat importé, moteur 100 % node : node:crypto + node-forge,
sans aucune dépendance à openssl) ou par une API externe (mode API_EXTERNE : URL distinctes
Test/Production, Bearer/API-Key/Basic, secret chiffré jamais renvoyé), registre des documents
signés, copies signées conservées et vérification d'intégrité ; (2) FICHES SIGNÉES À L'IMPORT +
PORTAIL — chaque fiche importée est signée automatiquement (cache par empreinte) et l'employé
télécharge depuis son portail SES fiches et réponses SIGNÉES ; (3) CACHET « SIGNATURE ÉLECTRO-
NIQUE » DU TAMPON — 4e élément alimenté EN DIRECT par le certificat du module (Signataire,
Organisation, Émetteur, validité, empreinte SHA-256), forme RECTANGLE ou ROND (cachet d'entre-
prise : organisation en arc supérieur, mention en arc inférieur, titulaire au centre), apposé
sur PDF/images/DOCX/XLSX et TOUJOURS couvert par la signature PAdES sur les mêmes octets — si
la signature échoue, le cachet est retiré (jamais un document cacheté non signé).
Édition précédente — Task 222 — v0.2.112 : IMPORT DES CERTIFICATS ÉLECTRONIQUES + CLÉS PRIVÉES ASSOCIÉES dans
la réponse aux demandes ET l'importation fiche de paie : certificat SEUL accepté quand la clé
privée est DÉJÀ DISPONIBLE dans le système (association VÉRIFIÉE par appariement cryptogra-
phique — la clé signe, la clé publique du certificat vérifie ; refus explicite si négatif) ;
certificat ACCOMPAGNÉ DE SA CLÉ PRIVÉE : coffre .p12/.pfx (clé incluse, mot de passe chiffré)
OU clé séparée .pem/.key/.der (PKCS#8/PKCS#1, claire ou chiffrée) ; PEM COMBINÉ (CERTIFICATE +
PRIVATE KEY) reconnu — clé extraite automatiquement ; formats .p12/.pfx pour un certificat avec
sa clé, .pem/.cer/.crt/.der/.p7b/… pour un certificat seul ; le DIALOGUE « Répondre avec un
document » porte son propre import de certificat, les panneaux Import et Configuration des
réponses gèrent la clé privée associée et l'état de disponibilité ; fichiers chiffrés au repos.
Édition précédente — Task 221 — v0.2.111 : (1) COMPTES RH / IT — EXPÉDITEUR = SERVICE INFORMATIQUE :
l'e-mail d'identification envoyé automatiquement au compte créé part DE L'ADRESSE DU
SERVICE INFORMATIQUE configurée dans le système (panneau SMTP → « E-mail du service
informatique ») : expéditeur affiché au destinataire, enveloppe SMTP et journal d'envoi,
repli historique (Mail From) si l'adresse IT est absente ; (2) IMPORT PKCS#12 (.p12/.
pfx) — MOT DE PASSE CORRECT ACCEPTÉ : correctif du lecteur de coffres (carte getBags()
cléée par l'OID — l'ancienne lecture par le nom « certBag » ne trouvait AUCUN certificat,
même avec le BON mot de passe, et l'import ne réussissait que par le repli openssl CLI
absent des postes Windows) — coffres modernes (AES-256/PBKDF2-SHA256) comme legacy
(PBE-SHA1-3DES) s'importent ; « mot de passe incorrect » n'apparaît que si un moteur le
refuse explicitement, un fichier corrompu produit une erreur de structure.
Édition précédente — Task 220 — v0.2.110 : (1) « ACCÈS PORTAIL » — PRÉNOM MODIFIABLE : la colonne
« Prénom » du tableau « Accès portail par mot de passe » porte son propre
crayon d'édition (même dialogue Nom + Prénom) ; la modification est
enregistrée sur l'accès (nom, prenom et nomPrenom — le nom complet lu par le
portail employé) et propagée dans toutes les fiches de paie du CIN ;
(2) « STATUT DES DEMANDES AVEC PIÈCE JOINTE » (congé / autorisation /
parrainage) : une réponse contenant explicitement « Acceptée » ou « Refusée »
pilote TOUJOURS le statut — filet de détection des décisions écrites EN BAS
de la réponse (sous la citation et la consigne) ou dans le SUJET (radicaux
explicites « accept… » / « refus… » : aucun faux positif depuis le bloc cité) ;
la pièce jointe reste importée, affichée et accessible EN PLUS du statut
(jamais « En attente » avec décision explicite) ; le dialogue « Répondre avec
un document » porte une décision explicite (Aucune / Acceptée / Refusée) —
sans décision, comportement historique conservé.
Édition précédente — Task 217 — v0.2.109 : ACCÈS PORTAIL — (1) CORRECTIF COLONNES : l'en-tête
« Matricule » (manquant depuis la v0.2.107 — 8 en-têtes pour 9 cellules, les
matricules s'affichaient sous « E-mail d'accès » et toutes les colonnes
suivantes étaient décalées d'un rang) est rétabli ENTRE « Prénom » et
« E-mail d'accès » : chaque valeur (matricule, e-mail d'accès, statut…)
retrouve SA colonne ; (2) NOM / PRÉNOM AUTOMATIQUES : le nom complet des
fiches de paie est DÉCOUPÉ à l'importation selon les règles de
l'utilisateur — premier mot = Nom, mots suivants = Prénom, composés
« Ben »/« Bel »/« Bou » conservés ensemble (« Saidani Mohamed Amine » →
Saidani / Mohamed Amine ; « Ben Hnid Mohamed » → Ben Hnid / Mohamed ;
« bou mnijel majdi » → bou mnijel / majdi) — colonnes remplies dans le
répertoire des employés, à la création de l'accès (pré-remplissage jamais
destructif : une correction du RH n'est jamais écrasée) et en repli
d'affichage des accès historiques ; la recherche du tableau porte aussi
sur le prénom.
Édition précédente — Task 216 — v0.2.108 : RÉPONSE AUX DEMANDES — (1) LIBELLÉS : la consigne
« VALIDATION PAR E-MAIL » des e-mails de création porte désormais
« Acceptée » / « Refusée » (accord féminin avec « demande »), texte et
HTML ; (2) DÉCISION PAR RÉPONSE E-MAIL POUR TOUS LES TYPES : « Acceptée »
ou « Refusée » — avec ou sans pièce jointe — met le statut à jour
automatiquement (traitePar « Responsable N+1 (e-mail) » ou
« Auto-RH (e-mail) »), la pièce jointe est importée, jointe à l'e-mail
de l'employé et disponible dans son portail ; (3) l'auteur de la décision
est nommé correctement dans les e-mails (« par votre responsable N+1 » /
« par le service RH ») et la copie au service RH n'est envoyée que lorsque
la décision vient du responsable N+1.
Édition précédente — Task 215 — v0.2.107 : AJOUT DU MATRICULE — le matricule extrait des fiches de
paie est utilisé dans tout le portail : colonne « Matricule » dans « Toutes les
fiches », « Accès portail » (MODIFIABLE comme le nom / prénom / e-mail, valeur
répercutée dans toutes les fiches du CIN, effacement = repli sur
l'auto-association) et « Demandes » (auto-associé au CIN de l'employé) ; la
ligne « Matricule » figure dans TOUS les e-mails des demandes (création au
service traitant, confirmation au demandeur, changement de statut,
notification du document-réponse) pour les 5 types de demandes.
Édition précédente — Task 215 — v0.2.107 : AJOUT DU MATRICULE — le matricule extrait des fiches de
paie est utilisé dans tout le portail : colonne « Matricule » dans « Toutes les
fiches », « Accès portail » (MODIFIABLE comme le nom / prénom / e-mail, valeur
répercutée dans toutes les fiches du CIN, effacement = repli sur
l'auto-association) et « Demandes » (auto-associé au CIN de l'employé) ; la
ligne « Matricule » figure dans TOUS les e-mails des demandes (création au
service traitant, confirmation au demandeur, changement de statut,
notification du document-réponse) pour les 5 types de demandes.
Édition précédente — Task 215 — v0.2.107 : AJOUT DU MATRICULE — le matricule extrait des fiches de
paie est utilisé dans tout le portail : colonne « Matricule » dans « Toutes les
fiches », « Accès portail » (MODIFIABLE comme le nom / prénom / e-mail, valeur
répercutée dans toutes les fiches du CIN, effacement = repli sur
l'auto-association) et « Demandes » (auto-associé au CIN de l'employé) ; la
ligne « Matricule » figure dans TOUS les e-mails des demandes (création au
service traitant, confirmation au demandeur, changement de statut,
notification du document-réponse) pour les 5 types de demandes.
Édition précédente — Task 214 — v0.2.106 : (1) E-MAIL AUTOMATIQUE DE CRÉATION DE COMPTE — la création
d'un compte RH ou IT par le superadministrateur envoie AUTOMATIQUEMENT au
nouvel utilisateur son identifiant, son mot de passe initial et l'adresse
d'accès (le changement de mot de passe à la première connexion, déjà
obligatoire, est rappelé dans l'e-mail) ; (2) ACCÈS PORTAIL — la colonne
« Nom et prénom » devient DEUX colonnes distinctes « Nom » / « Prénom »
(répercuté sur toutes les fiches du CIN, compatibilité nomPrenom conservée
pour le portail et le pré-remplissage des demandes) ; (3) RÉPONSE RH — le
document final (tamponné) est JOINT à la notification e-mail de l'employé,
pour TOUS les types de demandes, aussi bien par import direct que par la
réponse e-mail IMAP ; les copies RH/N+1 restent sans pièces jointes.
Édition précédente — Task 212 — v0.2.105 : (1) NOTIFICATIONS EMPLOYÉ SANS RÉPONSE — les e-mails
employés (confirmation, statut, document disponible, décision N+1) portent une
mention explicite « NE PAS répondre » ; (2) RENOMMAGE de l'application :
Auto-RH/Auto-RH → AutoRH (elle couvre les fiches de paie ET les demandes
administratives) — interfaces, e-mails, tampon, TOTP, métadonnées ; les
identifiants techniques (PAIESAGE1, sels, variables AUTO_RH_*) sont conservés.
SUPPORT DE FORMATION du service RH (scripts/creer_support_formation_rh.py,
13 pages, route publique /api/download-formation ajoutée au middleware et
documentée ici) ; le README passe en v0.2.104 — bandeau DIFFUSION porté de
quatre à cinq livrables publics.
Édition précédente : Task 210 (v0.2.103) — la section 4 détaille le CYCLE
COMPLET d'un PDF de fiche — nonce aléatoire unique par fichier à l'écriture,
en-tête PAIESAGE1, déchiffrement EN MÉMOIRE à la volée à la consultation,
détection de toute altération par le tag GCM (contenu altéré jamais servi),
compatibilité historique, idempotence, disjoncteur AUTO_RH_STORAGE_DISABLE,
défense en profondeur (0700/0600, aucune route HTTP de stockage, build sans
données). Task 209 (v0.2.102) — verrouillage storage/tampons 0700/0600,
.env hors git + rotation n°2 ; Task 208 (v0.2.101) — journal d'auth, clé
dédiée, en-têtes durcis.

Sorties : servicerh-readme-technique.pdf (racine), download/servicerh-readme-
technique.pdf, download/servicerh-readme-technique-v0.2.105.pdf (édition
versionnée servie en priorité par la route publique /api/download-readme).
Sauvegarde préalable de l'édition v0.2.103 : /tmp/my-project/ (idempotent).
"""

import hashlib
import io
import os
import shutil

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from pypdf import PdfReader, PdfWriter

RACINE = "/home/z/my-project"
PDF_CIBLE = os.path.join(RACINE, "servicerh-readme-technique.pdf")
PDF_DL = os.path.join(RACINE, "download", "servicerh-readme-technique.pdf")
PDF_VERSIONNE = os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.120.pdf")
SAUVEGARDE_PRECEDENTE = "/tmp/my-project/servicerh-readme-technique-v0.2.112-avant-v0.2.120.pdf"

# ---- Polices (mêmes familles que l'édition précédente) ----------------------
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

PAS_LIGNE = 10.6          # interligne corps (pt)
PAD = 0.14 * cm           # marge interne des lignes de tableau
PT_CM = 0.0353            # 1 pt en cm (approximation du projet, héritée)

PAGE = {"n": 1}           # compteur global de pages
PART = {"label": ""}      # libellé du pied de page courant


def espacer(texte):
    """Rend « README » sous la forme « R E A D M E » (bandeaux de couverture)."""
    return " ".join(list(texte.replace(" ", "  ")))


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


def dessine_paragraphe(c, x, y, largeur, texte, police="Serif", taille=9.2, pas=PAS_LIGNE):
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
    if PART["label"]:
        c.setFont("Serif", 8)
        c.setFillColor(GRIS)
        c.drawString(MARGE_G, MARGE_B - 0.45 * cm,
                     "AutoRH — Documentation technique et README officiel — " + PART["label"])
        c.drawRightString(LARG - MARGE_D, MARGE_B - 0.45 * cm, "page %d" % PAGE["n"])


def nouvelle_page(c):
    pied(c)
    c.showPage()
    PAGE["n"] += 1
    return HAUT - MARGE_H


# ---- Aides de mise en page du cœur (flux à curseur) -------------------------
def titre_section(c, y, txt):
    besoin = 2.6 * cm
    if y - besoin < MARGE_B + 1.0 * cm:
        y = nouvelle_page(c)
    y -= 0.30 * cm
    c.setFillColor(ACCENT)
    c.setFont("Serif-B", 14)
    c.drawString(MARGE_G, y - 0.50 * cm, txt)
    c.setStrokeColor(ACCENT)
    c.setLineWidth(1.1)
    c.line(MARGE_G, y - 0.74 * cm, MARGE_G + LARGE_UTILE, y - 0.74 * cm)
    return y - 1.12 * cm


def sous_titre(c, y, txt):
    h = 0.64 * cm
    if y - h - 1.2 * cm < MARGE_B:
        y = nouvelle_page(c)
    y -= 0.20 * cm
    c.setFillColor(ACCENT)
    c.setFont("Serif-B", 10.6)
    c.drawString(MARGE_G, y - 0.34 * cm, txt)
    return y - h


def para(c, y, txt, taille=9.2, pas=PAS_LIGNE, police="Serif", retrait=0.0):
    largeur = LARGE_UTILE - retrait
    lns = lignes_texte(txt, largeur, police, taille)
    h = len(lns) * pas * PT_CM * cm
    if y - h < MARGE_B:
        y = nouvelle_page(c)
    return dessine_paragraphe(c, MARGE_G + retrait, y, largeur, txt, police, taille, pas)


def puce(c, y, txt, taille=9.2, pas=PAS_LIGNE):
    largeur = LARGE_UTILE - 0.55 * cm
    lns = lignes_texte(txt, largeur, police_txt(taille), taille)
    h = len(lns) * pas * PT_CM * cm + 0.06 * cm
    if y - h < MARGE_B:
        y = nouvelle_page(c)
    c.setFillColor(ACCENT)
    c.setFont("Serif-B", taille)
    c.drawString(MARGE_G, y - taille + 1.2, "•")
    dessine_paragraphe(c, MARGE_G + 0.55 * cm, y, largeur, txt, "Serif", taille, pas)
    return y - h


def police_txt(taille):
    return "Serif"


def bloc_code(c, y, lignes_code, taille=8.2):
    pas = 9.8
    h = len(lignes_code) * pas * PT_CM * cm + 2 * PAD + 0.08 * cm
    if y - h < MARGE_B:
        y = nouvelle_page(c)
    c.setFillColor(FOND_NEUTRE)
    c.rect(MARGE_G, y - h, LARGE_UTILE, h, stroke=0, fill=1)
    c.setStrokeColor(LIGNE)
    c.setLineWidth(0.5)
    c.rect(MARGE_G, y - h, LARGE_UTILE, h, stroke=1, fill=0)
    yy = y - PAD - taille + 1.0
    c.setFillColor(ENCRE)
    c.setFont("Mono", taille)
    for ln in lignes_code:
        c.drawString(MARGE_G + 0.25 * cm, yy, ln)
        yy -= pas
    return y - h - 0.14 * cm


def caption(c, y, txt):
    lns = lignes_texte(txt, LARGE_UTILE, "Serif-I", 8.4)
    h = len(lns) * 9.8 * PT_CM * cm
    if y - h < MARGE_B:
        y = nouvelle_page(c)
    c.setFillColor(GRIS)
    c.setFont("Serif-I", 8.4)
    for ln in lns:
        c.drawString(MARGE_G, y - 8.4 + 1.0, ln)
        y -= 9.8
    return y - 0.10 * cm


def tableau(c, y, entetes, largeurs, rows, mono0=False, centre_dern=False,
            taille_corps=8.8, pas_corps=9.6):
    """Tableau générique : entête colorée répétée après saut de page.
    sum(largeurs) doit être ≤ LARGE_UTILE (vérifié)."""
    assert sum(largeurs) <= LARGE_UTILE + 0.5, "tableau plus large que la zone utile"
    h_entete = 0.72 * cm

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
            if j == 0 and mono0:
                colonnes.append(lignes_texte(v, w - 12, "Mono", 8.2))
            else:
                pol = "Serif-B" if j == 0 else "Serif"
                colonnes.append(lignes_texte(v, w - 12, pol, taille_corps))
        nl = max(len(l) for l in colonnes)
        h = max(0.60 * cm, nl * pas_corps * PT_CM * cm + 2 * PAD)
        if y - h < MARGE_B:
            y = nouvelle_page(c)
            entete_t()
        for j, lns in enumerate(colonnes):
            x = MARGE_G + sum(largeurs[:j])
            yy = y - PAD - taille_corps + 1.4
            if centre_dern and j == len(largeurs) - 1:
                c.setFillColor(VERT_OUI if row[j] == "Oui" else
                               (ROUGE_NON if row[j] == "Non" else GRIS))
                c.setFont("Serif-B", taille_corps)
                c.drawCentredString(x + largeurs[j] / 2, y - PAD - taille_corps + 1.4, row[j])
                continue
            if j == 0 and mono0:
                c.setFillColor(ACCENT)
                c.setFont("Mono", 8.2)
            elif j == 0:
                c.setFillColor(ENCRE)
                c.setFont("Serif-B", taille_corps)
            else:
                c.setFillColor(ENCRE)
                c.setFont("Serif", taille_corps)
            for ln in lns:
                c.drawString(x + 6, yy, ln)
                yy -= pas_corps
        c.setStrokeColor(LIGNE)
        c.setLineWidth(0.5)
        xsep = MARGE_G
        for w in largeurs[:-1]:
            xsep += w
            c.line(xsep, y - h, xsep, y)
        c.line(MARGE_G, y - h, MARGE_G + LARGE_UTILE, y - h)
        y -= h
    return y


# ==== ANNEXES (données) ======================================================

# ---- Annexe A : matrice (état du code vérifié v0.2.105, archive livrée) -----
# Valeurs dans l'ordre : SuperAdmin, RH, IT.
# Task 196 : colonnes RH/IT rétablies conformément au code réel — les groupes
# « Fiches de paie », « Tampon, signature et certificat », « Accès portail »
# et l'essentiel de « Demandes administratives » sont gardés par refusIT
# (RH admis, IT refusé 403) ; l'IT n'a l'avantage que sur le journal IMAP, le
# SMTP (consultation) et la liste des comptes (consultation). Task 206 :
# fin des nuances « Limité » — l'import de réponse et le téléchargement des
# documents de réponse sont refusés PROPREMENT côté serveur (Non).
GROUPES = [
    ("Fiches de paie", [
        ("Consultation — recherche par CIN, toutes les fiches, détail, fichier tamponné à la volée (original intact)", "Oui", "Oui", "Non"),
        ("Importer des fiches de paie (PDF Sage, détection d'anomalies de nom)", "Oui", "Oui", "Non"),
        ("Supprimer des fiches (unitaire et multiple)", "Oui", "Oui", "Non"),
        ("Maintenance — redétection du contenu, indexation de la base", "Oui", "Oui", "Non"),
        ("QR « Fiche en ligne » — page publique sous jeton HMAC : activation et configuration", "Oui", "Oui", "Non"),
    ]),
    ("Tampon, signature et certificat", [
        ("Configuration du tampon signature et QR des fiches (consultation, modification, aperçu)", "Oui", "Oui", "Non"),
        ("Import du certificat de signature — 10 formats (.p12, .pfx, .pem, .cer…), fichier chiffré sur disque", "Oui", "Oui", "Non"),
        ("Activation (interrupteur) et positionnement libre du certificat — glisser sur l'aperçu A4, poignée de redimensionnement, position exacte X/Y (mm), décalages ± 1500 pt, taille 50 → 300 %", "Oui", "Oui", "Non"),
        ("Aperçu A4 interactif — clic et glisser indépendants signature / QR / certificat, curseurs synchronisés", "Oui", "Oui", "Non"),
        ("Module « API de certification & signature électronique » — PAdES local ou API externe, environnements Test/Production, registre des documents signés", "Oui", "Oui", "Non"),
        ("Cachet « Signature électronique » du tampon — rectangle ou rond d'entreprise, alimenté par le certificat, couvert par la signature PAdES", "Oui", "Oui", "Non"),
    ]),
    ("Accès portail par mot de passe", [
        ("Créer / réinitialiser / activer-désactiver / débloquer / supprimer un accès", "Oui", "Oui", "Non"),
        ("QR code d'accès / réinitialisation du QR", "Oui", "Oui", "Non"),
        ("Envoyer le mot de passe initial par e-mail (adresse enregistrée sur le compte)", "Oui", "Oui", "Non"),
        ("Modifier « Nom » / « Prénom » — deux colonnes séparées (v0.2.106), répercuté sur toutes les fiches du CIN, compatibilité « Nom et prénom » conservée", "Oui", "Oui", "Non"),
("Consulter / modifier le « Matricule » de l'employé — auto-associé depuis ses fiches de paie, répercuté sur toutes les fiches du CIN (v0.2.107)", "Oui", "Oui", "Non"),
("Consulter / modifier le « Matricule » de l'employé — auto-associé depuis ses fiches de paie, répercuté sur toutes les fiches du CIN (v0.2.107)", "Oui", "Oui", "Non"),
("Consulter / modifier le « Matricule » de l'employé — auto-associé depuis ses fiches de paie, répercuté sur toutes les fiches du CIN (v0.2.107)", "Oui", "Oui", "Non"),
        ("Modifier l'e-mail de l'employé — champ chiffré, notifications de suivi et « Send Mail »", "Oui", "Oui", "Non"),
    ]),
    ("Demandes administratives", [
        ("Liste, détail, traitement (statut + commentaire + notification e-mail)", "Oui", "Oui", "Non"),
        ("Réponse avec document (import direct ; tampon automatique lu dans la config des réponses)", "Oui", "Oui", "Non"),
        ("Téléchargement des documents de réponse", "Oui", "Oui", "Non"),
        ("Journal d'envoi IMAP (outil de diagnostic de la réception automatique)", "Oui", "Non", "Oui"),
        ("QR « Réponse en ligne » — page publique sous jeton HMAC : activation et configuration", "Oui", "Oui", "Non"),
        ("Configuration DÉDIÉE du tampon des réponses ET de son certificat de signature (fichier, mot de passe chiffré, activation, positionnement) — panneau « Configuration des réponses »", "Oui", "Oui", "Non"),
    ]),
    ("Paramètres techniques — messagerie", [
        ("Consulter la configuration SMTP", "Oui", "Non", "Oui"),
        ("Modifier la configuration SMTP — dont le routage des demandes : 4 boîtes e-mail dédiées par type (détails en annexe B) — et tests d'envoi SMTP / IMAP (l'onglet « Paramètres » n'est exposé qu'au rôle IT)", "Oui", "Non", "Oui"),
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
    "Parrainage simplifié : plus aucun champ N+1 saisi — confirmation e-mail automatique envoyée au demandeur.",
    "Routage des e-mails des demandes : attestations → adresse dédiée (repli boîte RH), congé et autorisation de sortie → responsable N+1 principal + copie à l'adresse dédiée (repli boîte RH), parrainage → adresse dédiée ; accusé de réception automatique au demandeur pour les 5 types (détails en annexe B).",
    "Aucune fonction d'administration : verrouillage temporaire après échecs consécutifs, aucune API d'administration exposée.",
]

PRINCIPES = [
    "Toute restriction est DOUBLE : réponse 403 côté serveur (code FONCTIONNALITE_NON_AUTORISEE_IT pour le rôle IT) ET masquage de l'élément dans l'interface — jamais l'un sans l'autre.",
    "Aucune inscription libre : les comptes RH et IT sont créés exclusivement par le superadministrateur (onglet Utilisateurs).",
    "Mot de passe expiré (politique 15 jours, tous les comptes) : toute API de données répond 403 jusqu'au changement effectif ; tout changement ou réinitialisation révoque immédiatement TOUTES les sessions antérieures (jetons liés à la version du mot de passe).",
    "Le portail employé (CIN + mot de passe + code OTP) reste accessible aux employés indépendamment des trois rôles d'administration.",
    "Pages publiques limitativement énumérées : /login, /api/auth/*, téléchargement du README, des scripts, de la matrice des rôles et de la map de routage des e-mails, pages de vérification QR (fiche et réponse) sous jeton HMAC signé.",
    "Données sensibles chiffrées (AES-256-GCM) : fiches de paie, adresses e-mail, mots de passe (scrypt), certificat de signature stocké sur disque.",
]

# ---- Auto-contrôle (Task 196) : interdit toute ré-inversion RH/IT ---------
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

# ---- Annexe B : map de routage des e-mails des demandes --------------------
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
     "Boîte commune du service RH : repli des attestations et du parrainage sans adresse dédiée, copie des congés / autorisations sans adresse dédiée."),
    ("itEmail",
     "Notifications techniques éventuelles — aucun routage automatique actuel."),
    ("responsablesMap",
     "Table de repli des autorisations de sortie : DEPARTEMENT=email, ligne DEFAUT=email pour les départements sans règle."),
    ("parrainageEmail",
     "Destinataire PRINCIPAL du parrainage (routage exclusif)."),
    ("attestationTravailEmail",
     "Destinataire PRINCIPAL des attestations de travail."),
    ("attestationSalaireEmail",
     "Destinataire PRINCIPAL des attestations de salaire."),
    ("congeEmail",
     "Reçoit une COPIE de chaque demande de congé (le N+1 saisi reste principal)."),
    ("autorisationEmail",
     "Reçoit une COPIE de chaque autorisation de sortie (le N+1 saisi reste principal)."),
]

# (NOUVEAU v0.2.110 — Task 220) les DEUX nouveaux principes de mécanique,
# définis en variables pour une insertion lisible dans C_MECANIQUE :
PRINCIPE_PRENOM = (
    "Prénom modifiable dans l'Accès portail (v0.2.110) : la colonne « Prénom » du tableau "
    "« Accès portail par mot de passe » porte son propre crayon d'édition (même dialogue Nom + Prénom) ; "
    "la modification est enregistrée sur l'accès (nom, prenom et nomPrenom — le nom complet lu par le portail "
    "employé pour le pré-remplissage des demandes) et propagée dans toutes les fiches de paie du CIN."
)
PRINCIPE_STATUT = (
    "Statut des demandes avec pièce jointe (v0.2.110) : une réponse contenant explicitement « Acceptée » "
    "ou « Refusée » pilote toujours le statut, même écrite en bas de la réponse (sous la citation et la consigne "
    "« VALIDATION PAR E-MAIL ») ou dans le sujet — filet de détection explicite (« accept… » / « refus… ») sur "
    "l'ensemble du message, sans faux positif depuis le bloc cité ; la pièce jointe reste importée, affichée et "
    "accessible EN PLUS du statut (jamais « En attente » avec décision explicite) ; le dialogue « Répondre avec un "
    "document » de l'administration porte une décision explicite (Aucune / Acceptée / Refusée) — sans décision, "
    "comportement historique conservé (document seul = Acceptée si En attente ; un « Refusée » existant n'est "
    "jamais écrasé)."
)

# (NOUVEAU v0.2.110 — Task 220) les DEUX nouveaux principes de mécanique,
# définis en variables pour une insertion lisible dans C_MECANIQUE :
PRINCIPE_PRENOM = (
    "Prénom modifiable dans l'Accès portail (v0.2.110) : la colonne « Prénom » du tableau « Accès portail par mot de passe » porte son propre crayon d'édition (même dialogue Nom + Prénom) ; la modification est enregistrée sur l'accès (nom, prenom et nomPrenom — le nom complet lu par le portail employé pour le pré-remplissage des demandes) et propagée dans toutes les fiches de paie du CIN."
)
PRINCIPE_STATUT = (
    "Statut des demandes avec pièce jointe (v0.2.110) : une réponse contenant explicitement « Acceptée » ou « Refusée » pilote toujours le statut, même écrite en bas de la réponse (sous la citation et la consigne « VALIDATION PAR E-MAIL ») ou dans le sujet — filet de détection explicite (« accept… » / « refus… ») sur l'ensemble du message, sans faux positif depuis le bloc cité ; la pièce jointe reste importée, affichée et accessible EN PLUS du statut (jamais « En attente » avec décision explicite) ; le dialogue « Répondre avec un document » de l'administration porte une décision explicite (Aucune / Acceptée / Refusée) — sans décision, comportement historique conservé (document seul = Acceptée si En attente ; un « Refusée » existant n'est jamais écrasé)."
)

# (NOUVEAU v0.2.111 — Task 221) les DEUX nouveaux principes de mécanique,
# définis en variables pour une insertion lisible dans C_MECANIQUE :
PRINCIPE_EXPEDITEUR = (
    "Comptes RH/IT : e-mail de création expédié par le service informatique (v0.2.111) : quand le superadministrateur crée un compte RH ou IT, l'e-mail d'identification (identifiant, mot de passe initial, adresse d'accès, changement obligatoire à la première connexion) part DE L'ADRESSE DU SERVICE INFORMATIQUE configurée dans le système (panneau SMTP → « E-mail du service informatique ») : expéditeur affiché au destinataire, enveloppe SMTP et journal d'envoi ; repli sur le Mail From historique si l'adresse IT est absente."
)
PRINCIPE_PKCS12 = (
    "Import PKCS#12 (.p12/.pfx) : mot de passe correct accepté (v0.2.111) : correction du lecteur de coffres (la carte renvoyée par getBags() est cléée par l'OID — l'ancienne lecture par le nom « certBag » ne trouvait AUCUN certificat, même avec le BON mot de passe, et l'import ne réussissait que via le repli openssl, absent des postes Windows) : les coffres modernes (AES-256/PBKDF2-SHA256, défaut OpenSSL 3) comme les legacy (PBE-SHA1-3DES) s'importent dans l'interface ; l'erreur « mot de passe incorrect » n'est affichée que lorsqu'un moteur (forge ou openssl) refuse explicitement le mot de passe — un fichier corrompu produit une erreur de STRUCTURE ; .p12, .pfx et formats .p7b/.p7c/.p7s/.p7m/.cer/.crt/.der/.pem/.xml/.ps7x reconnus."
)

# (NOUVEAU v0.2.112 — Task 222) les DEUX nouveaux principes de mécanique,
# définis en variables pour une insertion lisible dans C_MECANIQUE :
PRINCIPE_CERT_CLE = (
    "Certificats électroniques + clés privées associées (v0.2.112) : un certificat peut être importé SEUL lorsque la clé privée est déjà disponible dans le système — l'association est VÉRIFIÉE par appariement cryptographique (la clé signe, la clé publique du certificat vérifie) et un appariement négatif produit une erreur explicite (jamais d'association aveugle) ; un certificat peut être importé AVEC sa clé privée — coffre .p12/.pfx (clé incluse, mot de passe chiffré) ou fichier de clé séparé .pem/.key/.der (PKCS#8/PKCS#1, clair ou chiffré) ; un PEM combiné (certificat + clé dans le même fichier) est reconnu et la clé est extraite automatiquement ; fichiers de clé chiffrés au repos (AES-256-GCM) et mots de passe chiffrés en base, jamais renvoyés à l'interface."
)
PRINCIPE_CERT_INTERFACES = (
    "Import des certificats dans la réponse aux demandes et l'importation des fiches (v0.2.112) : le dialogue « Répondre avec un document » de l'onglet Demandes porte son PROPRE import de certificat électronique (certificat + clé privée au besoin, état de disponibilité affiché), le panneau « Signature électronique & QR code » de l'onglet Importation et le panneau « Configuration des réponses » acceptent la CLÉ PRIVÉE ASSOCIÉE (.pem/.key/.der) en plus du certificat — les fichiers sont stockés chiffrés, retirés avec le certificat, et l'état « clé privée disponible dans le système » est calculé par l'API."
)

# (NOUVEAU v0.2.120 — Task 235) les QUATRE principes de la chaîne de signature
# électronique, définis en variables pour une insertion lisible dans C_MECANIQUE :
PRINCIPE_ANNEXE_CONNEXION = (
    "Page de connexion resserrée (v0.2.113) : le bloc « Téléchargements directs » (archive zip, README, formation, matrice des rôles, map de routage) a été RETIRÉ de la page de connexion du portail d'administration — les cinq livrables restent téléchargeables publiquement via leurs routes /api/download-* (URL directes, sans connexion)."
)
PRINCIPE_API_CERT_SIG = (
    "API de certification & signature électronique (v0.2.114 → v0.2.117) : signature cryptographique PAdES des documents PDF directement par le serveur — mode LOCALE (certificat importé .p12/.pfx ou certificat + clé privée, moteur 100 % node : node:crypto et node-forge, PKCS#7/CMS, sans aucune dépendance à openssl absent des postes Windows) ou mode API_EXTERNE (service REST de signature : URL distinctes Test/Production, authentification Bearer/API-Key/Basic, secret chiffré AES-256-GCM et jamais renvoyé à l'interface) ; fiches de paie signées AUTOMATIQUEMENT à l'import (cache par empreinte) et réponses aux demandes signées AVANT envoi ; environnement Test/Production affiché en badge et tracé dans le journal ; registre des documents signés, copies signées conservées et vérification d'intégrité à la demande."
)
PRINCIPE_SIGNE_EMPLOYE = (
    "Documents signés côté employé (v0.2.116 → v0.2.118) : la fiche servie au portail est la COPIE SIGNÉE conservée par le registre — l'employé télécharge depuis son espace SES fiches de paie et les réponses à ses demandes avec leur signature PAdES ; si la signature est indisponible, l'original intact est servi (le document reste signable plus tard) ; aucune clé ni secret n'est exposé au portail."
)
PRINCIPE_CACHET_ELEC = (
    "Cachet « SIGNATURE ÉLECTRONIQUE » du tampon (v0.2.119 → v0.2.120) : 4e élément du tampon alimenté EN DIRECT par le certificat du module (Signataire = CN, Organisation, Émetteur, validité, empreinte SHA-256 — jamais stocké en base), forme RECTANGLE ou ROND de type cachet d'entreprise (deux cercles concentriques, organisation en arc supérieur, mention « SIGNATURE ÉLECTRONIQUE » en arc inférieur, titulaire en gras au centre, validité et empreinte), apposé sur PDF, images, Word et Excel avec position/taille/décalages propres aux périmètres Import et Demandes/Réponses ; GARANTIE : le cachet n'est apposé QUE si la signature PAdES réussit sur les mêmes octets — en cas d'échec le cachet est retiré (jamais un document cacheté non signé) ; aperçu A4 interactif avec bloc d'exemple tant que le certificat n'est pas chargé."
)

C_MECANIQUE = [
    "Envoi en arrière-plan : la création d'une demande répond 201 immédiatement ; les e-mails partent ensuite, JAMAIS bloquants. Sans destinataire résolu, rien n'est envoyé, l'échec est journalisé (DESTINATAIRE_ABSENT) et la demande reste traitable dans l'onglet « Demandes ».",
    "Repli RH systématique : aucune adresse dédiée n'est obligatoire — un champ laissé vide retombe sur la boîte RH (comportement historique conservé), aucune demande ne peut être perdue.",
    "Anti-doublon : la copie dédiée n'est jamais envoyée lorsque son adresse est identique au destinataire principal.",
    "Confirmation au demandeur (les 5 types) : récapitulatif et référence envoyés à l'adresse de notification de l'employé (PortalAccess.email, chiffré ; repli mailEnvoyeA — dernière adresse utilisée pour l'envoi du mot de passe initial) — e-mail automatique « NE PAS répondre » (v0.2.105).",
    "Notifications employé SANS réponse (v0.2.105) : TOUS les e-mails destinés à l'EMPLOYÉ (confirmation d'enregistrement, changement de statut, document disponible, décision du responsable N+1) sont des NOTIFICATIONS PURES — mention explicite « NE PAS répondre à cet e-mail », renvoi à la rubrique « Mes demandes » du portail employé et invitation à contacter le service RH pour toute question ; aucune réponse envoyée à l'adresse d'expédition n'est lue. La réponse par e-mail reste réservée au responsable / service RH (reconnue par IMAP).",
    "Journal d'envoi (logs/journal-emails.log, consultable IT / SuperAdmin — onglet Demandes) : demande-creation, demande-creation-copie-rh, demande-creation-copie-dediee, demande-creation-confirmation-demandeur, compte-cree (v0.2.106).",
    "E-mail automatique de création de compte (v0.2.106) : la création d'un compte RH ou IT par le superadministrateur envoie AUTOMATIQUEMENT au nouvel utilisateur son identifiant (l'adresse du compte), son mot de passe initial et l'adresse d'accès au site d'administration, avec le rappel du changement de mot de passe OBLIGATOIRE à la première connexion (envoi journalisé « compte-cree », jamais bloquant — en cas d'échec SMTP, l'interface invite à communiquer les identifiants manuellement).",
    "Pièces jointes aux notifications employé (v0.2.106) : le document final tamponné répondant à la demande est JOINT à l'e-mail de l'employé pour TOUS les types (attestation de travail, attestation de salaire, congé, autorisation de sortie, parrainage), par import direct comme par réponse e-mail IMAP ; les copies envoyées au responsable / service RH restent SANS pièces jointes (ils possèdent déjà le document).",
    "Décision par réponse e-mail (v0.2.108) : la consigne « VALIDATION PAR E-MAIL » porte désormais « Acceptée » / « Refusée » (accord féminin avec « demande ») ; la décision par réponse e-mail s'applique à TOUS les types de demandes — « Acceptée » ou « Refusée », avec ou sans pièce jointe : statut mis à jour automatiquement (traitePar « Responsable N+1 (e-mail) » ou « Auto-RH (e-mail) »), pièce jointe importée puis jointe à l'e-mail de l'employé et disponible dans son portail ; l'auteur est nommé correctement dans les e-mails et la copie au service RH n'est envoyée que lorsque la décision vient du responsable N+1.",
    "Accès portail par mot de passe (v0.2.109) : la colonne « Matricule » dispose de son propre en-tête (correctif : les valeurs ne s'affichent plus sous « E-mail d'accès » — 9 en-têtes pour 9 colonnes) ; les colonnes « Nom » / « Prénom » sont remplies AUTOMATIQUEMENT depuis les fiches de paie à l'importation — premier mot = Nom, mots suivants = Prénom, composés « Ben »/« Bel »/« Bou » conservés ensemble (ex. « Saidani Mohamed Amine » → Nom « Saidani » / Prénom « Mohamed Amine » ; « Ben Hnid Mohamed » → « Ben Hnid » / « Mohamed » ; « bou mnijel majdi » → « bou mnijel » / « majdi ») — dans le répertoire des employés, à la création de l'accès (pré-remplissage jamais destructif : une correction du RH au crayon n'est jamais écrasée) et en repli d'affichage des accès historiques ; la recherche du tableau porte aussi sur le prénom.",
    PRINCIPE_PRENOM,
    PRINCIPE_STATUT,
    PRINCIPE_EXPEDITEUR,
    PRINCIPE_PKCS12,
    PRINCIPE_CERT_CLE,
    PRINCIPE_CERT_INTERFACES,
    PRINCIPE_ANNEXE_CONNEXION,
    PRINCIPE_API_CERT_SIG,
    PRINCIPE_SIGNE_EMPLOYE,
    PRINCIPE_CACHET_ELEC,
    "Matricule employé dans les demandes (v0.2.107) : le matricule extrait des fiches de paie accompagne chaque demande — colonnes « Matricule » dans « Toutes les fiches », « Accès portail » et « Demandes » (valeur manuelle de l'accès prioritaire, sinon fiche la plus récente du CIN) et ligne « Matricule » dans TOUS les e-mails du circuit (création au service traitant, confirmation au demandeur, changement de statut, notification du document).",
    "Réponses par e-mail : le Message-ID de l'envoi principal est mémorisé — la réponse du responsable est reconnue par IMAP (In-Reply-To / References) même si le sujet est modifié ; le document reçu est chiffré, associé à la demande et tamponné selon la configuration dédiée des réponses.",
    "Référence : classeur « AutoRH-Map-routage-emails-demandes-v0.2.112.xlsx » téléchargeable via /api/download-routage.",
]

PIEDS = {
    "A": "Annexe A : matrice des droits des rôles (état du code v0.2.120)",
    "B": "Annexe B : map de routage des e-mails des demandes (v0.2.112)",
}

# ==== COUVERTURE ET CŒUR =====================================================

SOMMAIRE = [
    "1. Présentation et architecture — deux services, deux ports, technologies, structure du projet",
    "2. Fonctionnalités — import, extraction, portail, comptes, e-mails, demandes, signature",
    "3. Installation et démarrage — prérequis, lanceurs, réseau local, secrets",
    "4. Sécurité — mesures, chiffrement AES-256-GCM, procédure pas à pas, rotation de clé",
    "5. Capacité, matériel et durée de vie — mesures à 240 000 fiches, projection sur 20 ans",
    "6. Exploitation et dépannage — commandes, routine, remèdes vérifiés",
    "7. Recommandations",
    "Annexe A — Matrice des droits des rôles (SuperAdmin, RH, IT ; portail employé)",
    "Annexe B — Map de routage des e-mails des demandes (5 types, 8 champs)",
]


def dessine_couverture(c):
    PART["label"] = ""  # pas de pied de page sur la couverture
    FOND_CHAUD = colors.HexColor("#f6fef9")  # palette logo (conservée après renommage AutoRH)
    c.setFillColor(FOND_CHAUD)
    c.rect(0, 0, LARG, HAUT, stroke=0, fill=1)
    c.setFillColor(ACCENT)
    c.rect(0, HAUT - 0.55 * cm, LARG, 0.55 * cm, stroke=0, fill=1)
    c.rect(0, 0, LARG, 0.55 * cm, stroke=0, fill=1)
    bande = espacer("README OFFICIEL · ÉDITION RESSERRÉE · V0.2.120")
    y = HAUT
    c.setFillColor(ACCENT)
    c.setFont("Serif-B", 9.6)
    c.drawCentredString(LARG / 2, y - 2.1 * cm, bande)
    c.setStrokeColor(ACCENT)
    c.setLineWidth(1.2)
    c.line(MARGE_G, y - 2.55 * cm, LARG - MARGE_D, y - 2.55 * cm)

    c.setFillColor(ENCRE)
    c.setFont("Serif-B", 40)
    c.drawCentredString(LARG / 2, y - 4.7 * cm, "AutoRH")
    c.setFillColor(GRIS)
    c.setFont("Serif", 14)
    c.drawCentredString(LARG / 2, y - 5.9 * cm, "Fiches de paie, demandes administratives et documents RH")

    y = y - 7.0 * cm
    desc = ("Documentation technique resserrée à l'essentiel, fondée sur le code livré v0.2.120 : "
            "architecture à deux services (ports 4000 et 4001), fonctionnalités, installation, sécurité "
            "outillée, capacité mesurée à 240 000 fiches (20 ans), exploitation. Renommée « AutoRH » "
            "(anciennement Auto-RH), l'application couvre les fiches de paie ET les demandes "
            "administratives : notifications employé sans réponse joignant le document-réponse, matricule "
            "extrait des fiches dans les demandes, décisions « Acceptée » / « Refusée » par interface ou "
            "e-mail, « Nom » / « Prénom » remplis depuis les fiches et Prénom modifiable, comptes RH/IT "
            "notifiés par le service informatique, certificats et clés privées importés partout "
            "(.p12/.pfx, clé séparée, PEM combiné). La signature cryptographique PAdES est intégrée au "
            "serveur : module « API de certification & signature » (certificat local sans openssl ou API "
            "externe, Test/Production), fiches signées automatiquement à l'import, réponses signées avant "
            "envoi, documents signés téléchargeables par l'employé, cachet « SIGNATURE ÉLECTRONIQUE » du "
            "tampon — rectangle ou rond d'entreprise — alimenté par le certificat et toujours couvert par "
            "la signature (v0.2.105 → v0.2.120). Annexes : matrice des droits et map de routage des "
            "e-mails des demandes.")
    y = dessine_paragraphe(c, MARGE_G + 0.8 * cm, y, LARGE_UTILE - 1.6 * cm, desc, "Serif", 10.2, 13.2)

    y -= 0.42 * cm
    c.setFillColor(ACCENT)
    c.setFont("Serif-B", 10.2)
    tags = "Administration 4000  ·  Portail 4001  ·  CIN 8 chiffres  ·  AES-256-GCM  ·  240 000 fiches · 20 ans"
    c.drawCentredString(LARG / 2, y, tags)
    y -= 0.62 * cm
    c.setStrokeColor(LIGNE)
    c.setLineWidth(0.7)
    c.line(MARGE_G + 0.8 * cm, y, LARG - MARGE_D - 0.8 * cm, y)

    y -= 0.85 * cm
    c.setFillColor(ACCENT)
    c.setFont("Serif-B", 13)
    c.drawString(MARGE_G + 0.8 * cm, y, "Sommaire")
    y -= 0.55 * cm
    for entree in SOMMAIRE:
        c.setFillColor(ENCRE)
        c.setFont("Serif", 9.8)
        c.drawString(MARGE_G + 1.15 * cm, y, entree)
        y -= 0.52 * cm

    y -= 0.45 * cm
    c.setStrokeColor(LIGNE)
    c.setLineWidth(0.7)
    c.line(MARGE_G + 0.8 * cm, y, LARG - MARGE_D - 0.8 * cm, y)

    y -= 0.75 * cm
    c.setFillColor(GRIS)
    c.setFont("Serif-B", 8.4)
    c.drawString(MARGE_G + 0.8 * cm, y, espacer("DIFFUSION"))
    y -= 0.52 * cm
    diffusion = ("Les cinq livrables sont téléchargeables sans connexion depuis l'administration : "
                 "/api/download-readme (présent README), /api/download-formation (support de formation "
                 "du service RH), /api/download-scripts (archive du code), /api/download-matrice (matrice "
                 "des rôles Excel), /api/download-routage (map de routage des e-mails).")
    y = dessine_paragraphe(c, MARGE_G + 0.8 * cm, y, LARGE_UTILE - 1.6 * cm, diffusion, "Serif", 9.2, 11.4)

    y -= 0.55 * cm
    c.setFillColor(GRIS)
    c.setFont("Serif-B", 8.4)
    c.drawString(MARGE_G + 0.8 * cm, y, espacer("SOURCES"))
    y -= 0.52 * cm
    sources = ("Code source livré v0.2.120 · Support de formation RH (servicerh-support-formation-rh.pdf) · "
               "README-DEPLOIEMENT-LOCAL.md (guide d'installation illustré) · "
               "notes LIRE-MOI-CORRECTIF-*.txt (détail de chaque livraison).")
    y = dessine_paragraphe(c, MARGE_G + 0.8 * cm, y, LARGE_UTILE - 1.6 * cm, sources, "Serif", 9.2, 11.4)

    y -= 0.55 * cm
    c.setFillColor(GRIS)
    c.setFont("Serif-B", 8.4)
    c.drawString(MARGE_G + 0.8 * cm, y, espacer("DATE D'ÉDITION"))
    y -= 0.52 * cm
    date_txt = "30 septembre 2026 — maintenue à jour au fil des livraisons (recommandation R21)."
    dessine_paragraphe(c, MARGE_G + 0.8 * cm, y, LARGE_UTILE - 1.6 * cm, date_txt, "Serif", 9.2, 11.4)

    c.setStrokeColor(ACCENT)
    c.setLineWidth(1.2)
    c.line(MARGE_G, MARGE_B + 0.55 * cm, LARG - MARGE_D, MARGE_B + 0.55 * cm)
    c.setFillColor(ACCENT)
    c.setFont("Serif-B", 8.6)
    c.drawCentredString(LARG / 2, MARGE_B + 0.05 * cm, espacer("FICHES DE PAIE ET DEMANDES ADMINISTRATIVES · FR"))
    c.showPage()
    PAGE["n"] += 1


def dessine_coeur(c):
    PART["label"] = "édition resserrée v0.2.120"

    # ---------------- 1. PRÉSENTATION ET ARCHITECTURE ----------------------
    y = HAUT - MARGE_H
    y = titre_section(c, y, "1. Présentation et architecture")
    y = para(c, y,
             "AutoRH (anciennement Auto-RH) est une application web de gestion des services RH destinée à un "
             "service RH assisté par l'informatique : fiches de paie ET demandes administratives. Le service RH importe en masse les bulletins produits par "
             "Sage (PDF, images, archives ZIP, classeurs Excel, documents Word) ; l'application détecte "
             "automatiquement le CIN, le nom de l'employé, la période, le net à payer et le matricule dans le "
             "contenu des documents, puis indexe chaque fiche dans une base SQLite. Chaque employé consulte "
             "ensuite ses propres fiches et suit ses demandes (congés, autorisations, attestations, parrainage) "
             "via un portail sécurisé par CIN, mot de passe et code OTP. Deux "
             "services cohabitent sur la même machine et partagent la base et le stockage chiffré :")
    y = tableau(c, y,
                ["Service", "Port et surcharge", "Rôle"],
                [3.4 * cm, 4.6 * cm, 9.0 * cm],
                [("Administration (RH, IT, SuperAdmin)", "4000 — PORT ou AUTO_RH_PORT_ADMIN",
                  "Serveur Next.js standalone : import, recherche paginée, gestion des fiches, comptes, configuration SMTP (scripts/start-prod.js)."),
                 ("Portail employés", "4001 — PORTAL_PORT ou AUTO_RH_PORT_PORTAIL",
                  "Serveur Node HTTP natif (scripts/portail-server.js) : consultation après CIN + mot de passe + code OTP, fiches du CIN de session uniquement.")])
    y = caption(c, y, "Tableau 1.1 — Les deux services livrés. Écoute 0.0.0.0 : ouvrir 4000 et 4001 en TCP dans le pare-feu ; les deux services partagent db/custom.db et storage/payslips.")
    y = para(c, y,
             "Le stockage est doublement chiffré : les champs sensibles de la base le sont en AES-256-GCM par un "
             "middleware Prisma (src/lib/db-crypto.ts) et chaque fichier de fiche l'est sur disque "
             "(src/lib/storage-crypto.ts, en-tête PAIESAGE1) — tampons importés et documents des demandes "
             "compris. Conséquence opérationnelle majeure : la perte du fichier .env (clés AUTH_SECRET et "
             "AUTO_RH_STORAGE_KEY) rend les fiches mathématiquement irrécupérables — .env doit donc être "
             "sauvegardé avec les données (sections 3, 4 et 6).", retrait=0.0)
    y = sous_titre(c, y, "Technologies")
    y = tableau(c, y,
                ["Composant", "Rôle dans AutoRH"],
                [6.6 * cm, 10.4 * cm],
                [("Next.js / React (build standalone, App Router)", "Framework de l'administration : import, recherche paginée, gestion des fiches, comptes, configuration SMTP."),
                 ("Prisma + SQLite (db/custom.db)", "Base de données embarquée — aucune autre base à installer."),
                 ("Tailwind CSS 4 + shadcn/ui", "Interface responsive mobile (thème blanc + vert : boutons vert émeraude #10b981, fond blanc cassé vert #f6fef9)."),
                 ("tesseract.js + sharp", "OCR des fiches peu textuelles (modèle français local)."),
                 ("pdf-parse, pdf-lib, mammoth, exceljs, xlsx, jszip", "Extraction PDF, Word, Excel et archives ZIP ; découpage des fichiers multi-fiches."),
                 ("nodemailer, qrcode", "Envoi SMTP (accès portail, demandes administratives) et QR codes TOTP.")])
    y = caption(c, y, "Tableau 1.2 — Technologies embarquées (versions exactes fixées par package-lock.json ; conteneurisation Docker node:20-slim en option).")
    y = sous_titre(c, y, "Structure du projet")
    y = para(c, y,
             "L'archive ne contient ni node_modules (npm install obligatoire à la première mise en service) ni "
             "les dossiers d'exécution (db, storage, logs, backups), créés au premier démarrage. Le guide "
             "pas-à-pas illustré est README-DEPLOIEMENT-LOCAL.md, à la racine de l'archive ; chaque correctif "
             "livré est documenté dans une note LIRE-MOI-CORRECTIF-*.txt embarquée.")
    y = bloc_code(c, y, [
        "auto-rh/",
        "+-- package.json / next.config.ts / Dockerfile / docker-compose.yml / lanceurs",
        "+-- README-DEPLOIEMENT-LOCAL.md ; servicerh-readme-technique.pdf",
        "+-- prisma/schema.prisma   # Payslip (+cinIndex/nomIndex), PayslipCinToken,",
        "|                          # User, ImportLog, PortalAccess, MailConfig,",
        "|                          # DemandeAdministrative, SignatureConfig,",
        "|                          # SignatureConfigReponse",
        "+-- src/ : middleware.ts (protection globale) ; app/api/ (auth, payslips,",
        "|         portal-access, mail-config, demandes, signature-config, users,",
        "|         stats) ; lib/ (auth, db-crypto, storage-crypto, payslip-extractor,",
        "|         payslip-index, payslip-ocr, splitters PDF/Excel/Word, mailer, stamp)",
        "+-- scripts/ : start-prod.js, auto-rh.js, portail-server.js,",
        "|             sauvegarde-bd.js, chiffrer-base.js, chiffrer-storage.js,",
        "|             creer-superadmin.js",
        "# créés à l'exécution : db/custom.db | storage/ | logs/ | backups/",
    ])

    # ---------------- 2. FONCTIONNALITÉS -----------------------------------
    y = titre_section(c, y, "2. Fonctionnalités")
    y = para(c, y,
             "La liste ci-dessous recense les fonctionnalités vérifiables dans le code livré et décrit leur "
             "comportement tel qu'il se manifeste à l'écran et dans les API. L'installation est détaillée en "
             "section 3, l'exploitation quotidienne en section 6.")
    y = sous_titre(c, y, "Import multi-formats, extraction et découpage")
    y = puce(c, y,
             "Formats acceptés : PDF, PNG, JPG, ZIP, XLSX/XLSM/XLS, DOCX ; tout autre format est refusé avec "
             "message explicite. Envoi par lots de 5 fichiers légers, fichiers de plus de 20 Mo envoyés seuls ; "
             "limite de 500 Mo par fichier, erreur 413 explicite au-delà. Archives ZIP : profondeur 2, 300 "
             "entrées maximum, formats internes limités aux types acceptés. Journal d'import systématique : une "
             "ligne ImportLog par fichier traité, avec le taux de fiabilité des CIN du lot (section 5).")
    y = puce(c, y,
             "CIN tunisienne : exactement 8 chiffres isolés (garde anti numéro CNSS) ; la carte biométrique "
             "récente à 9 chiffres est également reconnue. La recherche exige le numéro COMPLET — séparateurs "
             "intérieurs et casse tolérés, jamais une partie. Détection par familles de motifs (libellé « CIN », "
             "ligne suivante, colonne de tableau, formats tunisien et marocain) avec exclusion des faux "
             "positifs ; nom, période (plus de 10 formats de dates), net à payer et matricule (garde anti "
             "« Matricule fiscal »).")
    y = puce(c, y,
             "OCR adaptatif : si le texte extrait est trop court, lecture page par page (Tesseract.js, modèle "
             "français local) puis seconde passe haute lisibilité si des champs manquent.")
    y = puce(c, y,
             "Découpage des fichiers multi-fiches : un PDF multi-bulletins (y compris scanné), un classeur Excel "
             "ou un document Word regroupant plusieurs employés est découpé en une fiche individuelle par "
             "employé, avec son CIN, son nom et sa période. Copies identiques (même bulletin en N exemplaires) "
             "séparées automatiquement ; les fichiers fusionnés importés par une ancienne version peuvent être "
             "retraités par les scripts scinder-* (section 6).")
    y = sous_titre(c, y, "Recherche à grande échelle et portail employés")
    y = puce(c, y,
             "Liste d'administration paginée côté serveur (100 fiches par page, plafond de l'API à 1 000) et "
             "recherche CIN par index SQL déterministe chiffré : parcours d'index, jamais de balayage complet de "
             "la base ; fluide à 240 000 fiches (mesures en section 5). Garde-fous : recherche refusée avec "
             "message clair tant que l'indexation initiale est incomplète ; CIN de moins de 6 caractères refusé "
             "sur une base volumineuse.")
    y = puce(c, y,
             "Portail employés : connexion par CIN + mot de passe + code TOTP — QR d'enrôlement affiché une "
             "seule fois à la première connexion, puis code à 6 chiffres demandé à chaque connexion. Liste de "
             "toutes les fiches du CIN de session, paginée ou illimitée (« Tout afficher ») ; chaque fiche "
             "s'ouvre ou se télécharge avec le tampon signature/QR éventuel. Demandes administratives et "
             "documents reçus accessibles depuis le portail ; aucune fiche d'un autre employé n'est accessible "
             "(contrôle côté serveur).")
    y = sous_titre(c, y, "Comptes, e-mails et demandes administratives")
    y = puce(c, y,
             "Quatre rôles appliqués côté serveur : SUPERADMIN (comptes, déverrouillages, périmètre complet), IT "
             "(SMTP, IMAP, comptes en consultation), RH (imports, fiches, demandes, tampon) et employé (portail "
             "restreint à son CIN) — matrice complète en annexe A. Les comptes RH et IT sont créés "
             "exclusivement par le superadministrateur ; leur création déclenche un E-MAIL AUTOMATIQUE au "
             "nouvel utilisateur (identifiant, mot de passe initial, adresse d'accès — v0.2.106) ; "
             "changement de mot de passe imposé à la première connexion puis à chaque expiration "
             "(15 jours) ; le RH n'a accès à AUCUN paramètre SMTP — "
             "consultation comme écriture refusées 403, v0.2.100 : plus aucun booléen « configurée », "
             "l'état du service n'est pas consultable pour ce rôle.")
    y = puce(c, y,
             "E-mails SMTP : panneau réservé aux rôles IT et SUPERADMIN — préréglage Gmail (port 465, mot de "
             "passe d'application de 16 caractères obligatoire) et serveur personnalisé (587 par défaut) ; "
             "sécurité déduite du port (465 = SSL/TLS direct, tout autre port = STARTTLS/plain). Identifiants "
             "chiffrés en base (le mot de passe n'est jamais renvoyé à l'interface) ; chaque tentative est "
             "journalisée dans logs/journal-emails.log avec la réponse SMTP brute.")
    y = puce(c, y,
             "Routage des demandes : une adresse e-mail DÉDIÉE par type de demande avec repli "
             "systématique sur la boîte RH et accusé de réception automatique au demandeur — map complète en "
             "annexe B. Réception des réponses du RH par IMAP, pièces jointes rattachées automatiquement à la "
             "demande.")
    y = puce(c, y,
             "Demandes administratives : cinq types créés depuis le portail (attestation de travail, attestation "
             "de salaire — adresse e-mail de l'employé obligatoire, congé, autorisation de sortie, parrainage), "
             "référence lisible unique (DEM-AAAA-NNNNN), le nom réel de l'employé (résolu depuis ses fiches) "
             "figure dans les e-mails. Suivi par l'employé (« Mes demandes » : En attente / Acceptée / Refusée / "
             "Information requise) et traitement par le RH ou le SuperAdmin (onglet « Demandes » : liste, "
             "compteurs, filtres, décision, demande d'information). Réponse par document : le RH répond à "
             "l'e-mail de la demande (réception IMAP) ou importe le document depuis le détail — document "
             "chiffré, tamponné, visible par l'employé dans « Mes documents » et désormais JOINT à la "
             "notification e-mail de l'employé, pour TOUS les types de demandes (v0.2.106 — "
             "pièce jointe du document final, en plus du stockage portail). Le matricule de l'employé — "
             "récupéré automatiquement depuis ses fiches de paie (valeur manuelle de l'accès prioritaire) — "
             "figure dans la liste « Demandes » et dans TOUS les e-mails du circuit (v0.2.107). La décision du traitant — responsable N+1 ou service RH, quel que soit le type — porte sur « Acceptée » ou « Refusée » : statut mis à jour automatiquement, pièce jointe éventuelle importée puis jointe à l'e-mail de l'employé et disponible dans son portail (v0.2.108). Dans « Accès portail par mot de passe », l'en-tête « Matricule » est rétabli ENTRE « Prénom » et « E-mail d'accès » — les valeurs ne s'affichent plus sous « E-mail d'accès » — et les colonnes « Nom » / « Prénom » sont remplies automatiquement depuis les fiches de paie : premier mot = Nom, mots suivants = Prénom, composés « Ben »/« Bel »/« Bou » conservés ensemble ; corrections au crayon jamais écrasées (v0.2.109). L'IT est refusé 403 côté serveur "
             "sur l'import de réponse avec document et le téléchargement des documents de réponse (v0.2.100 — "
             "refus propre, matrice à Non). Garde-fous : plafond de demandes "
             "ouvertes par employé (anti-spam), validation des champs, aucune donnée de demande en clair en base.")
    y = sous_titre(c, y, "Signature électronique, QR code et outils d'exploitation")
    y = puce(c, y,
             "Signature et QR : configuration dans la rubrique « Signature électronique & QR code » — image de "
             "cachet/signature (PNG/JPEG jusqu'à 8 Mo), ligne de texte, mention légale datée, QR à quatre modes "
             "de contenu (données de la fiche avec empreinte de contrôle HMAC, URL de vérification, image "
             "fournie, texte libre). Positionnement libre : décalages horizontal/vertical sur toute la feuille, "
             "largeur/taille de 40 à 1 200 points, rotation de 0° à 360° par élément, aperçu A4 interactif avec "
             "glisser-déposer. Tous les formats tamponnés : PDF (y compris pages pivotées), images, "
             "Word et Excel — administration comme portail, avec aperçu.")
    y = puce(c, y,
             "Le fichier stocké n'est jamais réécrit : le tampon est dessiné à la volée sur la copie servie ; en "
             "cas d'erreur de dessin, la fiche est servie sans tampon (jamais bloquant). Les images de tampon "
             "importées sont chiffrées sur le disque (storage/tampons, en-tête PAIESAGE1), comme les fiches. "
             "Configurations PROPRES pour l'Import et les Demandes/Réponses, chacune avec SON "
             "certificat de signature électronique DÉDIÉ (fichier multi-formats chiffré sur disque, "
             "mot de passe conservé chiffré par section, activation) et SON positionnement libre — "
             "glisser sur l'aperçu A4, poignée de redimensionnement, position exacte X/Y en mm, "
             "décalages fins, rubrique visible dès l'activation même avant l'import du fichier "
             "(v0.2.100) — une modification dans une section n'affecte jamais l'autre.")
    y = puce(c, y,
             "Signature cryptographique PAdES (v0.2.114 → v0.2.120) : module « API de certification & signature » "
             "— certificat du serveur (mode LOCALE, moteur 100 % node : aucune dépendance à openssl, absent des "
             "postes Windows) ou API externe de signature (mode API_EXTERNE : URL distinctes Test/Production, "
             "Bearer / API-Key / Basic, secret chiffré jamais renvoyé). Les fiches de paie sont signées "
             "AUTOMATIQUEMENT à l'import (cache par empreinte) et les réponses aux demandes AVANT envoi ; "
             "l'employé télécharge depuis son portail SES fiches et réponses SIGNÉES (copies signées conservées, "
             "registre consultable, vérification d'intégrité à la demande). Le tampon porte un cachet « SIGNATURE "
             "ÉLECTRONIQUE » — rectangle ou rond d'entreprise (arcs organisation / mention, titulaire au centre, "
             "validité et empreinte SHA-256) — alimenté EN DIRECT par le certificat du module et TOUJOURS couvert "
             "par la signature PAdES sur les mêmes octets : si la signature échoue, le cachet est retiré "
             "(jamais un document cacheté non signé).")
    y = puce(c, y,
             "Outils d'exploitation intégrés : chiffrement outillé chiffrer-base.js (base, idempotent, "
             "sauvegarde préalable automatique) et chiffrer-storage.js (fiches, documents des demandes, "
             "tampons) — procédure complète en section 4 ; sauvegarde de base chiffrée au format .pgb "
             "(AES-256-GCM, rotation de 10) avec options --liste, --restaurer (contrôle sha256), --garder N ; "
             "mode silencieux Windows (démarrage/arrêt/état sans fenêtre, PIDs dans logs/auto-rh-processus.json, "
             "démarrage automatique par raccourci du dossier Startup) ; sécurisation disque automatique à chaque "
             "démarrage — droits restrictifs sur .env, db, storage, logs, backups (scripts/securiser-auto.js).")

    # ---------------- 3. INSTALLATION ET DÉMARRAGE -------------------------
    y = titre_section(c, y, "3. Installation et démarrage")
    y = sous_titre(c, y, "Prérequis et commandes de base")
    y = puce(c, y,
             "Node.js 22 LTS recommandé (Node 20 est en fin de vie depuis avril 2026) ; npm inclus ; aucune "
             "autre base de données à installer (SQLite embarqué via Prisma). Connexion Internet nécessaire "
             "uniquement à la première installation (dépendances npm) ; l'application fonctionne ensuite "
             "entièrement hors ligne. Extraire l'archive servicerh-scripts-site-web.zip dans un dossier sans "
             "accents ni espaces (par exemple C:\\AutoRH). En cas d'erreur ERESOLVE au npm install : utiliser "
             "le package.json et package-lock.json livrés, supprimer node_modules et package-lock.json puis "
             "relancer (LIRE-MOI-FIX-INSTALL.txt).")
    y = bloc_code(c, y, [
        "npm install",
        "npx prisma generate && npx prisma db push",
        "npm run build",
        "npm run start                        # administration — port 4000",
        "node scripts/portail-server.js       # portail employés — port 4001",
    ])
    y = sous_titre(c, y, "Lanceurs et accès réseau")
    y = puce(c, y,
             "Windows (recommandé) : double-clic sur DEMARRER-SILENCIEUX-WINDOWS.vbs — préparation, raccourci de "
             "démarrage automatique, attente de l'état écrit dans logs/demarrage-etat.txt (jusqu'à 20 minutes au "
             "premier lancement, temps du build) puis ouverture de http://localhost:4000 ; arrêt par "
             "ARRETER-SILENCIEUX-WINDOWS.vbs. Linux/macOS : DEMARRER-LINUX-MAC.sh (administration), "
             "DEMARRER-PORTAIL-LINUX-MAC.sh (portail) ou DEMARRER-TOUT-LINUX-MAC.sh (les deux).")
    y = puce(c, y,
             "Docker (optionnel) : docker compose up --build démarre les deux services ; définir AUTH_SECRET et "
             "AUTO_RH_STORAGE_KEY dans le compose ou monter un .env restreint, sinon les sessions sont "
             "invalidées à chaque recréation du conteneur.")
    y = puce(c, y,
             "Accès depuis le réseau local : les deux serveurs écoutent sur 0.0.0.0 — accéder via "
             "http://192.168.x.x:4000 (administration) et :4001 (portail) ; IP du poste hébergeur : ipconfig "
             "(Windows) ou hostname -I (Linux). Si la page ne s'affiche pas depuis un autre poste : autoriser le "
             "trafic entrant TCP 4000 ET 4001 dans le pare-feu (sudo ufw allow 4000/tcp puis 4001/tcp). Demander "
             "à l'administrateur réseau un bail DHCP fixe pour que l'adresse du serveur ne change jamais.")
    y = sous_titre(c, y, "Secrets : fichier .env — mise en service et vérification")
    y = puce(c, y,
             "Trois valeurs clés : DATABASE_URL (chemin ABSOLU vers db/custom.db, exigé par Prisma), AUTH_SECRET "
             "(généré automatiquement au premier démarrage — signature des sessions et dérivation des clés) et "
             "AUTO_RH_STORAGE_KEY (clé de chiffrement du stockage). La perte de ces clés rend les fiches "
             "irrécupérables : sauvegarder .env avec les données, dans un coffre-fort de secrets ; ne jamais le "
             "partager ni régénérer les clés sur une installation existante. Ports surchargeables : "
             "AUTO_RH_PORT_ADMIN et AUTO_RH_PORT_PORTAIL (défauts 4000 et 4001).")
    y = puce(c, y,
             "Mise en service : CREER-SUPERADMIN-WINDOWS.bat (ou node scripts/creer-superadmin.js) crée un compte "
             "SUPERADMIN ou promeut un compte existant ; puis inscription du premier compte RH/IT par le "
             "superadministrateur (onglet Utilisateurs), connexion, changement de mot de passe imposé. Vérifier : "
             "import du jeu d'essai test-data (20 fiches) puis recherche d'un CIN complet (une recherche "
             "partielle doit donner 0 résultat — LISEZMOI-TESTS.txt). Si la base contient des fiches antérieures "
             "à 0.2.27 : cliquer une fois « Indexer la base pour la recherche » (bandeau ambré) — idempotent, "
             "sans arrêt de service. Sauvegarde de contrôle : SAUVEGARDER-BD-WINDOWS.bat puis node scripts/"
             "sauvegarde-bd.js --liste ; conserver une copie de .env hors du serveur.")

    # ---------------- 4. SÉCURITÉ ------------------------------------------
    y = titre_section(c, y, "4. Sécurité")
    y = para(c, y,
             "Principe directeur du projet : usage en réseau interne — ne pas exposer le port 4001 sur Internet. "
             "Les mesures ci-dessous sont présentes dans le code livré ; les points restants sont explicités "
             "ensuite, puis la procédure complète de chiffrement et de déchiffrement.")
    y = sous_titre(c, y, "Mesures en place et points restants")
    y = puce(c, y,
             "Mots de passe hachés scrypt (comparaison à temps constant) : 8 caractères minimum, 4 classes, "
             "expiration 15 jours pour tous les comptes avec changement forcé. Sessions admin : cookie httpOnly "
             "signé HMAC-SHA256, révoquées au changement de mot de passe.")
    y = puce(c, y,
             "Anti force-brute : 10 échecs de connexion admin par IP en 10 minutes puis 429 ; portail : 5 échecs "
             "puis verrouillage persistant de 15 minutes (423) avec temporisation anti-énumération. Double "
             "authentification TOTP (RFC 6238) du portail : QR affiché une seule fois, anti-rejeu, secret de "
             "fenêtre régénéré toutes les 10 minutes.")
    y = puce(c, y,
             "Journal de sécurité des authentifications (v0.2.101) : logs/auth-securite.log, une ligne JSON par "
             "événement — échec de connexion, verrouillage anti force-brute, tentative sur compte désactivé, "
             "connexion réussie (rôle tracé, mot de passe JAMAIS inscrit). Écriture asynchrone jamais bloquante, "
             "exploitable par grep ou un SIEM.")
    y = puce(c, y,
             "Chiffrement AES-256-GCM des champs sensibles de la base et de chaque fichier sur disque (en-tête "
             "PAIESAGE1), fiches, tampons et documents des demandes compris — procédure complète ci-après. Index "
             "de recherche : empreintes déterministes CHIFFRÉES uniquement — aucune valeur en clair en base, "
             "pré-filtre SQL par égalité sans déchiffrement. Le .env livré définit désormais AUTH_SECRET et une "
             "AUTO_RH_STORAGE_KEY DÉDIÉE (openssl rand -base64 48) : le repli historique sur une valeur par "
             "défaut ne s'applique plus, et une rotation de clé s'effectue avec les deux outils de chiffrement "
             "(v0.2.101).")
    y = puce(c, y,
             "Verrouillage du répertoire des tampons (v0.2.102) : les copies de contrôle de storage/tampons — "
             "images de tampon ET certificats importés — sont chiffrées AES-256-GCM (en-tête PAIESAGE1) ET "
             "protégées par des permissions Unix strictes : dossier en 0700, chaque fichier en 0600, imposées à "
             "CHAQUE écriture (création en mode restreint + chmod de rattrapage : un dossier recréé trop "
             "permissif par une restauration est refermé automatiquement). Ce dossier n'est servi par AUCUNE "
             "route HTTP (Next.js ne sert que public/) — accès vérifié 404 même avec une session valide ; même "
             "traitement pour storage/payslips et storage/documents-demandes. Le build standalone n'embarque "
             "PLUS les données : storage, db, logs et backups sont exclus de .next/standalone/ "
             "(outputFileTracingExcludes) — plus aucun doublon sensible sur le disque.")
    y = puce(c, y,
             "Secrets hors du suivi de version (v0.2.102) : le fichier .env (AUTH_SECRET, AUTO_RH_STORAGE_KEY) "
             "est exclu de git (.gitignore + retrait de l'index) après la découverte d'un commit contenant les "
             "clés — rotation n°2 des DEUX clés exécutée le 27 septembre 2026 avec les outils officiels (base "
             "et storage re-chiffrés, 0 erreur, sauvegardes préalables), le contenu de l'historique local "
             "n'expose donc plus aucun secret actif ; AUTO_RH_STORAGE_DISABLE confirmé non activé ; .env en "
             "droits 0600 et absent des archives livrées. Route d'import dédiée fiabilisée : "
             "/api/signature-config/certificat écrit les colonnes réelles du schéma (certFichierNom, "
             "certSerie, certImportLe — elle renvoyait une erreur 500 sur des colonnes inexistantes) et ne "
             "renvoie JAMAIS le mot de passe du certificat (booléen certMotDePasseEnregistre seul).")
    y = puce(c, y,
             "Autorisations API : session requise partout ; IT/SUPERADMIN exigés pour les comptes, la consultation "
             "et l'écriture SMTP, et le journal d'envoi ; fiche du portail servie seulement si le CIN de session figure dans "
             "son contenu — matrice complète en annexe A. En-têtes HTTP (anti-clickjacking, nosniff, "
             "no-referrer, HSTS, Content-Security-Policy, Permissions-Policy — v0.2.101), cookies de session "
             "« Secure » automatiques dès que la requête arrive en HTTPS (x-forwarded-proto) ou sur "
             "AUTO_RH_FORCE_SECURE_COOKIES=1, validation structurelle des images, archives ZIP limitées, droits "
             "disque restrictifs appliqués automatiquement au démarrage (ACL Windows / chmod Linux) sur .env, db, "
             "storage, logs, backups.")
    y = puce(c, y,
             "Points restants avant une exposition plus large : HTTPS absent — prévoir un reverse proxy TLS "
             "(nginx, Caddy, IIS), les cookies « Secure » s'activant alors seuls ; docker-compose.yml ne fournit "
             "ni AUTH_SECRET ni AUTO_RH_STORAGE_KEY (monter le .env restreint ou les définir dans le compose) ; "
             "compteurs anti force-brute admin en mémoire (réinitialisés à chaque redémarrage).")
    y = sous_titre(c, y, "Chiffrement et déchiffrement pas à pas")
    y = para(c, y,
             "Deux modes coexistent : le mode AUTOMATIQUE — l'application chiffre à l'écriture et déchiffre à la "
             "lecture, sans aucune action de l'exploitant — et le mode MANUEL — deux outils en ligne de commande "
             "qui agissent en masse sur les fichiers ou sur la base, typiquement pour une migration, un audit ou "
             "un changement de clé. Dans les deux modes, TOUT repose sur un seul secret : celui du fichier .env "
             "situé à la racine du projet. Le secret actif est AUTO_RH_STORAGE_KEY si elle est définie, sinon "
             "AUTH_SECRET. Le secret brut n'est JAMAIS employé directement comme clé AES : la fonction scrypt "
             "l'étire en clés de 256 bits avec des sels applicatifs fixes, produisant des clés DISTINCTES par "
             "domaine — connaître une clé ne révèle ni les autres ni le secret d'origine. Deux installations "
             "partageant le même secret partagent les mêmes clés (les sels sont publics dans le code) : ne "
             "jamais transmettre le secret par chat ou e-mail, et le rotater si cela arrive.")
    y = tableau(c, y,
                ["Domaine chiffré", "Sel scrypt (dans le code)", "Fichier du code", "Format sur le disque"],
                [5.0 * cm, 4.3 * cm, 3.4 * cm, 4.3 * cm],
                [("Fiches de paie, documents des demandes, copies des tampons (en-tête PAIESAGE1)",
                  "autorh-storage-v1", "src/lib/storage-crypto.ts",
                  "[PAIESAGE1][nonce 12 o][tag 16 o][données AES-256-GCM]"),
                 ("Champs sensibles de la base — IV ALÉATOIRE (préfixe encbd1:) : contenu des fiches, SMTP, TOTP, journaux",
                  "autorh-db-aleatoire-v1", "src/lib/db-crypto.ts", "encbd1:iv:tag:données"),
                 ("Champs à recherche par égalité — IV DÉTERMINISTE (préfixe encbd1d:) : CIN de session, e-mails",
                  "autorh-db-deterministe-v1 (+ clé HMAC autorh-db-mac-v1 pour l'IV)",
                  "src/lib/db-crypto.ts", "encbd1d:iv:tag:données")],
                taille_corps=8.2, pas_corps=9.2)
    y = caption(c, y, "Tableau 4.1 — Dérivation des clés : UN secret (.env) étiré par scrypt en QUATRE clés AES-256 distinctes. Les mots de passe ne sont ni chiffrés ni déchiffrables, par conception : ils sont HACHÉS (scrypt, sel aléatoire de 16 octets, format scrypt::) — aucun outil ne peut les « récupérer », même avec le .env.")
    y = puce(c, y,
             "Mode automatique — rien à faire : fiche chiffrée AVANT écriture sur le disque (storage/payslips/), "
             "déchiffrée EN MÉMOIRE à la volée à la consultation (administration ET portail) — le fichier sur "
             "disque reste chiffré en permanence ; champs sensibles chiffrés à l'écriture par le middleware "
             "Prisma, recherche par empreintes déterministes SANS déchiffrement ; copies des tampons écrites "
             "chiffrées à l'enregistrement, avec rattrapage automatique, idempotent et journalisé, des copies "
             "plus anciennes restées en clair.")
    y = sous_titre(c, y, "Le cycle d'un PDF de fiche : chiffré à l'écriture, déchiffré à la lecture")
    y = puce(c, y,
             "À l'IMPORT (chiffrement à l'écriture) : une fois le type du fichier contrôlé, le PDF ou l'image "
             "est chiffré AVANT toute écriture — un nonce aléatoire unique de 12 octets est tiré pour CHAQUE "
             "fichier (deux fiches strictement identiques produisent donc deux fichiers chiffrés différents), "
             "AES-256-GCM chiffre le document et calcule un tag d'authenticité de 16 octets. Le fichier écrit "
             "dans storage/payslips/ commence par l'en-tête PAIESAGE1 suivi du nonce, du tag puis du contenu "
             "chiffré : ce n'est PLUS un PDF — aucun lecteur ne peut l'ouvrir sur le disque, ni l'exploitant, "
             "ni un vol ou un prêt du disque.")
    y = puce(c, y,
             "À la CONSULTATION (déchiffrement à la volée) : seul un point d'accès authentifié peut demander la "
             "fiche — administration RH/IT après connexion, portail employé CIN + code OTP ; le serveur lit le "
             "fichier chiffré, VÉRIFIE le tag d'authenticité (toute altération du disque — bit corrompu, "
             "troncature, modification malveillante — fait échouer le déchiffrement avec une erreur explicite : "
             "le contenu altéré n'est JAMAIS servi), déchiffre EN MÉMOIRE et envoie le PDF au navigateur. "
             "Aucune copie en clair n'est écrite nulle part — ni cache disque, ni fichier temporaire : le "
             "fichier reste chiffré sur le disque en permanence, du premier octet importé à sa suppression.")
    y = puce(c, y,
             "Compatibilité et garde-fous : les fiches antérieures au chiffrement (sans en-tête PAIESAGE1) "
             "restent lues telles quelles — aucune fiche existante n'est cassée ; un fichier déjà chiffré n'est "
             "JAMAIS double-chiffré (idempotence, détecté par son en-tête) ; le disjoncteur "
             "AUTO_RH_STORAGE_DISABLE=1 désactive le chiffrement des NOUVEAUX imports (repli historique de "
             "dépannage uniquement — les nouveaux fichiers resteraient en clair, les anciens restent "
             "déchiffrables) : le laisser DÉSACTIVÉ en exploitation ; contrôle périodique : node "
             "scripts/chiffrer-storage.js --verifier (lecture seule, serveurs en marche) doit afficher 0 "
             "fichier en clair.")
    y = puce(c, y,
             "Défense en profondeur : le chiffrement du PDF s'accompagne de permissions Unix strictes (dossier "
             "0700, fichiers 0600, imposées à CHAQUE écriture), d'AUCUNE route HTTP vers les répertoires de "
             "stockage (Next.js ne sert que public/ — une URL directe /storage/… renvoie 404, même avec une "
             "session valide), d'un build standalone sans les données, et d'une clé unique "
             "AUTO_RH_STORAGE_KEY conservée dans le .env en droits 0600 et hors suivi git : qui dispose du "
             "disque sans le .env ne peut rien lire.")
    y = sous_titre(c, y, "Outils manuels, rotation de clé et règles d'or")
    y = para(c, y,
             "Outil FICHIERS (scripts\\chiffrer-storage.js) : couvre storage/payslips, storage/documents-demandes "
             "et storage/tampons (ainsi que leurs copies .next/standalone). Les fichiers DÉJÀ chiffrés sont "
             "détectés par leur en-tête et JAMAIS double-chiffrés (idempotence). À lancer depuis la racine du "
             "projet, syntaxe Windows (Linux/macOS : barres obliques normales) :")
    y = bloc_code(c, y, [
        "node scripts\\chiffrer-storage.js --verifier        Etat sans rien modifier (SUR)",
        "node scripts\\chiffrer-storage.js                   Chiffre tout ce qui est en clair (defaut)",
        "node scripts\\chiffrer-storage.js --dechiffrer      Dechiffre tout (retour arriere)",
    ])
    y = para(c, y,
             "Outil BASE DE DONNÉES (scripts\\chiffrer-base.js) : migre les lignes déjà présentes dans "
             "db/custom.db (champs des fiches, accès portail TOTP, comptes RH/IT, journaux). ARRÊTER D'ABORD les "
             "serveurs : SQLite n'accepte qu'un seul écrivain à la fois. Une SAUVEGARDE AUTOMATIQUE de la base "
             "(db/custom.db.avant-chiffrement-AAAA-MM-JJ-HHMMSS) est créée AVANT toute modification, et le "
             "script est IDEMPOTENT : une valeur déjà chiffrée (préfixes encbd1:/encbd1d:) n'est jamais "
             "retouchée. Puis redémarrer. Les modes --verifier et --statut sont LECTURE SEULE : ils peuvent "
             "être lancés à tout moment, serveurs en marche, comme contrôle périodique d'hygiène.")
    y = bloc_code(c, y, [
        "node scripts\\chiffrer-base.js --statut        Etat sans rien modifier (SUR)",
        "node scripts\\chiffrer-base.js                 Chiffre toutes les lignes en clair (defaut)",
        "node scripts\\chiffrer-base.js --dechiffrer    Dechiffre tout (retour arriere / rollback)",
    ])
    y = para(c, y,
             "Rotation de la clé (changer AUTH_SECRET sans perte de données) : le changer dans le .env sans "
             "préparation rend INSTANTANÉMENT illisibles les fichiers ET la base. Procédure sûre, à exécuter "
             "serveurs arrêtés — (1) vérifier l'état : --verifier et --statut doivent afficher 0 en clair (tout "
             "est chiffré avec l'ANCIENNE clé) ; (2) déchiffrer avec l'ancienne clé encore en place : "
             "chiffrer-storage.js --dechiffrer PUIS chiffrer-base.js --dechiffrer (les sauvegardes automatiques "
             "sont créées avant chaque étape) ; (3) remplacer la valeur de AUTH_SECRET dans le .env par un "
             "nouveau secret aléatoire de 64 caractères hexadécimaux (généré localement, jamais transmis en "
             "clair par chat/e-mail) et sauvegarder l'ancien .env dans un coffre-fort de mots de passe ; "
             "(4) re-chiffrer avec la nouvelle clé : chiffrer-storage.js PUIS chiffrer-base.js ; (5) redémarrer "
             "puis contrôle final : --verifier (0 en clair), --statut (tous chiffrés), import d'essai d'une "
             "fiche, consultation administration ET portail.", taille=9.0)
    y = para(c, y,
             "Règles d'or : (1) SAUVEGARDER le .env hors du serveur (coffre-fort de mots de passe) — la perte de "
             "la clé rend les données mathématiquement irrécupérables, c'est le seul incident réellement survenu "
             "sur le projet ; (2) la MÊME clé doit chiffrer et déchiffrer, sans jamais lancer d'outils en dehors de "
             "la racine du projet avec son .env (sinon l'outil fichiers génère une clé aléatoire, l'append au .env "
             "et chiffre avec elle) ; (3) l'idempotence protège des doubles chiffrements : relancer un outil ne "
             "fait rien de dangereux ; (4) les modes --verifier et --statut sont lecture seule et peuvent servir "
             "d'audit périodique ; (5) en cas de doute, arrêter les serveurs avant toute opération sur la base.",
             taille=9.0)

    # ---------------- 5. CAPACITÉ ------------------------------------------
    y = titre_section(c, y, "5. Capacité, matériel et durée de vie (20 ans)")
    y = para(c, y,
             "Charge cible du projet : environ 1 000 employés, 1 000 fiches importées par mois et une "
             "conservation sur 20 ans, soit 240 000 fiches au terme. Les deux anciennes limites majeures sont "
             "traitées : la liste d'administration est paginée côté serveur et la recherche CIN s'effectue par "
             "index SQL déterministe chiffré. Les performances ont été mesurées à 240 000 fiches exactes sur les "
             "routes HTTP authentifiées : page de liste de 0,02 s (première page) à 0,73 s au pire (fin de "
             "table), recherche CIN à 0,64 s après le premier appel (cache à froid), mémoire du serveur stable "
             "(103 Mo au démarrage, 192 Mo après tous les scénarios, aucune fuite). Le test de charge HTTP "
             "simultanée du portail (jour de paie, 100 à 150 utilisateurs) reste à exécuter avant engagement (R1).")
    y = tableau(c, y,
                ["Poste de stockage", "Calcul sur 240 000 fiches", "Estimation à 20 ans"],
                [5.9 * cm, 6.7 * cm, 4.4 * cm],
                [("Base SQLite (fiches, index de recherche, journal d'import)",
                  "8 à 14 Ko par fiche + 1 à 3 Ko d'index chiffré", "2,2 à 4,3 Go"),
                 ("Fichiers PDF des bulletins (storage/payslips)",
                  "100 à 500 Ko par PDF (hypothèse à confirmer par un import pilote)", "24 à 120 Go"),
                 ("Journaux applicatifs (logs/*.log)",
                  "croissance continue sans rotation — surveillance requise", "1 à 5 Go"),
                 ("Volume vivant total", "somme des postes ci-dessus", "≈ 27 à 130 Go"),
                 ("Marge interne recommandée (+ 50 %) et rotation locale de 10 sauvegardes .pgb",
                  "ré-imports, doublons temporaires, sauvegardes locales", "≈ 40 à 196 Go"),
                 ("Sauvegardes externes (règle 3-2-1, dont 1 hors site)",
                  "3 à 4 copies du volume vivant", "≈ 80 à 520 Go")])
    y = caption(c, y, "Tableau 5.1 — Projection de stockage à 20 ans (ordres de grandeur décimaux ; 1 Go = 1 000 000 000 octets).")
    y = para(c, y,
             "Configuration matérielle recommandée (dimensionnée pour la charge cible sur le long terme) : CPU "
             "8 cœurs physiques à 3 GHz ou plus (16 threads — OCR multi-passes pendant les imports, "
             "chiffrement AES sur chaque lecture/écriture, scrypt coûteux à chaque connexion) ; RAM 16 Go (ECC "
             "de préférence), extensible à 32 Go sans changer de carte mère ; disque système 500 Go SSD ; disque "
             "données 2 × 1 To SSD/NVMe identiques en miroir RAID 1 (le SSD réduit la latence des accès "
             "aléatoires SQLite) ; Windows Server 2016+ ou Linux LTS avec Node.js 22, Docker en option ; LAN "
             "1 Gbit/s (couvre environ dix fois le pic estimé du jour de paie) ; onduleur (UPS) avec arrêt "
             "propre automatique — une coupure pendant une écriture SQLite peut corrompre la base.")
    y = sous_titre(c, y, "Fiabilité des données et durée de vie")
    y = puce(c, y,
             "Vérification automatique des CIN après chaque import : chaque fiche est classée « vrai » (format "
             "tunisien authentique : 8 chiffres classique ou 9 biométrique), « faux » (valeur détectée hors "
             "format) ou « non détecté » (aucun CIN lisible). Le taux de fiabilité (CIN vrais / fiches "
             "importées) et le taux d'erreur (CIN faux / fiches importées) s'affichent dans un encadré du "
             "panneau d'import, en badge vert/rouge devant chaque CIN et dans le journal des imports. La "
             "vérification certifie le FORMAT du numéro lu sur le document ; certifier qu'un CIN correspond à "
             "une carte réelle exigerait un registre officiel externe, hors de portée d'une application locale.")
    y = puce(c, y,
             "Détection automatique des incohérences de nom et prénom : à l'import, le nom extrait de chaque "
             "fiche est contrôlé en format puis comparé aux fiches du même CIN — la référence est le nom le "
             "plus FRÉQUENT, une coquille isolée ne devient jamais la référence (écriture différente, ordre "
             "inversé et fautes de frappe signalés). Aux demandes, la saisie de l'employé est comparée au nom "
             "de référence (ordre des mots indifférent) : l'employé est alerté juste après l'envoi, le "
             "destinataire voit l'avertissement dans l'e-mail et le RH/IT dans le détail de la demande. Toute "
             "la détection est NON BLOQUANTE : imports et demandes restent créés, le RH garde la décision finale.")
    y = para(c, y,
             "Défaillances et parades sur 20 ans : miroir RAID 1 et remplacement préventif des disques tous les "
             "5 à 7 ans (défaillance typique d'un SSD 0,5 à 1 % par an) ; règle 3-2-1 pour les sauvegardes "
             "externes avec test de restauration trimestriel (un disque de sauvegarde externe défaillera presque "
             "sûrement en 20 ans) ; onduleur contre les coupures électriques ; renouvellement du serveur tous "
             "les 5 à 7 ans (migration testée : copier db, storage, backups et .env vers le nouveau serveur puis "
             "restaurer). Taux d'erreur en exploitation : chaque opération écrit une trace vérifiable — une "
             "ligne ImportLog par fichier importé et une journalisation de chaque envoi avec succes:true ou "
             "false dans logs/journal-emails.log (seuil d'alerte indicatif : 2 % sur une journée de paie). "
             "Aucune corruption silencieuse n'est possible : toute altération d'un fichier ou d'un champ "
             "invalide l'authentification AES-256-GCM et déclenche une erreur explicite.", taille=9.0)
    y = para(c, y,
             "Durée de vie : prévoir 3 à 4 générations de matériel sur 20 ans et 4 à 6 migrations majeures du "
             "socle logiciel (Node, Next.js, Prisma) ; exporter périodiquement les PDF en clair vers une archive "
             "pérenne (PDF/A si exigence légale). Au-delà de 2 000 employés ou en multi-sites, évoluer vers "
             "PostgreSQL/MySQL — Prisma change de provider sans réécriture applicative — plutôt que changer de "
             "matériel ; une revue annuelle de capacité permet de décider à temps. Disponibilité cible : "
             "supérieure à 99,5 % ; avant la mise en production à 1 000 employés : test de charge du portail "
             "(k6, JMeter ou Locust — objectif indicatif : moins de 3 s par écran) et test de restauration des "
             "sauvegardes.", taille=9.0)

    # ---------------- 6. EXPLOITATION ET DÉPANNAGE -------------------------
    y = titre_section(c, y, "6. Exploitation et dépannage")
    y = para(c, y,
             "Le projet fournit lanceurs d'état, journaux dédiés, sauvegarde chiffrée outillée et sécurisation "
             "automatique des droits. Ce chapitre réunit l'essentiel : commandes, routine recommandée, mise à "
             "niveau, tests et remèdes aux incidents documentés.")
    y = tableau(c, y,
                ["Objectif", "Commande"],
                [4.6 * cm, 12.4 * cm],
                [("Sauvegarde / restauration",
                  "node scripts/sauvegarde-bd.js --liste ; --restaurer \"SERVICE-RH-BD-...\" --sortie db/custom.db"),
                 ("Superadministrateur",
                  "node scripts/creer-superadmin.js --creer --email a@b.tn --nom \"Nom\" --password XXX ; --promouvoir --email a@b.tn"),
                 ("Chiffrement base / stockage",
                  "node scripts/chiffrer-base.js (idempotent, sauvegarde préalable) ; node scripts/chiffrer-storage.js --verifier"),
                 ("Services", "node scripts/auto-rh.js start | stop | restart | status"),
                 ("Découpage des anciens fichiers",
                  "node scripts/scinder-pdfs-multipages.js --verifier (idem scinder-excel- et scinder-docx-)"),
                 ("État et journaux",
                  "ETAT-SILENCIEUX-WINDOWS.vbs ; JOURNAUX-SILENCIEUX-WINDOWS.vbs ; logs/auto-rh-processus.json")],
                taille_corps=8.6)
    y = caption(c, y, "Tableau 6.1 — Commandes en ligne de commande (options vérifiées dans chaque script).")
    y = tableau(c, y,
                ["Périodicité", "Tâche"],
                [4.6 * cm, 12.4 * cm],
                [("Hebdomadaire", "Vérifier l'état des deux services, les journaux et l'espace disque (journaux sans rotation automatique)."),
                 ("Mensuelle (après paie)", "Sauvegarde .pgb + copie externe de db, storage ET .env ; vérifier la rotation."),
                 ("Trimestrielle", "Test de restauration sur une machine de test depuis une sauvegarde .pgb et une copie storage."),
                 ("Après chaque mise à jour", "Sauvegarder, remplacer les fichiers, npm install, npx prisma generate + db push (si le schéma a changé), npm run build, redémarrer ; cliquer « Indexer la base » si le bandeau ambré apparaît."),
                 ("Annuelle", "Revue de capacité (taille de base, nombre de fiches, temps de réponse), export d'archive annuel, vérification des accès portail.")],
                taille_corps=8.6)
    y = caption(c, y, "Tableau 6.2 — Routine d'exploitation.")
    y = para(c, y,
             "Point de vigilance capital : une sauvegarde sans le fichier .env (AUTH_SECRET et "
             "AUTO_RH_STORAGE_KEY) est une sauvegarde morte — les fiches seraient irrécupérables après "
             "restauration.", police="Serif-I", taille=9.0)
    y = puce(c, y,
             "Mise à niveau : séquence d'installation d'une nouvelle version — sauvegarde, remplacement des "
             "fichiers, npm install, npx prisma generate + db push (si le schéma a changé), npm run build, "
             "redémarrage. Fichiers multi-fiches importés par une ancienne version (restés fusionnés) : "
             "supprimer la fiche fusionnée puis réimporter le fichier original, ou les découper par les scripts "
             "scinder-*. Avant une mise en production à 1 000 employés : test de charge HTTP du portail "
             "(50 à 150 utilisateurs simultanés) et test de restauration à l'échelle des 20 années de "
             "données (sections 5 et 7).")
    y = sous_titre(c, y, "Dépannage : incidents d'exploitation et remèdes vérifiés")
    y = tableau(c, y,
                ["Symptôme", "Remède vérifié"],
                [6.4 * cm, 10.6 * cm],
                [("« Node.js n'est pas reconnu » ou lanceur qui s'arrête immédiatement",
                  "Réinstaller Node.js 20 ou 22 LTS (nodejs.org), rouvrir le terminal puis relancer le lanceur."),
                 ("Erreur 500 au démarrage, base absente",
                  "Les lanceurs recréent le .env et exécutent prisma db push ; manuellement : npx prisma db push puis redémarrer."),
                 ("Recherche lente ou 409 « indexation requise »",
                  "Cliquer « Indexer la base pour la recherche » (idempotent, sans arrêt de service)."),
                 ("Fiche importée introuvable en recherche",
                  "La recherche exige le CIN COMPLET (séparateurs intérieurs et casse tolérés) ; un scan sans couche texte exige un réimport lisible (l'OCR ne s'applique qu'aux documents contenant quelques caractères)."),
                 ("Fiches illisibles : « clé de chiffrement du stockage ne correspond pas »",
                  "AUTH_SECRET ou AUTO_RH_STORAGE_KEY a changé : restaurer le .env d'origine ; ne JAMAIS régénérer les clés sur une base existante (rotation de clé : section 4)."),
                 ("« Je ne reçois pas l'e-mail » (accès portail, test SMTP ou notification)",
                  "Lire logs/journal-emails.log : chaque tentative y est consignée avec la réponse SMTP brute (Gmail : mot de passe d'application de 16 caractères obligatoire)."),
                 ("L'employé ne reçoit pas la notification de sa demande",
                  "Vérifier l'adresse enregistrée dans « Demandes administratives » (elle est figée à la création de la demande) ; l'onglet Demandes côté administration indique l'état de la notification."),
                 ("Le document envoyé par le RH n'apparaît pas sur la demande",
                  "Vérifier la rubrique « Réception des réponses du service RH (IMAP) » de l'onglet Accès portail (interrupteur activé, adresse et port du serveur, identifiants — vides = ceux du SMTP) puis « Tester la connexion »."),
                 ("Un document du dossier documents-demandes est resté lisible sur le disque",
                  "Il est chiffré AUTOMATIQUEMENT au démarrage du portail (balayage silencieux) ; pour forcer immédiatement : node scripts/chiffrer-storage.js."),
                 ("Les fichiers du dossier storage/tampons/ ne s'ouvrent plus comme des images",
                  "C'est voulu : les copies de contrôle des tampons importés sont CHIFFRÉES (AES-256-GCM, en-tête PAIESAGE1) ; les deux services les déchiffrent à la volée."),
                 ("Après une mise à jour, le QR ou la signature n'apparaissent pas (surtout hors PDF)",
                  "Build PÉRIMÉ : relancer npm run build puis redémarrer (les lanceurs vérifient le marqueur .auto-rh-version et reconstruisent si besoin)."),
                 ("La signature ou le QR recouvre une zone de la fiche",
                  "Curseurs « Décalage horizontal/vertical », largeur/taille (40 à 1 200 points) et rotation (0 à 360°) de la rubrique « Signature électronique & QR code » — positionnement libre sur toute la feuille (aperçu A4 interactif)."),
                 ("Une fiche ou une demande signale une anomalie de nom/prénom",
                  "Détection automatique (format, faute de frappe, ordre inversé) : signalée dans les résultats d'import, le journal, l'e-mail du destinataire et le détail de la demande ; jamais bloquante (section 5)."),
                 ("« Port déjà utilisé » au démarrage",
                  "ARRETER-SILENCIEUX-WINDOWS.vbs (ou node scripts/auto-rh.js stop) puis redémarrer ; vérifier avec ETAT-SILENCIEUX-WINDOWS.vbs."),
                 ("Employé verrouillé : « Trop de tentatives » (423)",
                  "Attendre 15 minutes ou bouton « Déverrouiller » de l'onglet Accès portail ; mot de passe expiré (15 jours) : changement imposé à la connexion ou réinitialisation par le RH/IT."),
                 ("Sessions invalidées après chaque redémarrage Docker",
                  "Définir AUTH_SECRET et AUTO_RH_STORAGE_KEY dans le compose ou monter un .env restreint.")],
                taille_corps=8.4, pas_corps=9.2)
    y = caption(c, y, "Tableau 6.3 — Dépannage : incidents d'exploitation et remèdes vérifiés.")

    # ---------------- 7. RECOMMANDATIONS -----------------------------------
    y = titre_section(c, y, "7. Recommandations")
    y = para(c, y,
             "Les recommandations ci-dessous sont ordonnées par priorité au regard de l'objectif déclaré "
             "(1 000 employés, 1 000 fiches par mois, 20 ans d'historique). Toutes les versions se cumulent : "
             "installer la dernière revient à bénéficier de l'ensemble des correctifs.")
    for rec in [
        "R1 — Exécuter le test de charge du portail (k6, JMeter ou Locust, 50 à 150 utilisateurs simultanés) avant la mise en production à 1 000 employés.",
        "R3 — Automatiser les sauvegardes : planifier sauvegarde-bd.js (tâche planifiée / cron) + copie externe de db, storage et .env ; tester la restauration trimestriellement (règle 3-2-1).",
        "R4 — Chiffrer le transport : reverse proxy HTTPS devant 4000/4001 et cookies secure avant toute exposition au-delà du réseau interne.",
        "R5 — Compléter docker-compose.yml avec AUTH_SECRET et AUTO_RH_STORAGE_KEY.",
        "R6/R8 — Conserver SQLite tant que le test de charge le permet ; migrer vers PostgreSQL/MySQL uniquement en cas de croissance (multi-sites, plus de 2 000 employés) — Prisma change de provider sans réécriture applicative.",
        "R10 — Gestion des clés : coffre-fort de secrets pour .env et procédure écrite de reprise ; jamais de régénération sur une base existante.",
        "R11 — Export annuel pérenne : exporter chaque année les PDF de l'année (déchiffrés) vers un support d'archive documenté (PDF/A si exigence légale).",
        "R12 — Surveillance : alerte sur l'espace disque (80 %), l'absence de sauvegarde récente et l'indisponibilité des ports 4000/4001.",
        "R14 — Imports lourds hors heures ouvrées (OCR = CPU), par tranches si besoin (gros fichiers jusqu'à 500 Mo gérés).",
        "R15 — Revue annuelle de capacité : comparer volumes et temps de réponse réels aux estimations de la section 5.",
        "R21 — Maintenir le présent README à chaque livraison : intégrer les nouveautés, retirer l'obsolète, actualiser les annexes.",
    ]:
        y = puce(c, y, rec, taille=9.0)


# ==== ANNEXES (rendu) ========================================================

def dessine_annexes(c):
    """Annexes A (matrice des droits) et B (map de routage des e-mails) sur le même canvas."""
    h_entete = 0.72 * cm
    pas_ligne = 8.6

    # ================= ANNEXE A ============================================
    def entete_A(c, continue_):
        if not continue_:
            c.setFillColor(ACCENT)
            c.setFont("Serif-B", 16)
            c.drawString(MARGE_G, HAUT - MARGE_H - 0.05 * cm, "Annexe A — Matrice des droits des rôles")
            c.setFillColor(GRIS)
            c.setFont("Serif", 9.2)
            c.drawString(MARGE_G, HAUT - MARGE_H - 0.62 * cm,
                         "État du code livré v0.2.109 (archive officielle), 29 septembre 2026.")
            c.drawString(MARGE_G, HAUT - MARGE_H - 0.97 * cm,
                         "Trois rôles d'administration (SuperAdmin, RH, IT) sur le port 4000 ; l'employé dispose du portail dédié 4001 (bloc ci-après).")
            return HAUT - MARGE_H - 1.45 * cm
        c.setFillColor(ACCENT)
        c.setFont("Serif-B", 11)
        c.drawString(MARGE_G, HAUT - MARGE_H, "Annexe A — Matrice des droits (suite)")
        return HAUT - MARGE_H - 0.55 * cm

    def np_A():
        pied(c)
        c.showPage()
        PAGE["n"] += 1
        PART["label"] = PIEDS["A"]
        return entete_A(c, True)

    # saut de page obligatoire : les annexes démarrent toujours sur une page
    # vierge (le cœur peut se terminer en milieu de page)
    pied(c)
    c.showPage()
    PAGE["n"] += 1
    PART["label"] = PIEDS["A"]
    y = entete_A(c, False)

    col_f = LARGE_UTILE * 0.44
    col_r = (LARGE_UTILE - col_f) / 3.0

    def dessiner_entete_matrice():
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

    dessiner_entete_matrice()

    for groupe, lignes in GROUPES:
        h_groupe = 0.52 * cm
        if y - h_groupe < MARGE_B:
            y = np_A()
            dessiner_entete_matrice()
        c.setFillColor(FOND_GROUPE)
        c.rect(MARGE_G, y - h_groupe, LARGE_UTILE, h_groupe, stroke=0, fill=1)
        c.setFillColor(ACCENT)
        c.setFont("Serif-B", 9.4)
        c.drawString(MARGE_G + 6, y - h_groupe + (h_groupe - 9.4) / 2 + 1.5, groupe)
        y -= h_groupe

        for texte, v_sup, v_rh, v_it in lignes:
            nl = len(lignes_texte(texte, col_f - 12))
            h = max(0.58 * cm, nl * pas_ligne * PT_CM * cm + 2 * PAD)
            if y - h < MARGE_B:
                y = np_A()
                dessiner_entete_matrice()
            yy = y - PAD - 7.5
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

    note = ("« Non » = refusé (403 côté serveur et/ou élément masqué dans l'interface) — depuis la v0.2.100, les "
            "refus IT sont appliqués proprement côté serveur, sans état intermédiaire. Le dernier compte "
            "superadministrateur actif est protégé contre la suppression et la désactivation.")
    y -= 0.28 * cm
    y = dessine_paragraphe(c, MARGE_G, y, LARGE_UTILE, note, "Serif-I", 8.4, 9.8)

    # ---- Blocs onglets + portail + principes -------------------------------
    def titre_bloc(txt):
        nonlocal y
        t_h = 0.7 * cm
        if y - t_h < MARGE_B:
            y = np_A()
        c.setFillColor(ACCENT)
        c.setFont("Serif-B", 12)
        c.drawString(MARGE_G, y - 0.45 * cm, txt)
        y -= t_h + 0.12 * cm

    def bloc_lignes(entetes):
        nonlocal y
        for nom, detail in entetes:
            l1 = lignes_texte(nom, 4.4 * cm, "Serif-B", 9.2)
            l2 = lignes_texte(detail, LARGE_UTILE - 4.6 * cm)
            h = max(0.6 * cm, max(len(l1), len(l2)) * pas_ligne * PT_CM * cm + 2 * PAD)
            if y - h < MARGE_B:
                y = np_A()
            yy = y - PAD - 7.5
            c.setFillColor(ENCRE)
            c.setFont("Serif-B", 9.2)
            for ln in l1:
                c.drawString(MARGE_G, yy, ln)
                yy -= pas_ligne
            x_detail = MARGE_G + 4.5 * cm
            yy = y - PAD - 7.5
            c.setFont("Serif", 9.2)
            for ln in l2:
                c.drawString(x_detail, yy, ln)
                yy -= pas_ligne
            y -= h
            c.setStrokeColor(LIGNE)
            c.setLineWidth(0.5)
            c.line(MARGE_G, y, MARGE_G + LARGE_UTILE, y)

    def bloc_puces(items, np_fn):
        nonlocal y
        for p in items:
            l = lignes_texte(p, LARGE_UTILE - 0.55 * cm)
            h = len(l) * pas_ligne * PT_CM * cm + 2 * PAD
            if y - h < MARGE_B:
                y = np_fn()
            c.setFillColor(ACCENT)
            c.setFont("Serif-B", 9.2)
            c.drawString(MARGE_G, y - PAD - 7.5, "•")
            yy = y - PAD - 7.5
            c.setFillColor(ENCRE)
            c.setFont("Serif", 9.2)
            for ln in lignes_texte(p, LARGE_UTILE - 0.55 * cm):
                c.drawString(MARGE_G + 0.55 * cm, yy, ln)
                yy -= pas_ligne
            y -= h

    y -= 0.35 * cm
    titre_bloc("Onglets visibles dans l'interface d'administration")
    bloc_lignes(ONGLETS)
    y -= 0.35 * cm

    # équilibre A-2 / A-3 : les blocs « portail employé » et « principes »
    # démarrent ensemble sur la page suivante (sinon dernière puce orpheline)
    y = np_A()

    titre_bloc("Le portail employé (port 4001)")
    bloc_puces(PORTAIL, np_A)
    y -= 0.35 * cm

    titre_bloc("Principes appliqués")
    bloc_puces(PRINCIPES, np_A)

    # ================= ANNEXE B : map de routage des e-mails ==================
    def entete_B(c, continue_):
        if not continue_:
            c.setFillColor(ACCENT)
            c.setFont("Serif-B", 16)
            c.drawString(MARGE_G, HAUT - MARGE_H - 0.05 * cm, "Annexe B — Map de routage des e-mails des demandes")
            c.setFillColor(GRIS)
            c.setFont("Serif", 9.2)
            c.drawString(MARGE_G, HAUT - MARGE_H - 0.62 * cm,
                         "Configuration introduite en v0.2.94 — état du code v0.2.109, 29 septembre 2026.")
            c.drawString(MARGE_G, HAUT - MARGE_H - 0.97 * cm,
                         "Configuration par l'IT / le superadministrateur — panneau SMTP → « Routage des demandes administratives ».")
            return HAUT - MARGE_H - 1.45 * cm
        c.setFillColor(ACCENT)
        c.setFont("Serif-B", 11)
        c.drawString(MARGE_G, HAUT - MARGE_H, "Annexe B — Map de routage des e-mails (suite)")
        return HAUT - MARGE_H - 0.55 * cm

    def np_B():
        pied(c)
        c.showPage()
        PAGE["n"] += 1
        PART["label"] = PIEDS["B"]
        return entete_B(c, True)

    pied(c)
    c.showPage()
    PAGE["n"] += 1
    PART["label"] = PIEDS["B"]
    y = entete_B(c, False)

    def titre_bloc_b(txt):
        nonlocal y
        t_h = 0.7 * cm
        if y - t_h < MARGE_B:
            y = np_B()
        c.setFillColor(ACCENT)
        c.setFont("Serif-B", 12)
        c.drawString(MARGE_G, y - 0.45 * cm, txt)
        y -= t_h + 0.12 * cm

    def tableau_b(entetes, largeurs, rows, mono_col0=False, vert_derniere=False):
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
            h = max(0.62 * cm, nl * 9.2 * PT_CM * cm + 2 * PAD)
            if y - h < MARGE_B:
                y = np_B()
                entete_t()
            dern = len(largeurs) - 1
            for j, lns in enumerate(colonnes):
                x = MARGE_G + sum(largeurs[:j])
                if vert_derniere and j == dern:
                    c.setFillColor(VERT_OUI)
                    c.setFont("Serif-B", 8.8)
                    c.drawCentredString(x + largeurs[j] / 2, y - PAD - 7.5, row[j])
                    continue
                yy = y - PAD - 7.5
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

    titre_bloc_b("Routage par type de demande")
    tableau_b(["Type de demande", "Destinataire principal", "Copie automatique", "Confirmation"],
              [3.1 * cm, 6.6 * cm, 4.1 * cm, 3.2 * cm], C_TYPES, vert_derniere=True)
    y -= 0.35 * cm

    titre_bloc_b("Champs de configuration (model MailConfig)")
    tableau_b(["Champ", "Rôle dans le routage"],
              [4.7 * cm, 12.3 * cm], C_CHAMPS, mono_col0=True)
    y -= 0.35 * cm

    # équilibre B-1 / B-2 : le bloc Mécanique commune démarre sur la page suivante
    y = np_B()
    titre_bloc_b("Mécanique commune")
    for p in C_MECANIQUE:
        l = lignes_texte(p, LARGE_UTILE - 0.55 * cm)
        h = len(l) * pas_ligne * PT_CM * cm + 2 * PAD
        if y - h < MARGE_B:
            y = np_B()
        c.setFillColor(ACCENT)
        c.setFont("Serif-B", 9.2)
        c.drawString(MARGE_G, y - PAD - 7.5, "•")
        yy = y - PAD - 7.5
        c.setFillColor(ENCRE)
        c.setFont("Serif", 9.2)
        for ln in lignes_texte(p, LARGE_UTILE - 0.55 * cm):
            c.drawString(MARGE_G + 0.55 * cm, yy, ln)
            yy -= pas_ligne
        y -= h


# ==== PROGRAMME PRINCIPAL ====================================================

def md5(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for bloc in iter(lambda: f.read(65536), b""):
            h.update(bloc)
    return h.hexdigest()


def main():
    os.makedirs(os.path.dirname(PDF_DL), exist_ok=True)

    # sauvegarde idempotente de l'édition v0.2.105 avant la livraison v0.2.106
    if os.path.exists(PDF_VERSIONNE) and not os.path.exists(SAUVEGARDE_PRECEDENTE):
        shutil.copy2(PDF_VERSIONNE, SAUVEGARDE_PRECEDENTE)
        print("Sauvegarde de l'édition v0.2.104 : " + SAUVEGARDE_PRECEDENTE)

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setTitle("AutoRH — README officiel — édition resserrée v0.2.120")
    c.setAuthor("AutoRH")
    c.setCreator("AutoRH")
    c.setSubject("Documentation technique AutoRH — fiches de paie, demandes administratives, portail employé, rôles et sécurité")

    dessine_couverture(c)
    dessine_coeur(c)
    dessine_annexes(c)

    pied(c)
    c.showPage()
    c.save()
    buf.seek(0)

    with open(PDF_CIBLE, "wb") as f:
        f.write(buf.read())

    # ---- Vérification ------------------------------------------------------
    verif = PdfReader(PDF_CIBLE)
    nb = len(verif.pages)
    assert 12 <= nb <= 16, "nombre de pages inattendu : %d" % nb
    texte_complet = "\n".join((p.extract_text() or "") for p in verif.pages)
    for i, p in enumerate(verif.pages):
        t = (p.extract_text() or "").strip()
        assert len(t) >= 30, "page %d quasi vide" % (i + 1)

    attendus = [
        # couverture et cœur resserré (Task 199)
        "Sommaire", "v0.2.106", "AutoRH",
        "cinq livrables", "/api/download-formation", "support de formation",
        "1. Présentation et architecture", "2. Fonctionnalités",
        "3. Installation et démarrage", "4. Sécurité",
        "5. Capacité, matériel et durée de vie", "6. Exploitation et dépannage",
        "7. Recommandations",
        "Tableau 4.1", "Tableau 5.1", "Tableau 6.3",
        "DEMARRER-SILENCIEUX-WINDOWS.vbs", "chiffrer-base.js", "chiffrer-storage.js",
        "240 000 fiches", "0,64 s", "encbd1d", "Tesseract", "DEM-AAAA-NNNNN",
        "AUTO_RH_STORAGE_KEY", "securiser-auto.js",
        # annexes — canaris (matrice, onglets, portail, principes, map)
        "Annexe A", "Matrice des droits des rôles", "SuperAdmin",
        "FONCTIONNALITE_NON_AUTORISEE_IT", "Onglets visibles", "Principes appliqués",
        "portail employé (port 4001)", "e-mail de l'employé",
        "HMAC", "parrainage",
        "Send Mail", "Configuration des réponses",
        # positionnement libre du certificat + matrice (v0.2.100)
        "poignée de redimensionnement", "position exacte X/Y",
        "plus aucun booléen « configurée »", "refus propre",
        "Oui (consultation seule)",
        "attestationTravailEmail",
        "demande-creation-copie-dediee", "/api/download-routage",
        "Annexe B — Map de routage des e-mails", "Routage par type de demande",
        "Destinataire principal", "Copie automatique",
        "Confirmation au demandeur", "attestationSalaireEmail",
        "congeEmail", "autorisationEmail", "parrainageEmail",
        "responsablesMap", "mailEnvoyeA",
        "DESTINATAIRE_ABSENT", "model MailConfig",
        # certificat DÉDIÉ aux réponses (v0.2.99, conservé en v0.2.100)
        "SON certificat de signature électronique DÉDIÉ",
        "ET de son certificat de signature",
        "n'affecte jamais l'autre",
        # sécurité durcie (v0.2.101) : journal auth, clé dédiée, en-têtes
        "auth-securite.log", "AUTO_RH_FORCE_SECURE_COOKIES", "Content-Security-Policy",
        # cycle PDF chiffré à l'écriture / déchiffré à la lecture (v0.2.103)
        # notifications employé sans réponse + renommage (v0.2.105)
        "NE PAS répondre", "Notifications employé SANS réponse", "anciennement Auto-RH",
        # v0.2.106 — e-mail de création, Nom/Prénom, pièce jointe
        "E-mail automatique de création de compte", "JOINT à la notification",
        "deux colonnes séparées (v0.2.106)", "Pièces jointes aux notifications employé",
        # v0.2.107 — matricule (fiches, accès portail, demandes, e-mails)
        "Matricule employé dans les demandes", "Consulter / modifier le « Matricule »", "auto-associé",
        "récupéré automatiquement depuis ses fiches de paie", "(v0.2.107)",
        # v0.2.108 — réponse aux demandes (libellés féminins, décision tous types)
        "Décision par réponse e-mail (v0.2.108)", "« Acceptée » ou « Refusée »",
        "Auto-RH (e-mail)",
        # v0.2.109 — accès portail : colonnes alignées + Nom/Prénom automatiques
        "Accès portail par mot de passe (v0.2.109)", "« Ben »/« Bel »/« Bou »",
        "bou mnijel", "pré-remplissage jamais destructif",
        "PAIESAGE1", "nonce aléatoire unique", "déchiffre EN MÉMOIRE",
        "AUTO_RH_STORAGE_DISABLE", "Aucune copie en clair", "0 fichier en clair",
        # QR « Fiche en ligne » (annexe A — fiches de paie)
        "Fiche en ligne",
        # v0.2.113 → v0.2.120 — chaîne de signature électronique (Task 235)
        "PAdES", "API de certification & signature", "Test/Production",
        "SIGNATURE ÉLECTRONIQUE", "cachet d'entreprise", "empreinte SHA-256",
        "sans aucune dépendance à openssl", "copies signées conservées",
        "v0.2.114 → v0.2.120", "édition resserrée v0.2.120",
        "Cachet « Signature électronique » du tampon", "avant envoi",
        "registre des documents signés", "Téléchargements directs",
    ]
    manquants = [a for a in attendus if a not in " ".join(texte_complet.split())]
    assert not manquants, "texte manquant dans le PDF : %s" % manquants

    # ---- Copies de diffusion ----------------------------------------------
    shutil.copy2(PDF_CIBLE, PDF_DL)
    shutil.copy2(PDF_CIBLE, PDF_VERSIONNE)

    print("OK : édition mise à jour — %d pages (marqueurs et bandeau version courante)" % nb)
    print("Tous les marqueurs de contrôle présents (%d)." % len(attendus))
    for p in (PDF_CIBLE, PDF_DL, PDF_VERSIONNE):
        print("  %s — %d octets — md5 %s" % (p, os.path.getsize(p), md5(p)))


if __name__ == "__main__":
    main()
