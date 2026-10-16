#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 216 — v0.2.108 : met à jour les QUATRE générateurs de livrables puis les
exécute (ordre : readme → map → formation → zip) et écrit le LIRE-MOI du
correctif dans download/.

Contenu v0.2.108 (gestion des réponses aux demandes) :
  1. Libellés de la consigne « VALIDATION PAR E-MAIL » au FÉMININ :
     « Accepté » → « Acceptée », « Refusé » → « Refusée » (texte + HTML),
     motif IGNORE aligné (écrire « Acceptée » ou « Refusée »).
  2. Décision par réponse e-mail pour TOUS les types : « Acceptée » /
     « Refusée » — avec ou sans pièce jointe — met le statut à jour
     automatiquement ; la pièce jointe est importée, jointe à l'e-mail de
     l'employé et disponible dans son portail.
  3. Auteur de la décision nommé correctement (« par votre responsable N+1 » /
     « par le service RH ») ; copie au service RH réservée aux décisions du N+1.

Patchs ASSERTIFS et IDEMPOTENTS (ré-exécution sûre).
"""
import os
import shutil
import subprocess
import sys

RACINE = "/home/z/my-project"


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


# ============================================================ maj_readme_v096
DOCSTRING_108 = (
    'Task 216 — v0.2.108 : RÉPONSE AUX DEMANDES — (1) LIBELLÉS : la consigne\n'
    '« VALIDATION PAR E-MAIL » des e-mails de création porte désormais\n'
    '« Acceptée » / « Refusée » (accord féminin avec « demande »), texte et\n'
    'HTML ; (2) DÉCISION PAR RÉPONSE E-MAIL POUR TOUS LES TYPES : « Acceptée »\n'
    'ou « Refusée » — avec ou sans pièce jointe — met le statut à jour\n'
    'automatiquement (traitePar « Responsable N+1 (e-mail) » ou\n'
    '« Auto-RH (e-mail) »), la pièce jointe est importée, jointe à l\'e-mail\n'
    'de l\'employé et disponible dans son portail ; (3) l\'auteur de la décision\n'
    'est nommé correctement dans les e-mails (« par votre responsable N+1 » /\n'
    '« par le service RH ») et la copie au service RH n\'est envoyée que lorsque\n'
    'la décision vient du responsable N+1.\n'
    'Édition précédente — Task 215 — v0.2.107 : AJOUT DU MATRICULE'
)

PRINCIPE_108 = (
    '    "Décision par réponse e-mail (v0.2.108) : la consigne « VALIDATION PAR E-MAIL » porte désormais « Acceptée » / « Refusée » '
    '(accord féminin avec « demande ») ; la décision par réponse e-mail s\'applique à TOUS les types de demandes — « Acceptée » ou « Refusée », '
    'avec ou sans pièce jointe : statut mis à jour automatiquement (traitePar « Responsable N+1 (e-mail) » ou « Auto-RH (e-mail) »), '
    'pièce jointe importée puis jointe à l\'e-mail de l\'employé et disponible dans son portail ; l\'auteur est nommé correctement dans les e-mails '
    'et la copie au service RH n\'est envoyée que lorsque la décision vient du responsable N+1.",\n'
)

PATCH_README = [
    ('"""\nTask 215 — v0.2.107 : AJOUT DU MATRICULE',
     '"""\n' + DOCSTRING_108),
    ('"download", "servicerh-readme-technique-v0.2.107.pdf"',
     '"download", "servicerh-readme-technique-v0.2.108.pdf"'),
    ('"/tmp/my-project/servicerh-readme-technique-v0.2.106-avant-v0.2.107.pdf"',
     '"/tmp/my-project/servicerh-readme-technique-v0.2.107-avant-v0.2.108.pdf"'),
    ('    "Matricule employé dans les demandes (v0.2.107) : le matricule extrait des fiches de paie accompagne chaque demande',
     PRINCIPE_108 + '    "Matricule employé dans les demandes (v0.2.107) : le matricule extrait des fiches de paie accompagne chaque demande'),
    ('"A": "Annexe A : matrice des droits des rôles (état du code v0.2.107)"',
     '"A": "Annexe A : matrice des droits des rôles (état du code v0.2.108)"'),
    ('"B": "Annexe B : map de routage des e-mails des demandes (v0.2.94)"',
     '"B": "Annexe B : map de routage des e-mails des demandes (v0.2.108)"'),
    ('AutoRH-Map-routage-emails-demandes-v0.2.94.xlsx » téléchargeable via /api/download-routage.',
     'AutoRH-Map-routage-emails-demandes-v0.2.108.xlsx » téléchargeable via /api/download-routage.'),
    ('"README OFFICIEL · ÉDITION RESSERRÉE · V0.2.107"',
     '"README OFFICIEL · ÉDITION RESSERRÉE · V0.2.108"'),
    ('"v0.2.107 : architecture à deux services (ports 4000 et 4001), fonctionnalités, installation, "',
     '"v0.2.108 : architecture à deux services (ports 4000 et 4001), fonctionnalités, installation, "'),
    ('accompagne les demandes et leurs e-mails (v0.2.107). Les annexes A ',
     'accompagne les demandes et leurs e-mails (v0.2.107) ; la réponse à une demande exprime une décision '
     '« Acceptée » ou « Refusée » pour TOUS les types, avec pièce jointe transmise par e-mail et disponible '
     'dans le portail (v0.2.108). Les annexes A '),
    ('Code source livré v0.2.107 · Support de formation RH',
     'Code source livré v0.2.108 · Support de formation RH'),
    ('PART["label"] = "édition resserrée v0.2.107"',
     'PART["label"] = "édition resserrée v0.2.108"'),
    ('figure dans la liste « Demandes » et dans TOUS les e-mails du circuit (v0.2.107). L\'IT est refusé 403 côté serveur ',
     'figure dans la liste « Demandes » et dans TOUS les e-mails du circuit (v0.2.107). La décision du traitant — '
     'responsable N+1 ou service RH, quel que soit le type — porte sur « Acceptée » ou « Refusée » : statut mis à jour '
     'automatiquement, pièce jointe éventuelle importée puis jointe à l\'e-mail de l\'employé et disponible dans son '
     'portail (v0.2.108). L\'IT est refusé 403 côté serveur '),
    ('État du code livré v0.2.107 (archive officielle), 28 septembre 2026.',
     'État du code livré v0.2.108 (archive officielle), 29 septembre 2026.'),
    ('Configuration introduite en v0.2.94 — état du code v0.2.107, 28 septembre 2026.',
     'Configuration introduite en v0.2.94 — état du code v0.2.108, 29 septembre 2026.'),
    ('c.setTitle("AutoRH — README officiel — édition resserrée v0.2.107")',
     'c.setTitle("AutoRH — README officiel — édition resserrée v0.2.108")'),
    ('        "récupéré automatiquement depuis ses fiches de paie", "(v0.2.107)",',
     '        "récupéré automatiquement depuis ses fiches de paie", "(v0.2.107)",\n'
     '        # v0.2.108 — réponse aux demandes (libellés féminins, décision tous types)\n'
     '        "Décision par réponse e-mail (v0.2.108)", "« Acceptée » ou « Refusée »",\n'
     '        "Auto-RH (e-mail)",'),
    ('print("OK : édition v0.2.107 — %d pages',
     'print("OK : édition v0.2.108 — %d pages'),
]

