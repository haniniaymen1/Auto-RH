#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 214 — v0.2.106 : met à jour les QUATRE générateurs de livrables puis
les exécute (README PDF, map de routage xlsx, support de formation PDF, ZIP).

Contenu v0.2.106 (3 évolutions utilisateur) :
  1) e-mail AUTOMATIQUE de création de compte RH/IT (identifiant + mot de
     passe initial + adresse d'accès) — changement de mot de passe déjà
     obligatoire à la première connexion ;
  2) Accès portail : colonne « Nom et prénom » séparée en « Nom » / « Prénom »
     (répercuté sur les fiches du CIN, compatibilité nomPrenom conservée) ;
  3) Réponse RH : le document final est JOINT à la notification de l'employé
     — import direct ET réponse e-mail IMAP, pour TOUS les types de demandes.

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
    for ancien, nouveau in remplacements:
        if texte.count(ancien) != 1:
            raise SystemExit(
                "ANCRAGE %r introuvable ou non unique (%d) dans %s"
                % (ancien[:70], texte.count(ancien), chemin)
            )
        texte = texte.replace(ancien, nouveau)
    with open(chemin, "w", encoding="utf-8") as f:
        f.write(texte)
    print("OK : %s (%d remplacements)" % (os.path.basename(chemin), len(remplacements)))


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
    # a) docstring : historique v0.2.106 en tête
    (
        'Task 212 — v0.2.105 : (1) NOTIFICATIONS EMPLOYÉ SANS RÉPONSE — les e-mails',
        'Task 214 — v0.2.106 : (1) E-MAIL AUTOMATIQUE DE CRÉATION DE COMPTE — la création\n'
        'd\'un compte RH ou IT par le superadministrateur envoie AUTOMATIQUEMENT au\n'
        'nouvel utilisateur son identifiant, son mot de passe initial et l\'adresse\n'
        'd\'accès (le changement de mot de passe à la première connexion, déjà\n'
        'obligatoire, est rappelé dans l\'e-mail) ; (2) ACCÈS PORTAIL — la colonne\n'
        '« Nom et prénom » devient DEUX colonnes distinctes « Nom » / « Prénom »\n'
        '(répercuté sur toutes les fiches du CIN, compatibilité nomPrenom conservée\n'
        'pour le portail et le pré-remplissage des demandes) ; (3) RÉPONSE RH — le\n'
        'document final (tamponné) est JOINT à la notification e-mail de l\'employé,\n'
        'pour TOUS les types de demandes, aussi bien par import direct que par la\n'
        'réponse e-mail IMAP ; les copies RH/N+1 restent sans pièces jointes.\n'
        'Édition précédente — Task 212 — v0.2.105 : (1) NOTIFICATIONS EMPLOYÉ SANS RÉPONSE — les e-mails'
    ),
    (
        'PDF_VERSIONNE = os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.105.pdf")',
        'PDF_VERSIONNE = os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.106.pdf")'
    ),
    (
        'SAUVEGARDE_PRECEDENTE = "/tmp/my-project/servicerh-readme-technique-v0.2.104-avant-v0.2.105.pdf"',
        'SAUVEGARDE_PRECEDENTE = "/tmp/my-project/servicerh-readme-technique-v0.2.105-avant-v0.2.106.pdf"'
    ),
    # b) section 2 — puce comptes : e-mail automatique de création
    (
        '"exclusivement par le superadministrateur ; changement de mot de passe imposé à la première "\n'
        '             "connexion puis à chaque expiration (15 jours) ; le RH n\'a accès à AUCUN paramètre SMTP — "',
        '"exclusivement par le superadministrateur ; leur création déclenche un E-MAIL AUTOMATIQUE au "\n'
        '             "nouvel utilisateur (identifiant, mot de passe initial, adresse d\'accès — v0.2.106) ; "\n'
        '             "changement de mot de passe imposé à la première connexion puis à chaque expiration "\n'
        '             "(15 jours) ; le RH n\'a accès à AUCUN paramètre SMTP — "'
    ),
    # c) section 2 — puce demandes : pièce jointe à la notification
    (
        '"chiffré, tamponné, visible par l\'employé dans « Mes documents ». L\'IT est refusé 403 côté serveur "',
        '"chiffré, tamponné, visible par l\'employé dans « Mes documents » et désormais JOINT à la "\n'
        '             "notification e-mail de l\'employé, pour TOUS les types de demandes (v0.2.106 — "\n'
        '             "pièce jointe du document final, en plus du stockage portail). L\'IT est refusé 403 côté serveur "'
    ),
    # d) annexe A — ligne Nom et prénom
    (
        '("Modifier « Nom et prénom » (répercuté sur toutes les fiches du CIN)", "Oui", "Oui", "Non"),',
        '("Modifier « Nom » / « Prénom » — deux colonnes séparées (v0.2.106), répercuté sur toutes les fiches du CIN, compatibilité « Nom et prénom » conservée", "Oui", "Oui", "Non"),'
    ),
    # e) annexe B — principes : deux ajouts v0.2.106
    (
        '    "A": "Annexe A : matrice des droits des rôles (état du code v0.2.105)",',
        '    "A": "Annexe A : matrice des droits des rôles (état du code v0.2.106)",'
    ),
    (
        '"Journal d\'envoi (logs/journal-emails.log, consultable IT / SuperAdmin — onglet Demandes) : demande-creation, demande-creation-copie-rh, demande-creation-copie-dediee, demande-creation-confirmation-demandeur.",',
        '"Journal d\'envoi (logs/journal-emails.log, consultable IT / SuperAdmin — onglet Demandes) : demande-creation, demande-creation-copie-rh, demande-creation-copie-dediee, demande-creation-confirmation-demandeur, compte-cree (v0.2.106).",\n'
        '    "E-mail automatique de création de compte (v0.2.106) : la création d\'un compte RH ou IT par le superadministrateur envoie AUTOMATIQUEMENT au nouvel utilisateur son identifiant (l\'adresse du compte), son mot de passe initial et l\'adresse d\'accès au site d\'administration, avec le rappel du changement de mot de passe OBLIGATOIRE à la première connexion (envoi journalisé « compte-cree », jamais bloquant — en cas d\'échec SMTP, l\'interface invite à communiquer les identifiants manuellement).",\n'
        '    "Pièces jointes aux notifications employé (v0.2.106) : le document final tamponné répondant à la demande est JOINT à l\'e-mail de l\'employé pour TOUS les types (attestation de travail, attestation de salaire, congé, autorisation de sortie, parrainage), par import direct comme par réponse e-mail IMAP ; les copies envoyées au responsable / service RH restent SANS pièces jointes (ils possèdent déjà le document).",'
    ),
    # f) mentions de version diverses
    (
        '"v0.2.105 : architecture à deux services (ports 4000 et 4001), fonctionnalités, installation, "',
        '"v0.2.106 : architecture à deux services (ports 4000 et 4001), fonctionnalités, installation, "'
    ),
    (
        '"les e-mails employés sont désormais des notifications sans réponse (v0.2.105). Les annexes A "',
        '"les e-mails employés sont des notifications sans réponse (v0.2.105) qui joignent désormais le "\n'
        '            "document de réponse (v0.2.106). Les annexes A "'
    ),
    (
        'sources = ("Code source livré v0.2.105 · Support de formation RH (servicerh-support-formation-rh.pdf) · "',
        'sources = ("Code source livré v0.2.106 · Support de formation RH (servicerh-support-formation-rh.pdf) · "'
    ),
    (
        'PART["label"] = "édition resserrée v0.2.105"',
        'PART["label"] = "édition resserrée v0.2.106"'
    ),
    (
        '"État du code livré v0.2.105 (archive officielle), 27 septembre 2026.")',
        '"État du code livré v0.2.106 (archive officielle), 28 septembre 2026.")'
    ),
    (
        '"Configuration introduite en v0.2.94 — état du code v0.2.105, 27 septembre 2026.")',
        '"Configuration introduite en v0.2.94 — état du code v0.2.106, 28 septembre 2026.")'
    ),
    (
        'c.setTitle("AutoRH — README officiel — édition resserrée v0.2.105")',
        'c.setTitle("AutoRH — README officiel — édition resserrée v0.2.106")'
    ),
    (
        '"Sommaire", "v0.2.105", "AutoRH",',
        '"Sommaire", "v0.2.106", "AutoRH",'
    ),
    # g) marqueurs de contrôle
    (
        '"NE PAS répondre", "Notifications employé SANS réponse", "anciennement Auto-RH",',
        '"NE PAS répondre", "Notifications employé SANS réponse", "anciennement Auto-RH",\n'
        '        # v0.2.106 — e-mail de création, Nom/Prénom, pièce jointe\n'
        '        "E-mail automatique de création de compte", "JOINT à la notification",\n'
        '        "deux colonnes séparées (v0.2.106)", "Pièces jointes aux notifications employé",'
    ),
    (
        '# sauvegarde idempotente de l\'édition v0.2.104 avant la livraison v0.2.105',
        '# sauvegarde idempotente de l\'édition v0.2.105 avant la livraison v0.2.106'
    ),
    (
        'print("OK : édition v0.2.105 — %d pages (édition précédente : 14 pages)" % nb)',
        'print("OK : édition v0.2.106 — %d pages (édition précédente : 14 pages)" % nb)'
    ),
])

