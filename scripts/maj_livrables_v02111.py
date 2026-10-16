#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 221 — v0.2.111 : met à jour les QUATRE générateurs de livrables puis les
exécute (ordre : readme → map → formation → zip) et écrit le LIRE-MOI du
correctif dans download/.

Contenu v0.2.111 (2 demandes utilisateur) :
  1. « CRÉATION DE COMPTES RH / IT » — EXPÉDITEUR = SERVICE INFORMATIQUE :
     l'e-mail d'identification envoyé automatiquement au compte créé part de
     l'ADRESSE DU SERVICE INFORMATIQUE configurée dans le système (panneau
     SMTP → « E-mail du service informatique » — MailConfig.itEmail) :
     en-tête From, enveloppe SMTP et journal d'envoi ; repli historique
     (Mail From) si l'adresse IT est absente ; le message de confirmation du
     superadministrateur affiche l'expéditeur réellement utilisé.
  2. « IMPORT PKCS#12 (.p12 / .pfx) » — MOT DE PASSE CORRECT ACCEPTÉ :
     correctif du lecteur de coffres (la carte renvoyée par getBags() est
     CLÉE PAR L'OID — l'ancienne lecture par le nom « certBag » ne trouvait
     AUCUN certificat, même avec le BON mot de passe, et l'import ne
     réussissait que via le repli openssl CLI, absent des postes Windows) ;
     coffres modernes (AES-256/PBKDF2-SHA256, défaut OpenSSL 3) comme
     legacy (PBE-SHA1-3DES) s'importent ; erreur « mot de passe incorrect »
     affichée UNIQUEMENT lorsqu'un moteur (forge ou openssl) refuse
     explicitement le mot de passe ; fichier corrompu → erreur de STRUCTURE
     (le mot de passe n'est jamais blâmé à tort).

Patchs ASSERTIFS et IDEMPOTENTS (ré-exécution sûre).
Les retours à la ligne sont construits via chr(10) pour éviter toute
ambiguïté d'échappement dans les ancres multi-lignes.
"""
import os
import subprocess
import sys

RACINE = "/home/z/my-project"
LN = chr(10)

PRINCIPE_EXPEDITEUR = (
    "Comptes RH/IT : e-mail de création expédié par le service informatique (v0.2.111) : quand le "
    "superadministrateur crée un compte RH ou IT, l'e-mail d'identification (identifiant, mot de passe initial, "
    "adresse d'accès, changement obligatoire à la première connexion) part DE L'ADRESSE DU SERVICE INFORMATIQUE "
    "configurée dans le système (panneau SMTP → « E-mail du service informatique ») : expéditeur affiché au "
    "destinataire, enveloppe SMTP et journal d'envoi ; repli sur le Mail From historique si l'adresse IT est absente."
)

PRINCIPE_PKCS12 = (
    "Import PKCS#12 (.p12/.pfx) : mot de passe correct accepté (v0.2.111) : correction du lecteur de coffres "
    "(la carte renvoyée par getBags() est cléée par l'OID — l'ancienne lecture par le nom « certBag » ne trouvait "
    "AUCUN certificat, même avec le BON mot de passe, et l'import ne réussissait que via le repli openssl, absent "
    "des postes Windows) : les coffres modernes (AES-256/PBKDF2-SHA256, défaut OpenSSL 3) comme les legacy "
    "(PBE-SHA1-3DES) s'importent dans l'interface ; l'erreur « mot de passe incorrect » n'est affichée que "
    "lorsqu'un moteur (forge ou openssl) refuse explicitement le mot de passe — un fichier corrompu produit une "
    "erreur de STRUCTURE ; .p12, .pfx et formats .p7b/.p7c/.p7s/.p7m/.cer/.crt/.der/.pem/.xml/.ps7x reconnus."
)

# Définitions Python à injecter dans maj_readme_v096.py (variables module)
DEFS_V111 = (
    "# (NOUVEAU v0.2.111 — Task 221) les DEUX nouveaux principes de mécanique," + LN +
    "# définis en variables pour une insertion lisible dans C_MECANIQUE :" + LN +
    "PRINCIPE_EXPEDITEUR = (" + LN +
    '    "' + PRINCIPE_EXPEDITEUR + '"' + LN +
    ")" + LN +
    "PRINCIPE_PKCS12 = (" + LN +
    '    "' + PRINCIPE_PKCS12 + '"' + LN +
    ")"
)

# Phrase sommaire v0.2.110 existante → prolongée par la phrase v0.2.111
PHRASE_110 = (
    "la colonne « Prénom » de l'Accès portail est modifiable au crayon et la modification est répercutée dans "
    "le portail de l'employé et ses fiches, tandis qu'une réponse « Acceptée » ou « Refusée » — même écrite en bas "
    "de message ou dans le sujet — pilote toujours le statut des demandes, la pièce jointe restant affichée en plus "
    "(v0.2.110). Les annexes A "
)
PHRASE_111 = (
    "la colonne « Prénom » de l'Accès portail est modifiable au crayon et la modification est répercutée dans "
    "le portail de l'employé et ses fiches, tandis qu'une réponse « Acceptée » ou « Refusée » — même écrite en bas "
    "de message ou dans le sujet — pilote toujours le statut des demandes, la pièce jointe restant affichée en plus "
    "(v0.2.110) ; l'e-mail de création des comptes RH et IT part de l'adresse du service informatique configurée "
    "(v0.2.111) et l'import des certificats .p12/.pfx accepte enfin le mot de passe correct (lecteur PKCS#12 "
    "corrigé — erreurs classées : mot de passe incorrect seulement si un moteur le refuse explicitement). "
    "Les annexes A "
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
    print("== maj_livrables v0.2.111 ==")
    NL = LN  # lisibilité locale

    # ---------- 1) maj_readme_v096.py ----------
    NOUVELLE_EDITION = (
        "Task 221 — v0.2.111 : (1) COMPTES RH / IT — EXPÉDITEUR = SERVICE INFORMATIQUE :" + NL +
        "l'e-mail d'identification envoyé automatiquement au compte créé part DE L'ADRESSE DU" + NL +
        "SERVICE INFORMATIQUE configurée dans le système (panneau SMTP → « E-mail du service" + NL +
        "informatique ») : expéditeur affiché au destinataire, enveloppe SMTP et journal d'envoi," + NL +
        "repli historique (Mail From) si l'adresse IT est absente ; (2) IMPORT PKCS#12 (.p12/." + NL +
        "pfx) — MOT DE PASSE CORRECT ACCEPTÉ : correctif du lecteur de coffres (carte getBags()" + NL +
        "cléée par l'OID — l'ancienne lecture par le nom « certBag » ne trouvait AUCUN certificat," + NL +
        "même avec le BON mot de passe, et l'import ne réussissait que par le repli openssl CLI" + NL +
        "absent des postes Windows) — coffres modernes (AES-256/PBKDF2-SHA256) comme legacy" + NL +
        "(PBE-SHA1-3DES) s'importent ; « mot de passe incorrect » n'apparaît que si un moteur le" + NL +
        "refuse explicitement, un fichier corrompu produit une erreur de structure." + NL +
        "Édition précédente — Task 220 — v0.2.110 : (1) « ACCÈS PORTAIL » — PRÉNOM MODIFIABLE : la colonne"
    )
    patcher(
        os.path.join(RACINE, "scripts", "maj_readme_v096.py"),
        [
            (
                "Task 220 — v0.2.110 : (1) « ACCÈS PORTAIL » — PRÉNOM MODIFIABLE : la colonne",
                NOUVELLE_EDITION,
            ),
            (
                'PDF_VERSIONNE = os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.110.pdf")',
                'PDF_VERSIONNE = os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.111.pdf")',
            ),
            (
                'SAUVEGARDE_PRECEDENTE = "/tmp/my-project/servicerh-readme-technique-v0.2.109-avant-v0.2.110.pdf"',
                'SAUVEGARDE_PRECEDENTE = "/tmp/my-project/servicerh-readme-technique-v0.2.110-avant-v0.2.111.pdf"',
            ),
            # Définitions des DEUX variables (avant C_MECANIQUE = [)
            ("C_MECANIQUE = [", DEFS_V111 + NL + NL + "C_MECANIQUE = ["),
            # Insertion des DEUX éléments dans C_MECANIQUE (après les principes v0.2.110)
            (
                "    PRINCIPE_PRENOM," + NL + "    PRINCIPE_STATUT,",
                "    PRINCIPE_PRENOM," + NL + "    PRINCIPE_STATUT," + NL +
                "    PRINCIPE_EXPEDITEUR," + NL + "    PRINCIPE_PKCS12,",
            ),
            (
                '"Référence : classeur « AutoRH-Map-routage-emails-demandes-v0.2.110.xlsx » téléchargeable via /api/download-routage.",',
                '"Référence : classeur « AutoRH-Map-routage-emails-demandes-v0.2.111.xlsx » téléchargeable via /api/download-routage.",',
            ),
            (
                '"A": "Annexe A : matrice des droits des rôles (état du code v0.2.110)",',
                '"A": "Annexe A : matrice des droits des rôles (état du code v0.2.111)",',
            ),
            (
                '"B": "Annexe B : map de routage des e-mails des demandes (v0.2.110)",',
                '"B": "Annexe B : map de routage des e-mails des demandes (v0.2.111)",',
            ),
            (
                'bande = espacer("README OFFICIEL · ÉDITION RESSERRÉE · V0.2.110")',
                'bande = espacer("README OFFICIEL · ÉDITION RESSERRÉE · V0.2.111")',
            ),
            (
                '"v0.2.110 : architecture à deux services (ports 4000 et 4001), fonctionnalités, installation, "',
                '"v0.2.111 : architecture à deux services (ports 4000 et 4001), fonctionnalités, installation, "',
            ),
            # Phrase sommaire prolongée (v0.2.111)
            (PHRASE_110, PHRASE_111),
            (
                'sources = ("Code source livré v0.2.110 · Support de formation RH (servicerh-support-formation-rh.pdf) · "',
                'sources = ("Code source livré v0.2.111 · Support de formation RH (servicerh-support-formation-rh.pdf) · "',
            ),
            (
                'PART["label"] = "édition resserrée v0.2.110"',
                'PART["label"] = "édition resserrée v0.2.111"',
            ),
        ],
    )

    # ---------- 2) map_routage_emails.py ----------
    chemin_map = os.path.join(RACINE, "scripts", "map_routage_emails.py")
    patcher(
        chemin_map,
        [
            ('OUT = "/home/z/my-project/download/AutoRH-Map-routage-emails-demandes-v0.2.110.xlsx"',
             'OUT = "/home/z/my-project/download/AutoRH-Map-routage-emails-demandes-v0.2.111.xlsx"'),
            ('setup_sheet(ws, title="AutoRH — Map de routage e-mail des demandes (portail employé, v0.2.110)", last_col=last_col)',
             'setup_sheet(ws, title="AutoRH — Map de routage e-mail des demandes (portail employé, v0.2.111)", last_col=last_col)'),
        ],
    )
    with open(chemin_map, "r", encoding="utf-8") as f:
        src = f.read()
    src = src.replace("v0.2.110", "v0.2.111")
    with open(chemin_map, "w", encoding="utf-8") as f:
        f.write(src)
    print("OK versions restantes : map_routage_emails.py")

    # ---------- 3) creer_support_formation_rh.py ----------
    chemin_formation = os.path.join(RACINE, "scripts", "creer_support_formation_rh.py")
    with open(chemin_formation, "r", encoding="utf-8") as f:
        src = f.read()
    src = src.replace("v0.2.110", "v0.2.111").replace("V0.2.110", "V0.2.111")
    with open(chemin_formation, "w", encoding="utf-8") as f:
        f.write(src)
    print("OK versions : creer_support_formation_rh.py")

    # ---------- 4) creer_zip_lite.py ----------
    patcher(
        os.path.join(RACINE, "scripts", "creer_zip_lite.py"),
        [
            ('VERSION = "v0.2.110"', 'VERSION = "v0.2.111"'),
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
    src_zip = os.path.join(RACINE, "download", "servicerh-scripts-site-web-v0.2.111.zip")
    gen_zip = os.path.join(RACINE, "download", "servicerh-scripts-site-web.zip")
    if os.path.exists(src_zip):
        import shutil as _sh
        _sh.copy2(src_zip, gen_zip)
        print("OK copie générique : servicerh-scripts-site-web.zip")

    # ---------- LIRE-MOI ----------
    LIRE_MOI = """AutoRH — CORRECTIF v0.2.111 (Task 221)
=============================================

OBJET — deux modifications demandées :

1) CRÉATION DE COMPTES RH / IT — EXPÉDITEUR = SERVICE INFORMATIQUE
   - Lorsque le SuperAdmin crée un compte pour un utilisateur RH ou IT,
     l'e-mail contenant les informations de création (identifiant, mot de
     passe initial, adresse d'accès au site d'administration, obligation de
     changement à la première connexion) est envoyé VIA L'ADRESSE E-MAIL DU
     SERVICE INFORMATIQUE configurée dans le système.
   - Cette adresse (panneau SMTP → « E-mail du service informatique »,
     optionnelle) est utilisée COMME EXPÉDITEUR du message : le destinataire
     la voit dans son logiciel de messagerie, l'enveloppe SMTP (MAIL FROM)
     et le journal d'envoi la confirment.
   - Repli : si l'adresse du service informatique n'est pas configurée,
     l'e-mail part de l'expéditeur historique (Mail From, compte SMTP ou nom
     d'application) — l'envoi n'est JAMAIS bloqué.
   - Le message de confirmation affiché au superadministrateur mentionne
     l'expéditeur réellement utilisé ; le dialogue de création rappelle la
     règle ; l'aide du champ « E-mail du service informatique » est mise à
     jour.

2) IMPORTATION D'UN CERTIFICAT PKCS#12 (.p12 / .pfx) — MOT DE PASSE CORRECT
   ACCEPTÉ
   - PROBLÈME : avec le mot de passe CORRECT, l'import affichait
     « Enregistrement impossible : mot de passe PKCS#12 ou fichier
     .p12/.pfx corrompu ».
     CAUSE : le lecteur PKCS#12 lisait la carte renvoyée par getBags() avec
     la clé « certBag » alors qu'elle est CLÉE PAR L'OID du certificat —
     AUCUN certificat n'était donc JAMAIS extrait d'aucun coffre, et l'import
     ne réussissait que par le repli « openssl » (ligne de commande), absent
     des postes Windows des utilisateurs.
   - CORRECTIF :
       . lecture par l'OID + balayage direct des sacs décodés (filet) ;
       . coffres MODERNES (AES-256 / PBKDF2 SHA-256 — défaut d'OpenSSL 3.x)
         et LEGACY (PBE-SHA1-3DES) acceptés avec le mot de passe correct ;
       . coffres exportés SANS mot de passe acceptés (champ vide) ;
       . l'erreur « mot de passe incorrect » n'apparaît QUE lorsqu'un moteur
         (forge ou openssl) refuse EXPLICITEMENT le mot de passe ;
       . un fichier réellement corrompu/non reconnu produit une erreur de
         STRUCTURE — le mot de passe n'est jamais blâmé à tort ;
       . formats toujours reconnus : .p12, .pfx, .p7b, .p7c, .p7s, .p7m,
         .cer, .crt, .der, .pem, .xml, .ps7x.

TESTS — preuve E2E scripts/test_task221_v02111.js : 29/29 OK
  (coffre moderne + bon mot de passe → PKCS#12 importé avec métadonnées ;
  coffre legacy ; .pfx ; mauvais mot de passe → erreur explicite ; mot de
  passe absent → invitation ; corrompu → erreur de structure sans blâmer le
  mot de passe ; .cer toujours importé ; mot de passe jamais renvoyé ;
  comptes RH et IT créés avec e-mail reçu au puits SMTP dont l'en-tête From,
  l'enveloppe et le journal portent l'adresse du service informatique ;
  repli sans adresse IT ; nettoyage complet).
Non-régression : Task 181 formats 62/62, Task 176 24/24, Task 173 58/58,
Task 220 40/40, Task 214 36/36, Task 215 33/33, Task 216 34/34, Task 217
24/24. Vérification navigateur : import d'un .p12 dans l'interface (métado
nnées PKCS#12 affichées) + dialogue de création mis à jour (captures
download/task221-import-p12-interface.png et task221-dialogue-creation-compte.png).

Livré : servicerh-scripts-site-web-v0.2.111.zip (+ copie générique),
servicerh-readme-technique-v0.2.111.pdf, servicerh-support-formation-rh.pdf,
AutoRH-Map-routage-emails-demandes-v0.2.111.xlsx.
"""
    chemin_lm = os.path.join(RACINE, "download", "LIRE-MOI-CORRECTIF-V0.2.111-COMPTES-EXPEDITEUR-IT-IMPORT-PKCS12.txt")
    with open(chemin_lm, "w", encoding="utf-8") as f:
        f.write(LIRE_MOI)
    copie_racine = os.path.join(RACINE, "LIRE-MOI-CORRECTIF-V0.2.111-COMPTES-EXPEDITEUR-IT-IMPORT-PKCS12.txt")
    with open(copie_racine, "w", encoding="utf-8") as f:
        f.write(LIRE_MOI)
    print("OK LIRE-MOI : %s (+ racine)" % os.path.basename(chemin_lm))


if __name__ == "__main__":
    main()
