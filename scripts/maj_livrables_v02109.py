#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 217 — v0.2.109 : met à jour les QUATRE générateurs de livrables puis les
exécute (ordre : readme → map → formation → zip) et écrit le LIRE-MOI du
correctif dans download/.

Contenu v0.2.109 (accès portail : Matricule / E-mail / Nom / Prénom) :
  1. CORRECTIF COLONNES : l'en-tête « Matricule » (manquant depuis la
     v0.2.107 — 8 en-têtes pour 9 cellules, les matricules s'affichaient sous
     « E-mail d'accès » et toutes les colonnes suivantes étaient décalées)
     est rétabli ENTRE « Prénom » et « E-mail d'accès ».
  2. NOM / PRÉNOM AUTOMATIQUES : le nom complet des fiches de paie est
     DÉCOUPÉ à l'importation — premier mot = Nom, mots suivants = Prénom,
     composés « Ben »/« Bel »/« Bou » conservés ensemble ; remplissage dans
     le répertoire, à la création de l'accès (jamais destructif) et en repli
     d'affichage ; recherche du tableau élargie au prénom.
  3. Au passage : DÉDUPLICATION du principe « Matricule employé dans les
     demandes (v0.2.107) » (présent 3 fois par effet de bord d'un patch
     antérieur de la liste des principes du readme).

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
DOCSTRING_109 = (
    'Task 217 — v0.2.109 : ACCÈS PORTAIL — (1) CORRECTIF COLONNES : l\'en-tête\n'
    '« Matricule » (manquant depuis la v0.2.107 — 8 en-têtes pour 9 cellules, les\n'
    'matricules s\'affichaient sous « E-mail d\'accès » et toutes les colonnes\n'
    'suivantes étaient décalées d\'un rang) est rétabli ENTRE « Prénom » et\n'
    '« E-mail d\'accès » : chaque valeur (matricule, e-mail d\'accès, statut…)\n'
    'retrouve SA colonne ; (2) NOM / PRÉNOM AUTOMATIQUES : le nom complet des\n'
    'fiches de paie est DÉCOUPÉ à l\'importation selon les règles de\n'
    'l\'utilisateur — premier mot = Nom, mots suivants = Prénom, composés\n'
    '« Ben »/« Bel »/« Bou » conservés ensemble (« Saidani Mohamed Amine » →\n'
    'Saidani / Mohamed Amine ; « Ben Hnid Mohamed » → Ben Hnid / Mohamed ;\n'
    '« bou mnijel majdi » → bou mnijel / majdi) — colonnes remplies dans le\n'
    'répertoire des employés, à la création de l\'accès (pré-remplissage jamais\n'
    'destructif : une correction du RH n\'est jamais écrasée) et en repli\n'
    'd\'affichage des accès historiques ; la recherche du tableau porte aussi\n'
    'sur le prénom.\n'
    'Édition précédente — Task 216 — v0.2.108 : RÉPONSE AUX DEMANDES — (1) LIBELLÉS : la consigne'
)

PRINCIPE_109 = (
    '    "Accès portail par mot de passe (v0.2.109) : la colonne « Matricule » dispose de son propre en-tête '
    '(correctif : les valeurs ne s\'affichent plus sous « E-mail d\'accès » — 9 en-têtes pour 9 colonnes) ; les colonnes '
    '« Nom » / « Prénom » sont remplies AUTOMATIQUEMENT depuis les fiches de paie à l\'importation — premier mot = Nom, '
    'mots suivants = Prénom, composés « Ben »/« Bel »/« Bou » conservés ensemble (ex. « Saidani Mohamed Amine » → Nom '
    '« Saidani » / Prénom « Mohamed Amine » ; « Ben Hnid Mohamed » → « Ben Hnid » / « Mohamed » ; « bou mnijel majdi » → '
    '« bou mnijel » / « majdi ») — dans le répertoire des employés, à la création de l\'accès (pré-remplissage jamais '
    'destructif : une correction du RH au crayon n\'est jamais écrasée) et en repli d\'affichage des accès historiques ; '
    'la recherche du tableau porte aussi sur le prénom.",\n'
)

