#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 220 — v0.2.110 : met à jour les QUATRE générateurs de livrables puis les
exécute (ordre : readme → map → formation → zip) et écrit le LIRE-MOI du
correctif dans download/.

Contenu v0.2.110 (2 demandes utilisateur) :
  1. « ACCÈS PORTAIL » — PRÉNOM MODIFIABLE : la colonne « Prénom » du tableau
     « Accès portail par mot de passe » porte son propre crayon d'édition
     (même dialogue Nom + Prénom) ; la modification est enregistrée sur
     l'accès (nom, prenom ET nomPrenom — le nom complet lu par le portail
     employé) et propagée dans toutes les fiches de paie du CIN.
  2. « STATUT DES DEMANDES AVEC PIÈCE JOINTE » (congé / autorisation /
     parrainage) : une réponse contenant explicitement « Acceptée » ou
     « Refusée » pilote TOUJOURS le statut — filet de détection v0.2.110
     pour les décisions écrites en bas de la réponse (sous la citation et la
     consigne « VALIDATION PAR E-MAIL ») ou dans le sujet (radicaux
     explicites « accept… » / « refus… » uniquement : aucun faux positif) ;
     la pièce jointe reste importée, affichée et accessible EN PLUS du
     statut ; le dialogue « Répondre avec un document » de l'administration
     porte une décision explicite (Aucune / Acceptée / Refusée).

