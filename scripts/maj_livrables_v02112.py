#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 222 — v0.2.112 : met à jour les QUATRE générateurs de livrables puis les
exécute (ordre : readme → map → formation → zip) et écrit le LIRE-MOI du
correctif dans download/.

Contenu v0.2.112 (demande utilisateur) :
  « IMPORT DES CERTIFICATS ÉLECTRONIQUES + CLÉS PRIVÉES ASSOCIÉES dans la
   réponse aux demandes ET l'importation fiche de paie » :
   - certificats SEULS acceptés quand la clé privée est DÉJÀ DISPONIBLE dans
     le système — association VÉRIFIÉE par appariement cryptographique
     (la clé signe, la clé publique du certificat vérifie) ; appariement
     négatif → erreur explicite (jamais d'association aveugle) ;
   - certificats ACCOMPAGNÉS DE LEUR CLÉ PRIVÉE — coffre .p12/.pfx (clé du
     coffre, mot de passe chiffré) OU fichier de clé séparé .pem/.key/.der
     (PKCS#8/PKCS#1, clair ou chiffré, mot de passe chiffré en base) ;
     PEM COMBINÉ (CERTIFICATE + PRIVATE KEY) reconnu — clé extraite
     automatiquement et appariée ;
   - FORMATS APPROPRIÉS : .p12/.pfx pour un certificat avec sa clé,
     .pem/.cer/.crt/.der/.p7b/.p7c/.pkcs7/.p7s/.p7m/.xml/.ps7x pour un
     certificat seul, .pem/.key/.der pour une clé privée ;
   - interfaces : le DIALOGUE « Répondre avec un document » porte son
     PROPRE import de certificat (réponse au demande), les panneaux
     « Signature électronique & QR code » (Import) et « Configuration des
     réponses » gèrent la clé privée associée + l'état de disponibilité ;
   - fichiers de clé chiffrés au repos (AES-256-GCM, storage/tampons/
     cle-privee-…), mots de passe chiffrés en base, jamais renvoyés.

Patchs ASSERTIFS et IDEMPOTENTS (ré-exécution sûre).
Les retours à la ligne sont construits via chr(10) pour éviter toute
ambiguïté d'échappement dans les ancres multi-lignes.
"""
import os
import subprocess
import sys

RACINE = "/home/z/my-project"
LN = chr(10)

PRINCIPE_CERT_CLE = (
    "Certificats électroniques + clés privées associées (v0.2.112) : un certificat peut être importé SEUL "
    "lorsque la clé privée est déjà disponible dans le système — l'association est VÉRIFIÉE par appariement "
    "cryptographique (la clé signe, la clé publique du certificat vérifie) et un appariement négatif produit "
    "une erreur explicite (jamais d'association aveugle) ; un certificat peut être importé AVEC sa clé privée "
    "— coffre .p12/.pfx (clé incluse, mot de passe chiffré) ou fichier de clé séparé .pem/.key/.der "
    "(PKCS#8/PKCS#1, clair ou chiffré) ; un PEM combiné (certificat + clé dans le même fichier) est reconnu "
    "et la clé est extraite automatiquement ; fichiers de clé chiffrés au repos (AES-256-GCM) et mots de "
    "passe chiffrés en base, jamais renvoyés à l'interface."
)

PRINCIPE_CERT_INTERFACES = (
    "Import des certificats dans la réponse aux demandes et l'importation des fiches (v0.2.112) : le dialogue "
    "« Répondre avec un document » de l'onglet Demandes porte son PROPRE import de certificat électronique "
    "(certificat + clé privée au besoin, état de disponibilité affiché), le panneau « Signature électronique "
    "& QR code » de l'onglet Importation et le panneau « Configuration des réponses » acceptent la CLÉ PRIVÉE "
    "ASSOCIÉE (.pem/.key/.der) en plus du certificat — les fichiers sont stockés chiffrés, retirés avec le "
    "certificat, et l'état « clé privée disponible dans le système » est calculé par l'API."
)

# Définitions Python à injecter dans maj_readme_v096.py (variables module)
DEFS_V112 = (
    "# (NOUVEAU v0.2.112 — Task 222) les DEUX nouveaux principes de mécanique," + LN +
    "# définis en variables pour une insertion lisible dans C_MECANIQUE :" + LN +
    "PRINCIPE_CERT_CLE = (" + LN +
    '    "' + PRINCIPE_CERT_CLE + '"' + LN +
    ")" + LN +
    "PRINCIPE_CERT_INTERFACES = (" + LN +
    '    "' + PRINCIPE_CERT_INTERFACES + '"' + LN +
    ")"
)

# Phrase sommaire v0.2.111 existante → prolongée par la phrase v0.2.112
PHRASE_111 = (
    "l'e-mail de création des comptes RH et IT part de l'adresse du service informatique configurée "
    "(v0.2.111) et l'import des certificats .p12/.pfx accepte enfin le mot de passe correct (lecteur PKCS#12 "
    "corrigé — erreurs classées : mot de passe incorrect seulement si un moteur le refuse explicitement). "
    "Les annexes A "
)
PHRASE_112 = (
    "l'e-mail de création des comptes RH et IT part de l'adresse du service informatique configurée "
    "(v0.2.111) et l'import des certificats .p12/.pfx accepte enfin le mot de passe correct (lecteur PKCS#12 "
    "corrigé — erreurs classées : mot de passe incorrect seulement si un moteur le refuse explicitement) "
    "(v0.2.111) ; les certificats électroniques et leurs clés privées s'importent dans la réponse aux demandes "
    "et l'importation des fiches — certificat seul accepté quand la clé privée est déjà dans le système "
    "(association vérifiée cryptographiquement), coffre .p12/.pfx ou clé séparée .pem/.key/.der, PEM combiné "
    "reconnu (v0.2.112). Les annexes A "
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
    print("== maj_livrables v0.2.112 ==")
    NL = LN  # lisibilité locale

    # ---------- 1) maj_readme_v096.py ----------
    NOUVELLE_EDITION = (
        "Task 222 — v0.2.112 : IMPORT DES CERTIFICATS ÉLECTRONIQUES + CLÉS PRIVÉES ASSOCIÉES dans" + NL +
        "la réponse aux demandes ET l'importation fiche de paie : certificat SEUL accepté quand la clé" + NL +
        "privée est DÉJÀ DISPONIBLE dans le système (association VÉRIFIÉE par appariement cryptogra-" + NL +
        "phique — la clé signe, la clé publique du certificat vérifie ; refus explicite si négatif) ;" + NL +
        "certificat ACCOMPAGNÉ DE SA CLÉ PRIVÉE : coffre .p12/.pfx (clé incluse, mot de passe chiffré)" + NL +
        "OU clé séparée .pem/.key/.der (PKCS#8/PKCS#1, claire ou chiffrée) ; PEM COMBINÉ (CERTIFICATE +" + NL +
        "PRIVATE KEY) reconnu — clé extraite automatiquement ; formats .p12/.pfx pour un certificat avec" + NL +
        "sa clé, .pem/.cer/.crt/.der/.p7b/… pour un certificat seul ; le DIALOGUE « Répondre avec un" + NL +
        "document » porte son propre import de certificat, les panneaux Import et Configuration des" + NL +
        "réponses gèrent la clé privée associée et l'état de disponibilité ; fichiers chiffrés au repos." + NL +
        "Édition précédente — Task 221 — v0.2.111 : (1) COMPTES RH / IT — EXPÉDITEUR = SERVICE INFORMATIQUE :"
    )
    patcher(
        os.path.join(RACINE, "scripts", "maj_readme_v096.py"),
        [
            (
                "Task 221 — v0.2.111 : (1) COMPTES RH / IT — EXPÉDITEUR = SERVICE INFORMATIQUE :",
                NOUVELLE_EDITION,
            ),
            (
                'PDF_VERSIONNE = os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.111.pdf")',
                'PDF_VERSIONNE = os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.112.pdf")',
            ),
            (
                'SAUVEGARDE_PRECEDENTE = "/tmp/my-project/servicerh-readme-technique-v0.2.110-avant-v0.2.111.pdf"',
                'SAUVEGARDE_PRECEDENTE = "/tmp/my-project/servicerh-readme-technique-v0.2.111-avant-v0.2.112.pdf"',
            ),
            # Définitions des DEUX variables (avant C_MECANIQUE = [)
            ("C_MECANIQUE = [", DEFS_V112 + NL + NL + "C_MECANIQUE = ["),
            # Insertion des DEUX éléments dans C_MECANIQUE (après les principes v0.2.111)
            (
                "    PRINCIPE_EXPEDITEUR," + NL + "    PRINCIPE_PKCS12,",
                "    PRINCIPE_EXPEDITEUR," + NL + "    PRINCIPE_PKCS12," + NL +
                "    PRINCIPE_CERT_CLE," + NL + "    PRINCIPE_CERT_INTERFACES,",
            ),
            (
                '"Référence : classeur « AutoRH-Map-routage-emails-demandes-v0.2.111.xlsx » téléchargeable via /api/download-routage.",',
                '"Référence : classeur « AutoRH-Map-routage-emails-demandes-v0.2.112.xlsx » téléchargeable via /api/download-routage.",',
            ),
            (
                '"A": "Annexe A : matrice des droits des rôles (état du code v0.2.111)",',
                '"A": "Annexe A : matrice des droits des rôles (état du code v0.2.112)",',
            ),
            (
                '"B": "Annexe B : map de routage des e-mails des demandes (v0.2.111)",',
                '"B": "Annexe B : map de routage des e-mails des demandes (v0.2.112)",',
            ),
            (
                'bande = espacer("README OFFICIEL · ÉDITION RESSERRÉE · V0.2.111")',
                'bande = espacer("README OFFICIEL · ÉDITION RESSERRÉE · V0.2.112")',
            ),
            (
                '"v0.2.111 : architecture à deux services (ports 4000 et 4001), fonctionnalités, installation, "',
                '"v0.2.112 : architecture à deux services (ports 4000 et 4001), fonctionnalités, installation, "',
            ),
            # Phrase sommaire prolongée (v0.2.112)
            (PHRASE_111, PHRASE_112),
            (
                'sources = ("Code source livré v0.2.111 · Support de formation RH (servicerh-support-formation-rh.pdf) · "',
                'sources = ("Code source livré v0.2.112 · Support de formation RH (servicerh-support-formation-rh.pdf) · "',
            ),
            (
                'PART["label"] = "édition resserrée v0.2.111"',
                'PART["label"] = "édition resserrée v0.2.112"',
            ),
        ],
    )

    # ---------- 2) map_routage_emails.py ----------
    chemin_map = os.path.join(RACINE, "scripts", "map_routage_emails.py")
    patcher(
        chemin_map,
        [
            ('OUT = "/home/z/my-project/download/AutoRH-Map-routage-emails-demandes-v0.2.111.xlsx"',
             'OUT = "/home/z/my-project/download/AutoRH-Map-routage-emails-demandes-v0.2.112.xlsx"'),
            ('setup_sheet(ws, title="AutoRH — Map de routage e-mail des demandes (portail employé, v0.2.111)", last_col=last_col)',
             'setup_sheet(ws, title="AutoRH — Map de routage e-mail des demandes (portail employé, v0.2.112)", last_col=last_col)'),
        ],
    )
    with open(chemin_map, "r", encoding="utf-8") as f:
        src = f.read()
    src = src.replace("v0.2.111", "v0.2.112")
    with open(chemin_map, "w", encoding="utf-8") as f:
        f.write(src)
    print("OK versions restantes : map_routage_emails.py")

    # ---------- 3) creer_support_formation_rh.py ----------
    chemin_formation = os.path.join(RACINE, "scripts", "creer_support_formation_rh.py")
    with open(chemin_formation, "r", encoding="utf-8") as f:
        src = f.read()
    src = src.replace("v0.2.111", "v0.2.112").replace("V0.2.111", "V0.2.112")
    with open(chemin_formation, "w", encoding="utf-8") as f:
        f.write(src)
    print("OK versions : creer_support_formation_rh.py")

    # ---------- 4) creer_zip_lite.py ----------
    patcher(
        os.path.join(RACINE, "scripts", "creer_zip_lite.py"),
        [
            ('VERSION = "v0.2.111"', 'VERSION = "v0.2.112"'),
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
    src_zip = os.path.join(RACINE, "download", "servicerh-scripts-site-web-v0.2.112.zip")
    gen_zip = os.path.join(RACINE, "download", "servicerh-scripts-site-web.zip")
    if os.path.exists(src_zip):
        import shutil as _sh
        _sh.copy2(src_zip, gen_zip)
        print("OK copie générique : servicerh-scripts-site-web.zip")

    # ---------- LIRE-MOI ----------
    LIRE_MOI = """AutoRH — CORRECTIF v0.2.112 (Task 222)
=============================================

OBJET — import des certificats électroniques + clés privées associées,
dans la réponse aux demandes ET l'importation fiche de paie :

Le système prend en charge les TROIS cas demandés :

1) CERTIFICATS SEULS lorsque la clé privée est DÉJÀ DISPONIBLE dans le
   système
   - un certificat (.pem, .cer, .crt, .der, .p7b, .p7c, .pkcs7, .p7s,
     .p7m, .xml, .ps7x) importé SEUL est accepté quand une clé privée
     est déjà enregistrée (fichier de clé séparé ou coffre .p12/.pfx
     précédent) ;
   - l'association est VÉRIFIÉE : la clé signe un bloc de test, la clé
     publique du certificat vérifie la signature (appariement crypto-
     graphique réel) ;
   - appariement négatif → erreur explicite « Le certificat importé ne
     correspond pas à la clé privée déjà disponible… » — jamais
     d'association aveugle ;
   - si la clé venait d'un ancien coffre remplacé, elle est ré-enregis-
     trée automatiquement comme fichier de clé (l'association survit).

2) CERTIFICATS ACCOMPAGNÉS DE LEUR CLÉ PRIVÉE
   - coffre .p12/.pfx : le certificat ET sa clé privée arrivent ensemble
     (le mot de passe du coffre, s'il existe, est demandé et stocké
     chiffré) ;
   - clé privée SÉPARÉE : un fichier .pem, .key ou .der (PKCS#8 ou
     PKCS#1, clair ou chiffré) peut être importé avec le certificat —
     l'appariement certificat↔clé est vérifié avant l'enregistrement ;
   - PEM COMBINÉ : un .pem contenant CERTIFICATE + PRIVATE KEY est
     reconnu et la clé est extraite AUTOMATIQUEMENT ;
   - clé chiffrée : le mot de passe de la clé est demandé au besoin ;
     erreurs classées (« Clé privée protégée : saisissez le mot de
     passe » / « Mot de passe de la clé privée incorrect » / fichier
     illisible) — le mot de passe n'est jamais blâmé à tort.

3) FORMATS APPROPRIÉS
   - .p12 / .pfx pour un certificat avec sa clé privée ;
   - .pem, .cer, .crt, .der, .p7b, .p7c, .pkcs7, .p7s, .p7m, .xml,
     .ps7x pour un certificat seul ;
   - .pem, .key, .der pour une clé privée seule.

OÙ IMPORTER ?
   - Réponse aux DEMANDES : le dialogue « Répondre avec un document »
     porte désormais son PROPRE bloc « Certificat de signature
     électronique » (état importé/clé disponible, import, remplacement,
     clé privée) — sans quitter la réponse ;
   - IMPORTATION FICHE DE PAIE : le panneau « Signature électronique &
     QR code » (onglet Importation) accepte la clé privée associée ;
   - CONFIGURATION DES RÉPONSES (onglet Demandes) : même gestion DÉDIÉE.

SÉCURITÉ
   - fichiers de clé privée chiffrés au repos (AES-256-GCM,
     storage/tampons/cle-privee-…, droits 0600/0700) ;
   - mots de passe (coffre et clé) chiffrés en base, JAMAIS renvoyés à
     l'interface (booléens seuls) ;
   - retrait du certificat → la clé privée associée est retirée aussi ;
   - le rôle IT reste sans accès (403 + masquage interface).

TESTS — preuve E2E scripts/test_task222_v02112.js : 31/31 OK
  (certificat seul + clé déjà disponible accepté ; appariement négatif
  refusé côté clé ET côté certificat, avec clé séparée comme avec un
  coffre ; clé PKCS#1/PKCS#8 claire et chiffrée — bon/mauvais mot de
  passe ; PEM combiné extrait automatiquement ; coffre moderne et
  legacy ; disponibilité calculée ; retraits propres ; secrets jamais
  renvoyés ; IT 403 ; les deux sections Import ET Réponses).
Non-régression : Task 221 29/29, Task 181 formats 62/62, Task 220
40/40, Task 173 58/58, Task 214 36/36, Task 215 33/33, Task 216 34/34,
Task 217 24/24. Vérification navigateur : import réel d'un certificat
+ clé privée DANS le dialogue de réponse (métadonnées + clé « DISPONI-
BLE » affichées), champ clé privée présent dans les deux panneaux
(captures download/task222-certificat-dialogue-reponse.png,
task222-panneau-import-cle.png, task222-panneau-reponses-cle.png).

Livré : servicerh-scripts-site-web-v0.2.112.zip (+ copie générique),
servicerh-readme-technique-v0.2.112.pdf, servicerh-support-formation-rh.pdf,
AutoRH-Map-routage-emails-demandes-v0.2.112.xlsx.
"""
    chemin_lm = os.path.join(RACINE, "download", "LIRE-MOI-CORRECTIF-V0.2.112-CERTIFICATS-CLES-PRIVEES-REPONSE-IMPORT.txt")
    with open(chemin_lm, "w", encoding="utf-8") as f:
        f.write(LIRE_MOI)
    copie_racine = os.path.join(RACINE, "LIRE-MOI-CORRECTIF-V0.2.112-CERTIFICATS-CLES-PRIVEES-REPONSE-IMPORT.txt")
    with open(copie_racine, "w", encoding="utf-8") as f:
        f.write(LIRE_MOI)
    print("OK LIRE-MOI : %s (+ racine)" % os.path.basename(chemin_lm))


if __name__ == "__main__":
    main()