LIGNE_MATRICULE = (
    '    "Matricule employé dans les demandes (v0.2.107) : le matricule extrait des fiches de paie accompagne chaque demande '
    '— colonnes « Matricule » dans « Toutes les fiches », « Accès portail » et « Demandes » (valeur manuelle de l\'accès prioritaire, '
    'sinon fiche la plus récente du CIN) et ligne « Matricule » dans TOUS les e-mails du circuit (création au service traitant, '
    'confirmation au demandeur, changement de statut, notification du document).",\n'
)

PATCH_README = [
    ('"""\nTask 216 — v0.2.108 : RÉPONSE AUX DEMANDES — (1) LIBELLÉS : la consigne',
     '"""\n' + DOCSTRING_109),
    ('"download", "servicerh-readme-technique-v0.2.108.pdf"',
     '"download", "servicerh-readme-technique-v0.2.109.pdf"'),
    ('"/tmp/my-project/servicerh-readme-technique-v0.2.107-avant-v0.2.108.pdf"',
     '"/tmp/my-project/servicerh-readme-technique-v0.2.108-avant-v0.2.109.pdf"'),
    # Déduplication (le principe matricule était triplé) + insertion du
    # principe v0.2.109 juste avant.
    (LIGNE_MATRICULE + LIGNE_MATRICULE + LIGNE_MATRICULE,
     PRINCIPE_109 + LIGNE_MATRICULE),
    ('"A": "Annexe A : matrice des droits des rôles (état du code v0.2.108)"',
     '"A": "Annexe A : matrice des droits des rôles (état du code v0.2.109)"'),
    ('"B": "Annexe B : map de routage des e-mails des demandes (v0.2.108)"',
     '"B": "Annexe B : map de routage des e-mails des demandes (v0.2.109)"'),
    ('AutoRH-Map-routage-emails-demandes-v0.2.108.xlsx » téléchargeable via /api/download-routage.',
     'AutoRH-Map-routage-emails-demandes-v0.2.109.xlsx » téléchargeable via /api/download-routage.'),
    ('"README OFFICIEL · ÉDITION RESSERRÉE · V0.2.108"',
     '"README OFFICIEL · ÉDITION RESSERRÉE · V0.2.109"'),
    ('"v0.2.108 : architecture à deux services (ports 4000 et 4001), fonctionnalités, installation, "',
     '"v0.2.109 : architecture à deux services (ports 4000 et 4001), fonctionnalités, installation, "'),
    ('disponible dans le portail (v0.2.108). Les annexes A ',
     'disponible dans le portail (v0.2.108) ; le tableau « Accès portail par mot de passe » affiche la colonne '
     '« Matricule » sous son propre en-tête et les colonnes « Nom » / « Prénom » remplies automatiquement depuis les '
     'fiches — premier mot = Nom, mots suivants = Prénom, composés « Ben »/« Bel »/« Bou » ensemble (v0.2.109). '
     'Les annexes A '),
    ('Code source livré v0.2.108 · Support de formation RH',
     'Code source livré v0.2.109 · Support de formation RH'),
    ('PART["label"] = "édition resserrée v0.2.108"',
     'PART["label"] = "édition resserrée v0.2.109"'),
    ('disponible dans son portail (v0.2.108). L\'IT est refusé 403 côté serveur ',
     'disponible dans son portail (v0.2.108). Dans « Accès portail par mot de passe », l\'en-tête « Matricule » est '
     'rétabli ENTRE « Prénom » et « E-mail d\'accès » — les valeurs ne s\'affichent plus sous « E-mail d\'accès » — et '
     'les colonnes « Nom » / « Prénom » sont remplies automatiquement depuis les fiches de paie : premier mot = Nom, '
     'mots suivants = Prénom, composés « Ben »/« Bel »/« Bou » conservés ensemble ; corrections au crayon jamais '
     'écrasées (v0.2.109). L\'IT est refusé 403 côté serveur '),
    ('État du code livré v0.2.108 (archive officielle), 29 septembre 2026.',
     'État du code livré v0.2.109 (archive officielle), 29 septembre 2026.'),
    ('Configuration introduite en v0.2.94 — état du code v0.2.108, 29 septembre 2026.',
     'Configuration introduite en v0.2.94 — état du code v0.2.109, 29 septembre 2026.'),
    ('c.setTitle("AutoRH — README officiel — édition resserrée v0.2.108")',
     'c.setTitle("AutoRH — README officiel — édition resserrée v0.2.109")'),
    ('        "Décision par réponse e-mail (v0.2.108)", "« Acceptée » ou « Refusée »",\n'
     '        "Auto-RH (e-mail)",',
     '        "Décision par réponse e-mail (v0.2.108)", "« Acceptée » ou « Refusée »",\n'
     '        "Auto-RH (e-mail)",\n'
     '        # v0.2.109 — accès portail : colonnes alignées + Nom/Prénom automatiques\n'
     '        "Accès portail par mot de passe (v0.2.109)", "« Ben »/« Bel »/« Bou »",\n'
     '        "bou mnijel", "pré-remplissage jamais destructif",'),
    ('print("OK : édition v0.2.108 — %d pages (édition précédente : 14 pages)" % nb)',
     'print("OK : édition v0.2.109 — %d pages (édition précédente : 14 pages)" % nb)'),
]