Patchs ASSERTIFS et IDEMPOTENTS (ré-exécution sûre).
Les retours à la ligne sont construits via chr(10) pour éviter toute
ambiguïté d'échappement dans les ancres multi-lignes.
"""
import os
import subprocess
import sys

RACINE = "/home/z/my-project"
LN = chr(10)

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

# Définitions Python à injecter dans maj_readme_v096.py (variables module)
DEFS_V110 = (
    "# (NOUVEAU v0.2.110 — Task 220) les DEUX nouveaux principes de mécanique," + LN +
    "# définis en variables pour une insertion lisible dans C_MECANIQUE :" + LN +
    "PRINCIPE_PRENOM = (" + LN +
    '    "' + PRINCIPE_PRENOM + '"' + LN +
    ")" + LN +
    "PRINCIPE_STATUT = (" + LN +
    '    "' + PRINCIPE_STATUT + '"' + LN +
    ")"
)


def patcher(chemin, patches):
    with open(chemin, "r", encoding="utf-8") as f:
        src = f.read()
    for old, new in patches:
        if new in src:
            print("  déjà appliqué (%s) : %r…" % (os.path.basename(chemin), old[:58]))
            continue
        assert old in src, "ANCRE INTROUVABLE dans %s : %r" % (chemin, old[:90])
        src = src.replace(old, new, 1)
    with open(chemin, "w", encoding="utf-8") as f:
        f.write(src)
    print("OK patchs : %s" % chemin)


def main():
    print("== maj_livrables v0.2.110 ==")
    NL = LN  # lisibilité locale

    # ---------- 1) maj_readme_v096.py ----------
    NOUVELLE_EDITION = (
        "Task 220 — v0.2.110 : (1) « ACCÈS PORTAIL » — PRÉNOM MODIFIABLE : la colonne" + NL +
        "« Prénom » du tableau « Accès portail par mot de passe » porte son propre" + NL +
        "crayon d'édition (même dialogue Nom + Prénom) ; la modification est" + NL +
        "enregistrée sur l'accès (nom, prenom et nomPrenom — le nom complet lu par le" + NL +
        "portail employé) et propagée dans toutes les fiches de paie du CIN ;" + NL +
        "(2) « STATUT DES DEMANDES AVEC PIÈCE JOINTE » (congé / autorisation /" + NL +
        "parrainage) : une réponse contenant explicitement « Acceptée » ou « Refusée »" + NL +
        "pilote TOUJOURS le statut — filet de détection des décisions écrites EN BAS" + NL +
        "de la réponse (sous la citation et la consigne) ou dans le SUJET (radicaux" + NL +
        "explicites « accept… » / « refus… » : aucun faux positif depuis le bloc cité) ;" + NL +
        "la pièce jointe reste importée, affichée et accessible EN PLUS du statut" + NL +
        "(jamais « En attente » avec décision explicite) ; le dialogue « Répondre avec" + NL +
        "un document » porte une décision explicite (Aucune / Acceptée / Refusée) —" + NL +
        "sans décision, comportement historique conservé." + NL +
        "Édition précédente — Task 217 — v0.2.109 : ACCÈS PORTAIL — (1) CORRECTIF COLONNES : l'en-tête"
    )
    patcher(
        os.path.join(RACINE, "scripts", "maj_readme_v096.py"),
        [
            (
                "Task 217 — v0.2.109 : ACCÈS PORTAIL — (1) CORRECTIF COLONNES : l'en-tête",
                NOUVELLE_EDITION,
            ),
            (
                'PDF_VERSIONNE = os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.109.pdf")',
                'PDF_VERSIONNE = os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.110.pdf")',
            ),
            (
                'SAUVEGARDE_PRECEDENTE = "/tmp/my-project/servicerh-readme-technique-v0.2.108-avant-v0.2.109.pdf"',
                'SAUVEGARDE_PRECEDENTE = "/tmp/my-project/servicerh-readme-technique-v0.2.109-avant-v0.2.110.pdf"',
            ),
            # Définitions des deux variables (avant C_MECANIQUE = [)
            ("C_MECANIQUE = [", DEFS_V110 + NL + NL + "C_MECANIQUE = ["),
            # Insertion des DEUX éléments dans C_MECANIQUE (fin du principe v0.2.109)
            (
                "la recherche du tableau porte aussi sur le prénom.\"," + NL +
                '    "Matricule employé dans les demandes (v0.2.107)',
                "la recherche du tableau porte aussi sur le prénom.\"," + NL +
                "    PRINCIPE_PRENOM," + NL +
                "    PRINCIPE_STATUT," + NL +
                '    "Matricule employé dans les demandes (v0.2.107)',
            ),
            (
                '"Référence : classeur « AutoRH-Map-routage-emails-demandes-v0.2.109.xlsx » téléchargeable via /api/download-routage.",',
                '"Référence : classeur « AutoRH-Map-routage-emails-demandes-v0.2.110.xlsx » téléchargeable via /api/download-routage.",',
            ),
            (
                '"A": "Annexe A : matrice des droits des rôles (état du code v0.2.109)",',
                '"A": "Annexe A : matrice des droits des rôles (état du code v0.2.110)",',
            ),
            (
                '"B": "Annexe B : map de routage des e-mails des demandes (v0.2.109)",',
                '"B": "Annexe B : map de routage des e-mails des demandes (v0.2.110)",',
            ),
            (
                'bande = espacer("README OFFICIEL · ÉDITION RESSERRÉE · V0.2.109")',
                'bande = espacer("README OFFICIEL · ÉDITION RESSERRÉE · V0.2.110")',
            ),
            (
                '"v0.2.109 : architecture à deux services (ports 4000 et 4001), fonctionnalités, installation, "',
                '"v0.2.110 : architecture à deux services (ports 4000 et 4001), fonctionnalités, installation, "',
            ),
            (
                # État intermédiaire produit par le premier run (segment
                # Ben/Bel/Bou avalé) — réparé ici de façon idempotente.
                "mots suivants = Prénom,  ; la colonne « Prénom » de l'Accès portail est modifiable au crayon",
                "mots suivants = Prénom, composés « Ben »/« Bel »/« Bou » ensemble (v0.2.109) ; la colonne « Prénom » de l'Accès portail est modifiable au crayon",
            ),
            (
                'sources = ("Code source livré v0.2.109 · Support de formation RH (servicerh-support-formation-rh.pdf) · "',
                'sources = ("Code source livré v0.2.110 · Support de formation RH (servicerh-support-formation-rh.pdf) · "',
            ),
            (
                'PART["label"] = "édition resserrée v0.2.109"',
                'PART["label"] = "édition resserrée v0.2.110"',
            ),
        ],
    )

    # ---------- 2) map_routage_emails.py ----------
    chemin_map = os.path.join(RACINE, "scripts", "map_routage_emails.py")
    patcher(
        chemin_map,
        [
            ('OUT = "/home/z/my-project/download/AutoRH-Map-routage-emails-demandes-v0.2.109.xlsx"',
             'OUT = "/home/z/my-project/download/AutoRH-Map-routage-emails-demandes-v0.2.110.xlsx"'),
            ('setup_sheet(ws, title="AutoRH — Map de routage e-mail des demandes (portail employé, v0.2.109)", last_col=last_col)',
             'setup_sheet(ws, title="AutoRH — Map de routage e-mail des demandes (portail employé, v0.2.110)", last_col=last_col)'),
        ],
    )
    with open(chemin_map, "r", encoding="utf-8") as f:
        src = f.read()
    src = src.replace("v0.2.109", "v0.2.110")
    with open(chemin_map, "w", encoding="utf-8") as f:
        f.write(src)
    print("OK versions restantes : map_routage_emails.py")

    # ---------- 3) creer_support_formation_rh.py ----------
    chemin_formation = os.path.join(RACINE, "scripts", "creer_support_formation_rh.py")
    with open(chemin_formation, "r", encoding="utf-8") as f:
        src = f.read()
    src = src.replace("v0.2.109", "v0.2.110").replace("V0.2.109", "V0.2.110")
    with open(chemin_formation, "w", encoding="utf-8") as f:
        f.write(src)
    print("OK versions : creer_support_formation_rh.py")

    # ---------- 4) creer_zip_lite.py ----------
    patcher(
        os.path.join(RACINE, "scripts", "creer_zip_lite.py"),
        [
            ('VERSION = "v0.2.109"', 'VERSION = "v0.2.110"'),
        ],
    )

    # ---------- Exécution (ordre historique) ----------
    for script in ("maj_readme_v096.py", "map_routage_emails.py",
                   "creer_support_formation_rh.py", "creer_zip_lite.py"):
        print(NL + "-- exécution : %s --" % script)
        r = subprocess.run([sys.executable, os.path.join(RACINE, "scripts", script)],
                           cwd=RACINE)
        assert r.returncode == 0, "ÉCHEC : %s" % script

    # ---------- Copie générique du zip (servie par /api/download-scripts) ----------
    src_zip = os.path.join(RACINE, "download", "servicerh-scripts-site-web-v0.2.110.zip")
    gen_zip = os.path.join(RACINE, "download", "servicerh-scripts-site-web.zip")
    if os.path.exists(src_zip):
        import shutil as _sh
        _sh.copy2(src_zip, gen_zip)
        print("OK copie générique : servicerh-scripts-site-web.zip")

    # ---------- LIRE-MOI ----------
    LIRE_MOI = """AutoRH — CORRECTIF v0.2.110 (Task 220)