# =========================================================================
# 2) Map de routage xlsx — scripts/map_routage_emails.py
# =========================================================================
routage = os.path.join(RACINE, "scripts", "map_routage_emails.py")
patcher(routage, [
    (
        'Génère : download/Auto-RH-Map-routage-emails-demandes-v0.2.94.xlsx',
        'Génère : download/AutoRH-Map-routage-emails-demandes-v0.2.106.xlsx\n'
        '(v0.2.106 : la notification employé JOINT le document de réponse — tous types ;\n'
        'marquage AutoRH — l\'application couvre fiches de paie ET demandes administratives).'
    ),
    (
        'OUT = "/home/z/my-project/download/Auto-RH-Map-routage-emails-demandes-v0.2.94.xlsx"',
        'OUT = "/home/z/my-project/download/AutoRH-Map-routage-emails-demandes-v0.2.106.xlsx"'
    ),
    (
        'setup_sheet(ws, title="Auto-RH — Map de routage e-mail des demandes (portail employé, v0.2.94)", last_col=last_col)',
        'setup_sheet(ws, title="AutoRH — Map de routage e-mail des demandes (portail employé, v0.2.106)", last_col=last_col)'
    ),
    # pièces jointes v0.2.106 — ligne Réception IMAP enrichie + nouvelle ligne
    (
        '    ["Réception des réponses (IMAP)",\n'
        '     "Le RH répond à l\'e-mail de la demande en joignant le document ; la pièce jointe est détectée par IMAP (boîte du compte d\'envoi "\n'
        '     "ou compte dédié), chiffrée sur le disque et associée automatiquement à la demande (portail employé → « Mes demandes »)."],',
        '    ["Réception des réponses (IMAP)",\n'
        '     "Le RH répond à l\'e-mail de la demande en joignant le document ; la pièce jointe est détectée par IMAP (boîte du compte d\'envoi "\n'
        '     "ou compte dédié), chiffrée sur le disque et associée automatiquement à la demande (portail employé → « Mes demandes »)."],\n'
        '    ["Notification employé AVEC pièce jointe (v0.2.106)",\n'
        '     "Le document de réponse est JOINT à la notification de l\'employé pour TOUS les types de demandes : import direct (administration) "\n'
        '     "comme réponse e-mail IMAP. La notification reste « NE PAS répondre » ; les copies RH / N+1 restent SANS pièces jointes."],'
    ),
])