# ========================================================== map_routage_emails
PATCH_MAP = [
    ('Génère : download/AutoRH-Map-routage-emails-demandes-v0.2.108.xlsx\n'
     '(v0.2.108 : décision par réponse e-mail pour TOUS les types — « Acceptée » / « Refusée » au féminin —, copie RH réservée aux décisions du N+1 ;',
     'Génère : download/AutoRH-Map-routage-emails-demandes-v0.2.109.xlsx\n'
     '(v0.2.109 : « Accès portail » — en-tête « Matricule » rétabli (plus de confusion avec l\'e-mail d\'accès) et colonnes '
     '« Nom » / « Prénom » remplies automatiquement depuis les fiches, composés « Ben »/« Bel »/« Bou » ensemble ;\n'
     'v0.2.108 : décision par réponse e-mail pour TOUS les types — « Acceptée » / « Refusée » au féminin —, copie RH réservée aux décisions du N+1 ;'),
    ('OUT = "/home/z/my-project/download/AutoRH-Map-routage-emails-demandes-v0.2.108.xlsx"',
     'OUT = "/home/z/my-project/download/AutoRH-Map-routage-emails-demandes-v0.2.109.xlsx"'),
    ('setup_sheet(ws, title="AutoRH — Map de routage e-mail des demandes (portail employé, v0.2.108)", last_col=last_col)',
     'setup_sheet(ws, title="AutoRH — Map de routage e-mail des demandes (portail employé, v0.2.109)", last_col=last_col)'),
    ('          "l\'employé et disponible dans son portail ; la copie au service RH n\'est envoyée que lorsque la décision vient du "\n'
     '          "responsable N+1.",',
     '          "l\'employé et disponible dans son portail ; la copie au service RH n\'est envoyée que lorsque la décision vient du "\n'
     '          "responsable N+1. v0.2.109 : dans « Accès portail », la colonne « Matricule » retrouve son propre en-tête "\n'
     '          "(plus de confusion avec l\'e-mail d\'accès) et les colonnes « Nom » / « Prénom » se remplissent automatiquement "\n'
     '          "depuis les fiches de paie — composés « Ben »/« Bel »/« Bou » ensemble.",'),
]