=============================================

OBJET — deux modifications demandées :

1) ACCÈS PORTAIL — PRÉNOM MODIFIABLE
   - Dans « Accès portail > Accès portail par mot de passe », la colonne
     « Prénom » dispose désormais de son PROPRE crayon d'édition (le même
     dialogue « Nom + Prénom » s'ouvre, champs pré-remplis).
   - La modification est ENREGISTRÉE :
       . sur l'accès portail (colonnes nom, prenom et nomPrenom) ;
       . dans TOUTES les fiches de paie du même CIN (nom complet
         « Prénom Nom », re-chiffré).
   - Elle est PRISE EN COMPTE DANS LE PORTAIL DE L'EMPLOYÉ : le portail lit
     nomPrenom (pré-remplissage de ses demandes, nom affiché).

2) STATUT DES DEMANDES AVEC PIÈCE JOINTE (congé / autorisation / parrainage)
   - PROBLÈME : une décision écrite EN BAS de la réponse e-mail (sous la
     citation de l'e-mail d'origine qui contient la consigne « VALIDATION PAR
     E-MAIL ») ou dans le SUJET n'était pas détectée : la pièce jointe était
     importée mais le statut restait « En attente » (congé / autorisation)
     ou passait « Acceptée » à tort (parrainage).
   - CORRECTIF : filet de détection v0.2.110 — la décision EXPLICITE
     (« accept… » / « refus… », seuls radicaux fiables) est recherchée sur
     l'ENSEMBLE du message (corps + sujet), la consigne étant retirée avec
     précision. Aucun faux positif : les mots vagues (ok, oui, non…) ne
     décident jamais depuis le bloc cité.
   - RÉSULTAT :
       . « Acceptée » + pièce jointe  → statut « Acceptée »  + pièce jointe
         importée, affichée et accessible (détail de la demande, « Mes
         demandes » du portail, jointe à l'e-mail de l'employé) ;
       . « Refusée » + pièce jointe   → statut « Refusée » + pièce jointe ;
       . le statut ne reste JAMAIS « En attente » lorsque la réponse contient
         explicitement « Acceptée » ou « Refusée » ;
       . congé / autorisation avec pièce jointe SANS décision : statut
         inchangé (une décision explicite reste requise) ; parrainage :
         document seul = Acceptée (historique conservé).
   - ADMINISTRATION : le dialogue « Répondre avec un document » porte une
     DÉCISION explicite (Aucune / Acceptée / Refusée). Le statut la reflète
     et la notification e-mail de l'employé porte le bon libellé (« Refusée —
     document disponible »). Sans décision : comportement historique, un
     statut « Refusée » existant n'est jamais écrasé.

