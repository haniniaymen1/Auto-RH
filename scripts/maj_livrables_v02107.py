#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 215 — v0.2.107 : met à jour les QUATRE générateurs de livrables puis
les exécute (README PDF, map de routage xlsx, support de formation PDF, ZIP).

Contenu v0.2.107 (matricule) :
  - Le matricule extrait des fiches de paie est utilisé dans tout le portail :
    colonne « Matricule » dans « Toutes les fiches », « Accès portail »
    (modifiable comme le nom / prénom / e-mail, répercuté sur toutes les
    fiches du CIN) et « Demandes » (auto-association par CIN) ;
  - ligne « Matricule » dans TOUS les e-mails des demandes (création au
    service traitant, confirmation au demandeur, changement de statut,
    notification du document-réponse avec pièce jointe) — les 5 types.

Chaque remplacement est protégé par une assertion (ancrage unique) : le
script échoue bruyamment si le code source n'est plus dans l'état attendu.
"""
import os
import subprocess
import sys

RACINE = "/home/z/my-project"


def patcher(chemin, remplacements):
    with open(chemin, "r", encoding="utf-8") as f:
        texte = f.read()
    appliques = 0
    for ancien, nouveau in remplacements:
        if texte.count(ancien) == 1:
            texte = texte.replace(ancien, nouveau)
            appliques += 1
        elif ancien in texte:
            raise SystemExit(
                "ANCRAGE non unique (%d) dans %s : %r"
                % (texte.count(ancien), chemin, ancien[:70])
            )
        elif nouveau in texte:
            # déjà appliqué lors d'une exécution précédente — idempotent
            pass
        else:
            raise SystemExit(
                "ANCRAGE introuvable dans %s : %r" % (chemin, ancien[:70])
            )
    with open(chemin, "w", encoding="utf-8") as f:
        f.write(texte)
    print("OK : %s (%d remplacements)" % (os.path.basename(chemin), appliques))


def lancer(cmd):
    print("→", " ".join(cmd))
    r = subprocess.run(cmd, cwd=RACINE, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout[-3000:])
        print(r.stderr[-3000:])
        raise SystemExit("ÉCHEC : " + " ".join(cmd))
    print(r.stdout[-1200:])


# =========================================================================
# 1) README — scripts/maj_readme_v096.py
# =========================================================================
readme = os.path.join(RACINE, "scripts", "maj_readme_v096.py")
patcher(readme, [
    # a) docstring : historique v0.2.107 en tête
    (
        "Task 214 — v0.2.106 : (1) E-MAIL AUTOMATIQUE DE CRÉATION DE COMPTE — la création",
        "Task 215 — v0.2.107 : AJOUT DU MATRICULE — le matricule extrait des fiches de\n"
        "paie est utilisé dans tout le portail : colonne « Matricule » dans « Toutes les\n"
        "fiches », « Accès portail » (MODIFIABLE comme le nom / prénom / e-mail, valeur\n"
        "répercutée dans toutes les fiches du CIN, effacement = repli sur\n"
        "l'auto-association) et « Demandes » (auto-associé au CIN de l'employé) ; la\n"
        "ligne « Matricule » figure dans TOUS les e-mails des demandes (création au\n"
        "service traitant, confirmation au demandeur, changement de statut,\n"
        "notification du document-réponse) pour les 5 types de demandes.\n"
        "Édition précédente — Task 214 — v0.2.106 : (1) E-MAIL AUTOMATIQUE DE CRÉATION DE COMPTE — la création"
    ),
    (
        'PDF_VERSIONNE = os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.106.pdf")',
        'PDF_VERSIONNE = os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.107.pdf")'
    ),
    (
        'SAUVEGARDE_PRECEDENTE = "/tmp/my-project/servicerh-readme-technique-v0.2.105-avant-v0.2.106.pdf"',
        'SAUVEGARDE_PRECEDENTE = "/tmp/my-project/servicerh-readme-technique-v0.2.106-avant-v0.2.107.pdf"'
    ),
    # b) bande de couverture (restée à V0.2.105 lors de l'édition précédente)
    (
        'bande = espacer("README OFFICIEL · ÉDITION RESSERRÉE · V0.2.105")',
        'bande = espacer("README OFFICIEL · ÉDITION RESSERRÉE · V0.2.107")'
    ),
    # c) annexe A — matrice des droits : nouvelle ligne matricule
    (
        '("Modifier « Nom » / « Prénom » — deux colonnes séparées (v0.2.106), répercuté sur toutes les fiches du CIN, compatibilité « Nom et prénom » conservée", "Oui", "Oui", "Non"),',
        '("Modifier « Nom » / « Prénom » — deux colonnes séparées (v0.2.106), répercuté sur toutes les fiches du CIN, compatibilité « Nom et prénom » conservée", "Oui", "Oui", "Non"),\n'
        '("Consulter / modifier le « Matricule » de l\'employé — auto-associé depuis ses fiches de paie, répercuté sur toutes les fiches du CIN (v0.2.107)", "Oui", "Oui", "Non"),'
    ),
    # d) mécanique des e-mails : nouvelle ligne matricule
    (
        '(ils possèdent déjà le document).",',
        '(ils possèdent déjà le document).",\n'
        '    "Matricule employé dans les demandes (v0.2.107) : le matricule extrait des fiches de paie accompagne chaque demande — colonnes « Matricule » dans « Toutes les fiches », « Accès portail » et « Demandes » (valeur manuelle de l\'accès prioritaire, sinon fiche la plus récente du CIN) et ligne « Matricule » dans TOUS les e-mails du circuit (création au service traitant, confirmation au demandeur, changement de statut, notification du document).",'
    ),
    # e) étiquettes « état du code » passent en v0.2.107
    (
        '"A": "Annexe A : matrice des droits des rôles (état du code v0.2.106)",',
        '"A": "Annexe A : matrice des droits des rôles (état du code v0.2.107)",'
    ),
    (
        '"v0.2.106 : architecture à deux services (ports 4000 et 4001), fonctionnalités, installation, "',
        '"v0.2.107 : architecture à deux services (ports 4000 et 4001), fonctionnalités, installation, "'
    ),
    (
        '"document de réponse (v0.2.106). Les annexes A "',
        '"document de réponse (v0.2.106) ; le matricule de l\'employé, extrait de ses fiches de paie, '
        'accompagne les demandes et leurs e-mails (v0.2.107). Les annexes A "'
    ),
    (
        'sources = ("Code source livré v0.2.106 · Support de formation RH (servicerh-support-formation-rh.pdf) · "',
        'sources = ("Code source livré v0.2.107 · Support de formation RH (servicerh-support-formation-rh.pdf) · "'
    ),
    (
        'PART["label"] = "édition resserrée v0.2.106"',
        'PART["label"] = "édition resserrée v0.2.107"'
    ),
    # f) puce « Demandes administratives » : mention du matricule
    (
        '"pièce jointe du document final, en plus du stockage portail). L\'IT est refusé 403 côté serveur "',
        '"pièce jointe du document final, en plus du stockage portail). Le matricule de l\'employé — "\n'
        '             "récupéré automatiquement depuis ses fiches de paie (valeur manuelle de l\'accès prioritaire) — "\n'
        '             "figure dans la liste « Demandes » et dans TOUS les e-mails du circuit (v0.2.107). L\'IT est refusé 403 côté serveur "'
    ),
    (
        '"État du code livré v0.2.106 (archive officielle), 28 septembre 2026.")',
        '"État du code livré v0.2.107 (archive officielle), 28 septembre 2026.")'
    ),
    (
        '"Configuration introduite en v0.2.94 — état du code v0.2.106, 28 septembre 2026.")',
        '"Configuration introduite en v0.2.94 — état du code v0.2.107, 28 septembre 2026.")'
    ),
    (
        'c.setTitle("AutoRH — README officiel — édition resserrée v0.2.106")',
        'c.setTitle("AutoRH — README officiel — édition resserrée v0.2.107")'
    ),
    # g) canaris : marqueurs du matricule ajoutés
    #    (l'ancre englobe la ligne suivante : après insertion elle disparaît,
    #    donc une ré-exécution est un no-op idempotent)
    (
        '"deux colonnes séparées (v0.2.106)", "Pièces jointes aux notifications employé",\n'
        '        "PAIESAGE1",',
        '"deux colonnes séparées (v0.2.106)", "Pièces jointes aux notifications employé",\n'
        '        # v0.2.107 — matricule (fiches, accès portail, demandes, e-mails)\n'
        '        "Matricule employé dans les demandes", "Consulter / modifier le « Matricule »", "auto-associé",\n'
        '        "récupéré automatiquement depuis ses fiches de paie", "(v0.2.107)",\n'
        '        "PAIESAGE1",'
    ),
    (
        'print("OK : édition v0.2.106 — %d pages (édition précédente : 14 pages)" % nb)',
        'print("OK : édition v0.2.107 — %d pages (édition précédente : 14 pages)" % nb)'
    ),
])

# =========================================================================
# 2) FORMATION — scripts/creer_support_formation_rh.py
# =========================================================================
formation = os.path.join(RACINE, "scripts", "creer_support_formation_rh.py")
patcher(formation, [
    (
        'PDF_VERSIONNE = os.path.join(RACINE, "download", "servicerh-support-formation-rh-v0.2.106.pdf")',
        'PDF_VERSIONNE = os.path.join(RACINE, "download", "servicerh-support-formation-rh-v0.2.107.pdf")'
    ),
    (
        'bande = espacer("SUPPORT DE FORMATION · ÉQUIPE RH · V0.2.105")',
        'bande = espacer("SUPPORT DE FORMATION · ÉQUIPE RH · V0.2.107")'
    ),
    (
        '"v0.2.106 (les écrans peuvent évoluer légèrement lors des mises à jour).")',
        '"v0.2.107 (les écrans peuvent évoluer légèrement lors des mises à jour).")'
    ),
    (
        'sources = ("Contenu vérifié sur le code livré v0.2.106 · README officiel (servicerh-readme-technique.pdf) · "',
        'sources = ("Contenu vérifié sur le code livré v0.2.107 · README officiel (servicerh-readme-technique.pdf) · "'
    ),
    # module 6 — étape 4 : le matricule accompagne les e-mails
    (
        '"Depuis la v0.2.106, la notification JOINT le document de réponse (tous types "\n'
        '                       "de demandes) : l\'employé le reçoit EN PIÈCE JOINTE et le retrouve signé dans "',
        '"Depuis la v0.2.106, la notification JOINT le document de réponse (tous types "\n'
        '                       "de demandes) et, depuis la v0.2.107, TOUS les e-mails du circuit portent la "\n'
        '                       "ligne « Matricule » de l\'employé (récupéré automatiquement depuis ses fiches "\n'
        '                       "de paie). L\'employé reçoit le document EN PIÈCE JOINTE et le retrouve signé dans "'
    ),
    (
        '"Version de référence : v0.2.106. Ce support évolue avec l\'application — la route "',
        '"Version de référence : v0.2.107. Ce support évolue avec l\'application — la route "'
    ),
])

# =========================================================================
# 3) MAP DE ROUTAGE — scripts/map_routage_emails.py
# =========================================================================
mapr = os.path.join(RACINE, "scripts", "map_routage_emails.py")
patcher(mapr, [
    (
        'Génère : download/AutoRH-Map-routage-emails-demandes-v0.2.106.xlsx',
        'Génère : download/AutoRH-Map-routage-emails-demandes-v0.2.107.xlsx'
    ),
    (
        '(v0.2.106 : la notification employé JOINT le document de réponse — tous types ;',
        '(v0.2.107 : le matricule de l\'employé figure dans les e-mails de demandes ;\n'
        'v0.2.106 : la notification employé JOINT le document de réponse — tous types ;'
    ),
    (
        'OUT = "/home/z/my-project/download/AutoRH-Map-routage-emails-demandes-v0.2.106.xlsx"',
        'OUT = "/home/z/my-project/download/AutoRH-Map-routage-emails-demandes-v0.2.107.xlsx"'
    ),
    (
        'setup_sheet(ws, title="AutoRH — Map de routage e-mail des demandes (portail employé, v0.2.106)", last_col=last_col)',
        'setup_sheet(ws, title="AutoRH — Map de routage e-mail des demandes (portail employé, v0.2.107)", last_col=last_col)'
    ),
    (
        '["Notification employé AVEC pièce jointe (v0.2.106)",\n'
        '     "Le document de réponse est JOINT à la notification de l\'employé pour TOUS les types de demandes : import direct (administration) "\n'
        '     "comme réponse e-mail IMAP. La notification reste « NE PAS répondre » ; les copies RH / N+1 restent SANS pièces jointes."],',
        '["Notification employé AVEC pièce jointe (v0.2.106)",\n'
        '     "Le document de réponse est JOINT à la notification de l\'employé pour TOUS les types de demandes : import direct (administration) "\n'
        '     "comme réponse e-mail IMAP. La notification reste « NE PAS répondre » ; les copies RH / N+1 restent SANS pièces jointes."],\n'
        '    ["Matricule employé dans les e-mails (v0.2.107)",\n'
        '     "Le matricule de l\'employé, récupéré automatiquement depuis ses fiches de paie (valeur manuelle de l\'accès portail prioritaire), "\n'
        '     "figure dans TOUS les e-mails du circuit : création au service traitant, confirmation au demandeur, changement de statut, "\n'
        '     "notification du document — colonnes « Matricule » également affichées dans « Toutes les fiches », « Accès portail » et « Demandes »."],'
    ),
])

# =========================================================================
# 4) ZIP — scripts/creer_zip_lite.py
# =========================================================================
zipscript = os.path.join(RACINE, "scripts", "creer_zip_lite.py")
patcher(zipscript, [
    ('VERSION = "v0.2.106"', 'VERSION = "v0.2.107"'),
])

# =========================================================================
# Exécution des 4 générateurs
# =========================================================================
lancer([sys.executable, os.path.join(RACINE, "scripts", "maj_readme_v096.py")])
lancer([sys.executable, os.path.join(RACINE, "scripts", "map_routage_emails.py")])
lancer([sys.executable, os.path.join(RACINE, "scripts", "creer_support_formation_rh.py")])
lancer([sys.executable, os.path.join(RACINE, "scripts", "creer_zip_lite.py")])

print("\nLivrables v0.2.107 régénérés.")