# ================================================= creer_support_formation_rh
PATCH_FORMATION = [
    ('"download", "servicerh-support-formation-rh-v0.2.108.pdf"',
     '"download", "servicerh-support-formation-rh-v0.2.109.pdf"'),
    ('SUPPORT DE FORMATION · ÉQUIPE RH · V0.2.108',
     'SUPPORT DE FORMATION · ÉQUIPE RH · V0.2.109'),
    ('v0.2.108 (les écrans peuvent évoluer légèrement lors des mises à jour).',
     'v0.2.109 (les écrans peuvent évoluer légèrement lors des mises à jour).'),
    ('Contenu vérifié sur le code livré v0.2.108 · README officiel',
     'Contenu vérifié sur le code livré v0.2.109 · README officiel'),
    ('                       "public) ; il n\'est jamais stocké en clair sur le serveur.")',
     '                       "public) ; il n\'est jamais stocké en clair sur le serveur. Depuis la v0.2.109, les "\n'
     '                       "colonnes « Nom » / « Prénom » / « Matricule » se remplissent AUTOMATIQUEMENT depuis les "\n'
     '                       "fiches de paie (premier mot = Nom, mots suivants = Prénom, composés « Ben »/« Bel »/« Bou » "\n'
     '                       "ensemble) et la colonne « Matricule » a de nouveau son propre en-tête — sans confusion "\n'
     '                       "avec l\'e-mail d\'accès.")'),
    ('Version de référence : v0.2.108.',
     'Version de référence : v0.2.109.'),
    ('c.setTitle("AutoRH — Support de formation RH — v0.2.108")',
     'c.setTitle("AutoRH — Support de formation RH — v0.2.109")'),
    ('        # v0.2.108 — réponse aux demandes (libellés féminins, décision tous types)\n'
     '        "Acceptée", "Refusée", "v0.2.108",',
     '        # v0.2.108 — réponse aux demandes (libellés féminins, décision tous types)\n'
     '        "Acceptée", "Refusée", "v0.2.108",\n'
     '        # v0.2.109 — accès portail : colonnes alignées + Nom/Prénom automatiques\n'
     '        "Ben »/« Bel »/« Bou »", "v0.2.109",'),
    ('print("OK : support de formation RH v0.2.108 — %d pages"',
     'print("OK : support de formation RH v0.2.109 — %d pages"'),
]

# =============================================================== creer_zip_lite
PATCH_ZIP = [
    ('VERSION = "v0.2.108"', 'VERSION = "v0.2.109"'),
]