# ========================================================== map_routage_emails
PATCH_MAP = [
    ('Génère : download/AutoRH-Map-routage-emails-demandes-v0.2.107.xlsx\n(v0.2.107 : le matricule',
     'Génère : download/AutoRH-Map-routage-emails-demandes-v0.2.108.xlsx\n'
     '(v0.2.108 : décision par réponse e-mail pour TOUS les types — « Acceptée » / « Refusée » au féminin —, '
     'copie RH réservée aux décisions du N+1 ;\nv0.2.107 : le matricule'),
    ('AutoRH-Map-routage-emails-demandes-v0.2.107.xlsx"',
     'AutoRH-Map-routage-emails-demandes-v0.2.108.xlsx"'),
    ('(portail employé, v0.2.107)',
     '(portail employé, v0.2.108)'),
    ('24/24 OK. « Vide » = champ laissé vide dans le panneau SMTP → routage (l\'adresse n\'est jamais obligatoire).",',
     '24/24 OK. « Vide » = champ laissé vide dans le panneau SMTP → routage (l\'adresse n\'est jamais obligatoire). "\n'
     '          "v0.2.108 : la réponse du destinataire prévu décide la demande (« Acceptée » / « Refusée » — libellés au féminin) pour "\n'
     '          "TOUS les types ; le statut est mis à jour automatiquement, la pièce jointe éventuelle est jointe à l\'e-mail de "\n'
     '          "l\'employé et disponible dans son portail ; la copie au service RH n\'est envoyée que lorsque la décision vient du "\n'
     '          "responsable N+1.",'),
]

