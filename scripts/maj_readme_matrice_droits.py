#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 177 — Ajoute l'annexe « Matrice des droits des rôles » au README PDF
(auto-rh-readme-technique.pdf, édition condensée v0.2.65 → complément code v0.2.81).

1) Génère l'annexe avec ReportLab (polices FreeSerif/DejaVuSansMono — mêmes
   familles que le document existant, tableaux sobres cohérents).
2) Fusionne avec pypdf (annexe ajoutée EN FIN de document — aucune retouche
   des 19 pages existantes, aucune chirurgie d'octets).
3) Vérifie le résultat (nombre de pages + extraction texte de l'annexe).

Sortie : auto-rh-readme-technique.pdf (remplacé après vérification).
Sauvegarde : /tmp/my-project/auto-rh-readme-technique-v0.2.65-avant-matrice.pdf
"""
import io
import os
import shutil

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader, PdfWriter

RACINE = "/home/z/my-project"
PDF_CIBLE = os.path.join(RACINE, "auto-rh-readme-technique.pdf")
PDF_ANNEXE = os.path.join(RACINE, "scripts", "readme-annexe-matrice.pdf")
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
ACCENT = colors.HexColor("#0f4c46")          # titre de section (vert sombre sobre)
LIGNE = colors.HexColor("#c9d4d2")
FOND_GROUPE = colors.HexColor("#eef4f3")
FOND_ENTETE = colors.HexColor("#0f4c46")
VERT_OUI = colors.HexColor("#1c6b40")
ROUGE_NON = colors.HexColor("#9c2f2f")

# ---- Contenu de la matrice (état du code vérifié v0.2.81) ------------------
GROUPES = [
    ("Fiches de paie", [
        ("Recherche par CIN", "Oui", "Oui", "Non"),
        ("Toutes les fiches (consultation)", "Oui", "Oui", "Non"),
        ("Importer des fiches", "Oui", "Oui", "Non"),
        ("Supprimer des fiches", "Oui", "Oui", "Non"),
    ]),
    ("Accès portail par mot de passe", [
        ("Créer / réinitialiser / activer-désactiver / débloquer / supprimer un accès", "Oui", "Oui", "Non"),
        ("QR code d'accès / réinitialisation du QR", "Oui", "Oui", "Non"),
        ("Envoyer le mot de passe initial par e-mail (adresse enregistrée sur le compte)", "Oui", "Oui", "Non"),
        ("Modifier « Nom et prénom » (répercuté sur toutes les fiches du CIN)", "Oui", "Oui", "Non"),
    ]),
    ("Demandes administratives", [
        ("Liste, détail, traitement (congés, attestations, sorties, parrainages)", "Oui", "Oui", "Non"),
        ("Journal d'envoi (outil de diagnostic mail)", "Oui", "Non", "Oui"),
    ]),
    ("Paramètres techniques", [
        ("Configuration SMTP (consulter, modifier, test d'envoi)", "Oui", "Booléen « configurée » seul", "Oui"),
        ("Tampon / signature électronique / QR des fiches (retiré à l'IT — v0.2.81)", "Oui", "Oui", "Non"),
    ]),
    ("Comptes utilisateurs", [
        ("Lister les comptes", "Oui", "Non", "Oui (consultation seule)"),
        ("Créer un compte RH ou IT", "Oui", "Non", "Non"),
        ("Activer / désactiver / supprimer un compte", "Oui", "Non", "Non"),
        ("Changer le rôle, réinitialiser le mot de passe d'un compte", "Oui", "Non", "Non"),
        ("Modifier un compte IT", "Oui", "Non", "Oui (comptes IT seulement)"),
    ]),
    ("Divers", [
        ("Statistiques", "Oui", "Oui", "Oui"),
        ("Changement de son propre mot de passe (expiration 15 jours)", "Oui", "Oui", "Oui"),
    ]),
]

ONGLETS = [
    ("SuperAdmin (6 onglets)", "Recherche CIN · Toutes les fiches · Importer (+ tampon/signature) · Accès portail · Demandes · Paramètres (SMTP) · Utilisateurs"),
    ("RH (5 onglets)", "tout sauf « Utilisateurs »"),
    ("IT (2 onglets)", "Paramètres (SMTP seul — le tampon et la signature électronique en sont retirés) · Utilisateurs (lecture seule)"),
]

PRINCIPES = [
    "Toute restriction est DOUBLE : réponse 403 côté serveur (code FONCTIONNALITE_NON_AUTORISEE_IT pour le rôle IT) ET masquage de l'élément dans l'interface — jamais l'un sans l'autre.",
    "L'inscription libre (« Créer un compte » avec code d'activation) n'existe plus : les comptes RH et IT sont créés exclusivement par le superadministrateur (onglet Utilisateurs).",
    "Mot de passe expiré (politique 15 jours, tous les comptes) : toute API de données répond 403 jusqu'au changement effectif.",
    "Le portail employé (CIN + mot de passe + code OTP) reste accessible aux employés indépendamment des trois rôles d'administration.",
    "Références : gestion des rôles livrée en v0.2.78 (Task 173), retrait du tampon/signature à l'IT en v0.2.81 (Task 176) — preuves E2E conservées dans scripts/.",
]


def cellule_valeur(c, x, y, largeur, hauteur, texte, couleur):
    c.setFillColor(couleur)
    c.setFont("Serif-B", 8.6)
    c.drawCentredString(x + largeur / 2.0, y + (hauteur - 8.6) / 2.0 + 1.5, texte)


def dessine_annexe():
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setTitle("Auto-RH — README officiel — Annexe : matrice des droits")
    c.setAuthor("Auto-RH")

    num_page = [1]
    # (Task 177) l'en-tête de tableau n'est redessiné que si un saut de page
    # survient PENDANT la matrice — jamais pour les blocs Onglets/Principes.
    etat = {"dans_tableau": False}

    def pied():
        c.setFont("Serif", 8)
        c.setFillColor(GRIS)
        c.drawString(MARGE_G, MARGE_B - 0.45 * cm,
                     "Auto-RH — Documentation technique et README officiel — Annexe A : matrice des droits")
        c.drawRightString(LARG - MARGE_D, MARGE_B - 0.45 * cm, "A-%d" % num_page[0])

    def entete_annexe(continue_):
        if not continue_:
            c.setFillColor(ACCENT)
            c.setFont("Serif-B", 16)
            c.drawString(MARGE_G, HAUT - MARGE_H - 0.05 * cm, "Annexe A — Matrice des droits des rôles")
            c.setFillColor(GRIS)
            c.setFont("Serif", 9.2)
            c.drawString(MARGE_G, HAUT - MARGE_H - 0.62 * cm,
                         "Complément à l'édition condensée (v0.2.65) — état du code vérifié v0.2.81, 25 septembre 2026.")
            c.drawString(MARGE_G, HAUT - MARGE_H - 0.97 * cm,
                         "Trois rôles d'administration : SuperAdmin, RH et IT. Valeurs relevées dans le code livré (gardes serveur).")
            return HAUT - MARGE_H - 1.45 * cm
        c.setFillColor(ACCENT)
        c.setFont("Serif-B", 11)
        c.drawString(MARGE_G, HAUT - MARGE_H, "Annexe A — Matrice des droits (suite)")
        return HAUT - MARGE_H - 0.55 * cm

    y = entete_annexe(False)

    # ---- Tableau ----------------------------------------------------------
    col_f = LARGE_UTILE * 0.46
    col_r = (LARGE_UTILE - col_f) / 3.0
    h_entete = 0.72 * cm
    pad = 0.14 * cm
    pas_ligne = 8.6

    def hauteur_texte(texte, largeur):
        # estimation du nombre de lignes (Serif 9.2)
        mots, lignes, courante = texte.split(), 1, ""
        for m in mots:
            essai = (courante + " " + m).strip()
            if pdfmetrics.stringWidth(essai, "Serif", 9.2) <= largeur - 2 * 6:
                courante = essai
            else:
                lignes += 1
                courante = m
        return lignes

    def nouvelle_page():
        nonlocal y
        pied()
        c.showPage()
        num_page[0] += 1
        y = entete_annexe(True)
        # ré-entête du tableau UNIQUEMENT pendant la matrice
        if etat["dans_tableau"]:
            dessiner_entete_tableau()

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
    etat["dans_tableau"] = True

    for groupe, lignes in GROUPES:
        h_groupe = 0.52 * cm
        if y - h_groupe < MARGE_B:
            nouvelle_page()
        c.setFillColor(FOND_GROUPE)
        c.rect(MARGE_G, y - h_groupe, LARGE_UTILE, h_groupe, stroke=0, fill=1)
        c.setFillColor(ACCENT)
        c.setFont("Serif-B", 9.4)
        c.drawString(MARGE_G + 6, y - h_groupe + (h_groupe - 9.4) / 2 + 1.5, groupe)
        y -= h_groupe

        for texte, v_sup, v_rh, v_it in lignes:
            nl = hauteur_texte(texte, col_f)
            h = max(0.58 * cm, nl * pas_ligne * 0.0353 * cm + 2 * pad)
            if y - h < MARGE_B:
                nouvelle_page()
            # cellule nom
            c.setFillColor(ENCRE)
            c.setFont("Serif", 9.2)
            largeur_texte = col_f - 12
            mots, courante, yy = texte.split(), "", y - pad - 7.5
            for m in mots:
                essai = (courante + " " + m).strip()
                if pdfmetrics.stringWidth(essai, "Serif", 9.2) <= largeur_texte:
                    courante = essai
                else:
                    c.drawString(MARGE_G + 6, yy, courante)
                    yy -= pas_ligne
                    courante = m
            if courante:
                c.drawString(MARGE_G + 6, yy, courante)
            # séparateurs
            c.setStrokeColor(LIGNE)
            c.setLineWidth(0.5)
            for i in (1, 2, 3):
                c.line(MARGE_G + col_f + col_r * i, y - h, MARGE_G + col_f + col_r * i, y)
            c.line(MARGE_G, y - h, MARGE_G + LARGE_UTILE, y - h)
            # valeurs
            cellule_valeur(c, MARGE_G + col_f, y - h, col_r, h, v_sup,
                           VERT_OUI if v_sup == "Oui" else (ROUGE_NON if v_sup == "Non" else GRIS))
            cellule_valeur(c, MARGE_G + col_f + col_r, y - h, col_r, h, v_rh,
                           VERT_OUI if v_rh == "Oui" else (ROUGE_NON if v_rh == "Non" else GRIS))
            cellule_valeur(c, MARGE_G + col_f + col_r * 2, y - h, col_r, h, v_it,
                           VERT_OUI if v_it == "Oui" else (ROUGE_NON if v_it == "Non" else GRIS))
            y -= h

    etat["dans_tableau"] = False

    # ---- Onglets UI (nouvelle page A-2 : onglets + principes) -------------
    def bloc_onglets():
        nonlocal y
        pied()
        c.showPage()
        num_page[0] += 1
        y = entete_annexe(True)
        titre_h = 0.7 * cm
        if y - titre_h < MARGE_B:
            nouvelle_page()
        c.setFillColor(ACCENT)
        c.setFont("Serif-B", 12)
        c.drawString(MARGE_G, y - 0.45 * cm, "Onglets visibles dans l'interface d'administration")
        y -= titre_h + 0.12 * cm
        for nom, detail in ONGLETS:
            nl = hauteur_texte(detail, LARGE_UTILE - 4.6 * cm)
            h = max(0.6 * cm, nl * pas_ligne * 0.0353 * cm + 2 * pad)
            if y - h < MARGE_B:
                nouvelle_page()
            c.setFillColor(ENCRE)
            c.setFont("Serif-B", 9.2)
            c.drawString(MARGE_G, y - pad - 7.5, nom)
            c.setFillColor(ENCRE)
            c.setFont("Serif", 9.2)
            mots, courante, yy = detail.split(), "", y - pad - 7.5
            x_detail = MARGE_G + 4.5 * cm
            for m in mots:
                essai = (courante + " " + m).strip()
                if pdfmetrics.stringWidth(essai, "Serif", 9.2) <= LARGE_UTILE - (x_detail - MARGE_G) - 6:
                    courante = essai
                else:
                    c.drawString(x_detail, yy, courante)
                    yy -= pas_ligne
                    courante = m
            if courante:
                c.drawString(x_detail, yy, courante)
            y -= h
            c.setStrokeColor(LIGNE)
            c.setLineWidth(0.5)
            c.line(MARGE_G, y, MARGE_G + LARGE_UTILE, y)

    def bloc_principes():
        nonlocal y
        titre_h = 0.7 * cm
        if y - titre_h < MARGE_B:
            nouvelle_page()
        c.setFillColor(ACCENT)
        c.setFont("Serif-B", 12)
        c.drawString(MARGE_G, y - 0.45 * cm, "Principes appliqués")
        y -= titre_h + 0.12 * cm
        for p in PRINCIPES:
            nl = hauteur_texte(p, LARGE_UTILE - 0.55 * cm)
            h = nl * pas_ligne * 0.0353 * cm + 2 * pad
            if y - h < MARGE_B:
                nouvelle_page()
            c.setFillColor(ACCENT)
            c.setFont("Serif-B", 9.2)
            c.drawString(MARGE_G, y - pad - 7.5, "•")
            c.setFillColor(ENCRE)
            c.setFont("Serif", 9.2)
            mots, courante, yy = p.split(), "", y - pad - 7.5
            x_puce = MARGE_G + 0.55 * cm
            for m in mots:
                essai = (courante + " " + m).strip()
                if pdfmetrics.stringWidth(essai, "Serif", 9.2) <= LARGE_UTILE - (x_puce - MARGE_G) - 4:
                    courante = essai
                else:
                    c.drawString(x_puce, yy, courante)
                    yy -= pas_ligne
                    courante = m
            if courante:
                c.drawString(x_puce, yy, courante)
            y -= h

    bloc_onglets()
    y -= 0.35 * cm
    bloc_principes()
    pied()
    c.showPage()
    c.save()
    buf.seek(0)
    return buf


def main():
    assert os.path.exists(PDF_CIBLE), "README PDF introuvable : " + PDF_CIBLE
    os.makedirs(os.path.dirname(SAUVEGARDE), exist_ok=True)
    if not os.path.exists(SAUVEGARDE):
        shutil.copy2(PDF_CIBLE, SAUVEGARDE)
        print("Sauvegarde :", SAUVEGARDE)
    else:
        # ré-exécutable : on repart TOUJOURS de l'état avant annexe
        shutil.copy2(SAUVEGARDE, PDF_CIBLE)
        print("Restauration depuis la sauvegarde (état avant annexe).")

    annexe = dessine_annexe()

    # ---- Fusion -----------------------------------------------------------
    lecteur = PdfReader(PDF_CIBLE)
    nb_avant = len(lecteur.pages)
    annexe_reader = PdfReader(annexe)
    nb_annexe = len(annexe_reader.pages)

    ecrivain = PdfWriter()
    for p in lecteur.pages:
        ecrivain.add_page(p)
    for p in annexe_reader.pages:
        ecrivain.add_page(p)
    with open(PDF_CIBLE, "wb") as f:
        ecrivain.write(f)

    # ---- Vérification -----------------------------------------------------
    verif = PdfReader(PDF_CIBLE)
    nb_apres = len(verif.pages)
    assert nb_apres == nb_avant + nb_annexe, "nombre de pages inattendu"
    texte_fin = "\n".join((verif.pages[i].extract_text() or "") for i in range(nb_avant, nb_apres))
    attendus = ["Annexe A", "Matrice des droits", "SuperAdmin", "Journal d'envoi",
                "FONCTIONNALITE_NON_AUTORISEE_IT", "Onglets visibles", "Principes appliqués",
                "v0.2.81"]
    manquants = [a for a in attendus if a not in texte_fin]
    assert not manquants, "texte manquant dans l'annexe : %s" % manquants

    print("OK : %d pages -> %d pages (annexe %d page(s))" % (nb_avant, nb_apres, nb_annexe))
    print("Extraction annexe : tous les marqueurs présents.")


if __name__ == "__main__":
    main()