LIRE_MOI = """CORRECTIF AutoRH v0.2.109 — ACCÈS PORTAIL : MATRICULE / E-MAIL / NOM / PRÉNOM
================================================================================

1. CORRECTIF DE LA CONFUSION « MATRICULE » / « E-MAIL D'ACCÈS »
   Depuis la v0.2.107, le tableau « Accès portail par mot de passe » comptait
   9 cellules par ligne mais 8 en-têtes seulement : l'en-tête « Matricule »
   était manquant, les matricules s'affichaient SOUS « E-mail d'accès » et
   toutes les colonnes suivantes étaient décalées d'un rang (l'e-mail sous
   « Statut », etc.).
   CORRIGÉ : l'en-tête « Matricule » est rétabli ENTRE « Prénom » et
   « E-mail d'accès » — chaque valeur (Matricule, E-mail d'accès, Statut,
   Mot de passe changé le, Dernière connexion, Actions) retrouve SA colonne.

2. NOM ET PRÉNOM — DEUX COLONNES DISTINCTES, REMPLIES AUTOMATIQUEMENT
   Le nom complet des fiches de paie n'est plus affiché en bloc dans la
   colonne « Nom » : il est DÉCOUPÉ automatiquement à l'importation selon les
   règles demandées :
     - CAS GÉNÉRAL : le premier mot = Nom, tous les mots suivants = Prénom.
         « Saidani Mohamed Amine » → Nom : Saidani — Prénom : Mohamed Amine
     - NOMS COMPOSÉS « Ben » / « Bel » / « Bou » : le composé (préfixe + mot
       suivant) appartient au Nom.
         « Ben Hnid Mohamed »       → Nom : Ben Hnid — Prénom : Mohamed
         « Bel Agha Mohamed Amine » → Nom : Bel Agha — Prénom : Mohamed Amine
         « bou mnijel majdi »       → Nom : bou mnijel — Prénom : majdi
   Application :
     - Répertoire des employés (/api/payslips/employes) : renvoie Nom,
       Prénom ET nomComplet (chaîne d'origine) ;
     - Création d'un accès : les colonnes « Nom » / « Prénom » sont
       PRÉ-REMPLIES depuis le nom de référence des fiches du CIN — jamais
       destructif (une correction du RH au crayon n'est jamais écrasée) ;
     - Accès historiques : découpage appliqué à l'affichage en repli ;
     - La recherche du tableau porte aussi sur le prénom.
   Toute exception reste corrigeable au crayon (dialogue « Nom » / « Prénom »)
   ; la correction est répercutée dans toutes les fiches de paie de l'employé.

3. PORTÉE
   - Administration (4000) : onglet « Accès portail » (en-têtes alignés,
     colonnes pré-remplies, recherche) ; aucune autre interface touchée.
   - Portail employé (4001) : aucun changement.
   - Scripts : src/lib/nom-employe.ts (NOUVEAU — règles de découpage),
     src/app/api/payslips/employes/route.ts (répertoire),
     src/app/api/portal-access/route.ts (création d'accès),
     src/components/payslip/portal-access-tab.tsx (tableau).

4. PREUVES
   scripts/test_task217_v02109.js — 24/24 OK (7 noms de la matrice de
   découpage via l'API réelle, pré-remplissage à la création, correction RH
   conservée après re-créer, 9 en-têtes alignés dont « Matricule » entre
   « Prénom » et « E-mail d'accès », helper Ben/Bel/Bou).
   Non-régressions : Task 214 36/36 ; Task 215 33/33 ; Task 173 58/58 ;
   Task 174 20/20 ; Task 122 TOUS PASS.

5. DÉPLOIEMENT
   - Identifiants techniques INCHANGÉS (PAIESAGE1, sels auto-rh-*, variables
     AUTO_RH_*, storage/, modèles Prisma, routes API, noms de scripts).
   - Aucune migration de base : aucune colonne ajoutée (db push non requis).
   - build + restart des deux services (4000 administration, 4001 portail).
   - Livrables régénérés : servicerh-readme-technique-v0.2.109.pdf,
     AutoRH-Map-routage-emails-demandes-v0.2.109.xlsx,
     servicerh-support-formation-rh-v0.2.109.pdf,
     servicerh-scripts-site-web-v0.2.109.zip (+ copies génériques).
"""


def main():
    os.chdir(RACINE)
    print("== Patchs des générateurs de livrables (v0.2.109) ==")
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
                            "LIRE-MOI-CORRECTIF-V0.2.109-ACCES-PORTAIL-NOM-PRENOM-MATRICULE.txt")
    with open(lire_moi, "w", encoding="utf-8") as f:
        f.write(LIRE_MOI)
    print("\nOK : %s" % lire_moi)

    # Copie générique du ZIP (le contenu change à chaque édition — les
    # LIRE-MOI-*.txt en sont exclus à la demande de l'utilisateur, Task 166).
    src_zip = os.path.join(RACINE, "download", "servicerh-scripts-site-web-v0.2.109.zip")
    dst_zip = os.path.join(RACINE, "download", "servicerh-scripts-site-web.zip")
    shutil.copy2(src_zip, dst_zip)
    print("OK : copie générique %s" % dst_zip)
    print("Tous les livrables v0.2.109 sont générés.")


if __name__ == "__main__":
    main()