# =========================================================================
# 3) Support de formation — scripts/creer_support_formation_rh.py
# =========================================================================
support = os.path.join(RACINE, "scripts", "creer_support_formation_rh.py")
patcher(support, [
    (
        'Création du SUPPORT DE FORMATION AutoRH (ex-Auto-RH) destiné à l\'équipe RH (v0.2.105).',
        'Création du SUPPORT DE FORMATION AutoRH (ex-Auto-RH) destiné à l\'équipe RH (v0.2.106).\n'
        'v0.2.106 : module 6 mis à jour — le document de réponse est JOINT à la notification\n'
        'employé ; e-mail automatique de création de compte RH/IT ; Nom / Prénom séparés.'
    ),
    (
        'PDF_VERSIONNE = os.path.join(RACINE, "download", "servicerh-support-formation-rh-v0.2.105.pdf")',
        'PDF_VERSIONNE = os.path.join(RACINE, "download", "servicerh-support-formation-rh-v0.2.106.pdf")'
    ),
    (
        '"v0.2.105 (les écrans peuvent évoluer légèrement lors des mises à jour).")',
        '"v0.2.106 (les écrans peuvent évoluer légèrement lors des mises à jour).")'
    ),
    (
        'sources = ("Contenu vérifié sur le code livré v0.2.105 · README officiel (servicerh-readme-technique.pdf) · "',
        'sources = ("Contenu vérifié sur le code livré v0.2.106 · README officiel (servicerh-readme-technique.pdf) · "'
    ),
    # module 6 — étape 4 : pièce jointe
    (
        '"au demandeur. Depuis la v0.2.105, les e-mails destinés à l\'EMPLOYÉ sont des "\n'
        '                       "NOTIFICATIONS PURES : mention explicite « NE PAS répondre à cet e-mail ». "\n'
        '                       "L\'employé consulte la réponse signée dans « Mes demandes » de son portail — il "\n'
        '                       "ne répond jamais par e-mail, aucune réponse à l\'adresse d\'expédition n\'est lue. "',
        '"au demandeur. Depuis la v0.2.105, les e-mails destinés à l\'EMPLOYÉ sont des "\n'
        '                       "NOTIFICATIONS PURES : mention explicite « NE PAS répondre à cet e-mail ». "\n'
        '                       "Depuis la v0.2.106, la notification JOINT le document de réponse (tous types "\n'
        '                       "de demandes) : l\'employé le reçoit EN PIÈCE JOINTE et le retrouve signé dans "\n'
        '                       "« Mes demandes » de son portail — il ne répond jamais par e-mail, aucune "\n'
        '                       "réponse à l\'adresse d\'expédition n\'est lue. "'
    ),
    (
        '"Version de référence : v0.2.105. Ce support évolue avec l\'application — la route "',
        '"Version de référence : v0.2.106. Ce support évolue avec l\'application — la route "'
    ),
    (
        'c.setTitle("AutoRH — Support de formation RH — v0.2.105")',
        'c.setTitle("AutoRH — Support de formation RH — v0.2.106")'
    ),
    (
        '"Annexe A", "Tableau A.1", "Checklist de la première semaine", "v0.2.105",',
        '"Annexe A", "Tableau A.1", "Checklist de la première semaine", "v0.2.106",'
    ),
    (
        '"NE PAS répondre", "NOTIFICATIONS PURES", "anciennement Auto-RH",',
        '"NE PAS répondre", "NOTIFICATIONS PURES", "anciennement Auto-RH",\n'
        '        # v0.2.106 — pièce jointe, création de compte, Nom/Prénom\n'
        '        "EN PIÈCE JOINTE", "v0.2.106",'
    ),
])

# =========================================================================
# 4) ZIP — scripts/creer_zip_lite.py
# =========================================================================
zipper = os.path.join(RACINE, "scripts", "creer_zip_lite.py")
patcher(zipper, [
    ('VERSION = "v0.2.105"', 'VERSION = "v0.2.106"'),
])

# =========================================================================
# Exécution des générateurs dans l'ordre
# =========================================================================
lancer([sys.executable, readme])
lancer([sys.executable, routage])
lancer([sys.executable, support])
lancer([sys.executable, zipper])
print("\nOK : livrables v0.2.106 régénérés.")