TESTS — preuve E2E scripts/test_task220_v02110.js : 40/40 OK
   (filet de détection 7/7 ; prénom modifiable : API → colonnes → portail →
   fiches 8/8 ; réponses e-mail avec pièce jointe congé/autorisation/
   parrainage 15/15 ; réponse admin avec décision 8/8 — puits SMTP 2525,
   nettoyage intégral). Non-régressions : Task 214 36/36, Task 215 33/33,
   Task 216 34/34, Task 217 24/24, Task 173 58/58, Task 174 20/20,
   Task 122 TOUS PASS.

IDENTIFIANTS TECHNIQUES — inchangés (PAIESAGE1, sels, variables AUTO_RH_*,
modèles, ports 4000/4001). Aucune migration de base de données.

LIVRABLES — servicerh-readme-technique-v0.2.110.pdf,
servicerh-support-formation-rh-v0.2.110.pdf,
AutoRH-Map-routage-emails-demandes-v0.2.110.xlsx,
servicerh-scripts-site-web-v0.2.110.zip (+ copie générique
servicerh-scripts-site-web.zip).
"""
    cible = os.path.join(RACINE, "download", "LIRE-MOI-CORRECTIF-V0.2.110-STATUT-PIECE-JOINTE-PRENOM-PORTAIL.txt")
    with open(cible, "w", encoding="utf-8") as f:
        f.write(LIRE_MOI)
    print(NL + "OK LIRE-MOI : %s" % cible)

    # ---------- Discipline download/ : retrait des versions périmées ----------
    perimes = [
        "servicerh-readme-technique-v0.2.109.pdf",
        "servicerh-support-formation-rh-v0.2.109.pdf",
        "servicerh-scripts-site-web-v0.2.109.zip",
        "AutoRH-Map-routage-emails-demandes-v0.2.109.xlsx",
        "LIRE-MOI-CORRECTIF-V0.2.109-ACCES-PORTAIL-NOM-PRENOM-MATRICULE.txt",
    ]
    for nom in perimes:
        p = os.path.join(RACINE, "download", nom)
        if os.path.exists(p):
            os.remove(p)
            print("retiré (périmé) : %s" % nom)
    print(NL + "== TERMINÉ ==")


if __name__ == "__main__":
    main()