# ================================================= creer_support_formation_rh
PATCH_FORMATION = [
    ('"download", "servicerh-support-formation-rh-v0.2.107.pdf"',
     '"download", "servicerh-support-formation-rh-v0.2.108.pdf"'),
    ('SUPPORT DE FORMATION · ÉQUIPE RH · V0.2.107',
     'SUPPORT DE FORMATION · ÉQUIPE RH · V0.2.108'),
    ('v0.2.107 (les écrans peuvent évoluer légèrement lors des mises à jour).',
     'v0.2.108 (les écrans peuvent évoluer légèrement lors des mises à jour).'),
    ('Contenu vérifié sur le code livré v0.2.107 · README officiel',
     'Contenu vérifié sur le code livré v0.2.108 · README officiel'),
    ('de paie). L\'employé reçoit le document EN PIÈCE JOINTE et le retrouve signé dans ',
     'de paie). Depuis la v0.2.108, la réponse du traitant exprime une décision « Acceptée » ou « Refusée » pour TOUS les types '
     'de demandes — le statut est mis à jour automatiquement et la pièce jointe éventuelle est importée puis transmise à '
     'l\'employé. L\'employé reçoit le document EN PIÈCE JOINTE et le retrouve signé dans '),
    ('Version de référence : v0.2.107.',
     'Version de référence : v0.2.108.'),
    ('c.setTitle("AutoRH — Support de formation RH — v0.2.107")',
     'c.setTitle("AutoRH — Support de formation RH — v0.2.108")'),
    ('        # v0.2.107 — matricule dans les demandes et leurs e-mails\n        "Matricule", "v0.2.107",',
     '        # v0.2.107 — matricule dans les demandes et leurs e-mails\n        "Matricule", "v0.2.107",\n'
     '        # v0.2.108 — réponse aux demandes (libellés féminins, décision tous types)\n'
     '        "Acceptée", "Refusée", "v0.2.108",'),
    ('print("OK : support de formation RH v0.2.107 — %d pages"',
     'print("OK : support de formation RH v0.2.108 — %d pages"'),
]

# =============================================================== creer_zip_lite
PATCH_ZIP = [
    ('VERSION = "v0.2.107"', 'VERSION = "v0.2.108"'),
]

LIRE_MOI = """CORRECTIF AutoRH v0.2.108 — GESTION DES RÉPONSES AUX DEMANDES
================================================================

1. LIBELLÉS DE LA SECTION « VALIDATION PAR E-MAIL » (accord féminin)
   Dans TOUS les e-mails de création de demande concernés (demande de congé,
   autorisation de sortie), la consigne porte désormais :
     « Accepté  »  →  « Acceptée  »
     « Refusé   »  →  « Refusée   »
   (corps TEXTE et corps HTML ; le motif de rejet des réponses inexploitables
   invite désormais à écrire « Acceptée » ou « Refusée ».)
   Les formes masculines historiques restent comprises par le détecteur : les
   réponses déjà envoyées avec « Accepté » / « Refusé » continuent de fonctionner.

2. DÉCISION PAR RÉPONSE E-MAIL — TOUS LES TYPES DE DEMANDES
   Lorsqu'un responsable N+1 (congé, autorisation de sortie) OU le service RH
   (attestation de travail, attestation de salaire, parrainage) répond à
   l'e-mail de la demande :
     - réponse contenant « Acceptée »  → statut mis à jour automatiquement :
       ACCEPTEE ;
     - réponse contenant « Refusée »   → statut mis à jour automatiquement :
       REFUSEE (avec ou sans pièce jointe) ;
     - réponse avec pièce jointe SANS décision explicite (types RH) :
       comportement historique conservé (demande traitée / acceptée).
   La pièce jointe éventuelle est : importée (dédupliquée par empreinte
   SHA-256, stockée chiffrée), jointe à l'e-mail de notification de l'employé
   ET mise à disposition dans son portail (rubrique « Mes demandes » —
   boutons Visualiser / Télécharger).
   L'auteur est nommé correctement dans les e-mails : « acceptée/refusée par
   votre responsable N+1 » ou « acceptée/refusée par le service RH ». La copie
   au service RH n'est envoyée que lorsque la décision vient du responsable
   N+1 (l'action du service RH n'est pas recopiée au service RH lui-même).

3. PORTÉE
   - Administration (4000) : aucune modification d'interface — le traitement
     Acceptée / Refusée / Information requise existait déjà.
   - Portail employé (4001) : « Mes demandes » affiche déjà le statut et les
     documents de réponse pour tous les types — aucun changement.
   - Scripts : scripts/portail-server.js (consignes, décision, notifications),
     scripts/lib-validation-n1.js (documentation), test harnais test_18.

4. PREUVES
   scripts/test_task216_v02108.js — 34/34 OK (libellés, détecteur, décision
   RH « Refusée »/« Acceptée », document + refus avec pièce jointe jointe à
   l'e-mail, réponse inexploitable, copie RH uniquement pour le N+1).
   Non-régressions : Task 122 TOUS PASS ; Task 173 exit 0 ; Task 174 20/20 ;
   Task 214 36/36 ; Task 215 33/33 ; test_18 62 OK (2 échecs préexistants
   documentés : id HTML « parr-n1 » retiré du portail, dossier api/auth/signup)
   ; Task 178 46 OK (3 échecs préexistants documentés) ; Task 175 25/29
   (4 échecs HTML préexistants documentés).

5. DÉPLOIEMENT
   - Identifiants techniques INCHANGÉS (PAIESAGE1, sels auto-rh-*, variables
     AUTO_RH_*, storage/, modèles Prisma, routes API, noms de scripts).
   - Aucune migration de base : aucune colonne ajoutée (db push non requis).
   - build + restart des deux services (4000 administration, 4001 portail).
   - Livrables régénérés : servicerh-readme-technique-v0.2.108.pdf,
     AutoRH-Map-routage-emails-demandes-v0.2.108.xlsx,
     servicerh-support-formation-rh-v0.2.108.pdf,
     servicerh-scripts-site-web-v0.2.108.zip (+ copies génériques).
"""


def main():
    os.chdir(RACINE)
    print("== Patchs des générateurs de livrables (v0.2.108) ==")
    patcher("scripts/maj_readme_v096.py", PATCH_README)
    patcher("scripts/map_routage_emails.py", PATCH_MAP)
    patcher("scripts/creer_support_formation_rh.py", PATCH_FORMATION)
    patcher("scripts/creer_zip_lite.py", PATCH_ZIP)

    print("\n== Génération des livrables ==")
    for gen in ("scripts/maj_readme_v096.py",
                "scripts/map_routage_emails.py",
                "scripts/creer_support_formation_rh.py",
                "scripts/creer_zip_lite.py"):
        print("--- %s" % gen)
        subprocess.run([sys.executable, gen], cwd=RACINE, check=True)

    lire_moi = os.path.join(RACINE, "download",
                            "LIRE-MOI-CORRECTIF-V0.2.108-REPONSES-DEMANDES.txt")
    with open(lire_moi, "w", encoding="utf-8") as f:
        f.write(LIRE_MOI)
    print("\nOK : %s" % lire_moi)

    # Copie générique du ZIP (le contenu change à chaque édition — les
    # LIRE-MOI-*.txt en sont exclus à la demande de l'utilisateur, Task 166).
    src_zip = os.path.join(RACINE, "download", "servicerh-scripts-site-web-v0.2.108.zip")
    dst_zip = os.path.join(RACINE, "download", "servicerh-scripts-site-web.zip")
    shutil.copy2(src_zip, dst_zip)
    print("OK : copie générique %s" % dst_zip)
    print("Tous les livrables v0.2.108 sont générés.")


if __name__ == "__main__":
    main()
