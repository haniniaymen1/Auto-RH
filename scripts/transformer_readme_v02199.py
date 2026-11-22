#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Transforme creer_readme_essentiel_v02198.py en creer_readme_essentiel_v02199.py
(édition v0.2.199 — INSTALLATION LINUX TOUT-EN-UN : demande utilisateur
« ajouter le script installation et demarrage les 2 portails et creation
administarteur pour linux ». Nouveau fichier INSTALLER-ET-DEMARRER-LINUX-MAC.sh :
vérifie Node.js, prépare le .env (base, secret de session, dossiers, PORT /
PORTAL_PORT des deux interfaces), sécurise les dossiers sensibles, installe
les dépendances, crée la base SQLite, construit le site si nécessaire, CRÉE le
compte ADMINISTRATEUR (superadministrateur — interactif avec mot de passe
masqué ou non interactif via SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD) puis
démarre les DEUX interfaces avec journaux, PIDs, adresses réseau.)"""
import io, os

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creer_readme_essentiel_v02198.py")
DST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creer_readme_essentiel_v02199.py")

src = io.open(SRC, encoding="utf-8").read()
remplacements = 0

def rep(ancien, nouveau, obligatoire=True, occurrences=1):
    global src, remplacements
    n = src.count(ancien)
    if n < occurrences:
        if obligatoire:
            raise SystemExit("ANCRE INTROUVABLE (%d trouvée, %d requise) : %r" % (n, occurrences, ancien[:90]))
        return
    src = src.replace(ancien, nouveau, occurrences)
    remplacements += 1

# ---- 1) Docstring : titre + bloc v0.2.199 ------------------------------------
rep("README officiel ServiceRH — ÉDITION ESSENTIELLE v0.2.198 (~15 pages).",
    "README officiel ServiceRH — ÉDITION ESSENTIELLE v0.2.199 (~15 pages).\n\n"
    "Demande utilisateur (v0.2.199) : « ajouter le script installation et demarrage\n"
    "les 2 portails et creation administarteur pour linux » — NOUVEAU : le fichier\n"
    "INSTALLER-ET-DEMARRER-LINUX-MAC.sh, à lancer une seule fois à la racine du\n"
    "projet décompressé. Il fait dans l'ordre : vérification de Node.js, préparation\n"
    "du .env (chemin absolu de la base, secret de session créé une seule fois,\n"
    "lignes PORT / PORTAL_PORT ajoutées si absentes — valeurs existantes JAMAIS\n"
    "modifiées), sécurisation automatique des dossiers sensibles, installation des\n"
    "dépendances (CLI locaux uniquement, aucun prompt), création de la base SQLite,\n"
    "build de production si nécessaire, CRÉATION DU COMPTE ADMINISTRATEUR\n"
    "(superadministrateur — questions interactives avec mot de passe MASQUÉ, ou\n"
    "mode non interactif SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD, INSTALLER_SANS_ADMIN=1\n"
    "pour passer) puis démarrage des DEUX interfaces en arrière-plan (nohup) avec\n"
    "PIDs, journaux paiesage-admin.log / paiesage-portail.log, adresses réseau\n"
    "local et ouverture du navigateur. Preuve : test dédié 28 contrôles + smoke\n"
    "test RÉEL complet (installation → build → compte créé → 2 interfaces en\n"
    "HTTP 200).")

# ---- 2) EDITION ---------------------------------------------------------------
rep('EDITION = "v0.2.198"', 'EDITION = "v0.2.199"')

# ---- 3) Bandeau de couverture --------------------------------------------------
rep('espacer("README OFFICIEL · ÉDITION ESSENTIELLE · V0.2.198")',
    'espacer("README OFFICIEL · ÉDITION ESSENTIELLE · V0.2.199")')

# ---- 4) Intro de couverture : phrase v0.2.199 ----------------------------------
rep('"la v0.2.198, les ports des deux interfaces se règlent dans le fichier .env "\n'
    '        "(PORT / PORTAL_PORT)."))',
    '"la v0.2.198, les ports des deux interfaces se règlent dans le fichier .env "\n'
    '        "(PORT / PORTAL_PORT). Depuis la v0.2.199, un script unique installe le "\n'
    '        "projet sous Linux/macOS, crée le compte administrateur et démarre les "\n'
    '        "deux interfaces (INSTALLER-ET-DEMARRER-LINUX-MAC.sh)."))')

# ---- 5) Blocs de couverture ----------------------------------------------------
rep('"Réalisé du 12 septembre au 12 octobre 2026 — <b>31 jours calendaires</b>, 198 versions "',
    '"Réalisé du 12 septembre au 12 octobre 2026 — <b>31 jours calendaires</b>, 199 versions "')

# ---- 6) DIFFUSION : nom du fichier ---------------------------------------------
rep("Fichier : download/servicerh-readme-technique-v0.2.198.pdf.",
    "Fichier : download/servicerh-readme-technique-v0.2.199.pdf.")

# ---- 7) SOURCES : tête du bloc --------------------------------------------------
rep('"Code source livré v0.2.198 (PORTS MODIFIABLES — les deux interfaces écoutent sur "',
    '"Code source livré v0.2.199 (INSTALLATION LINUX TOUT-EN-UN — nouveau fichier "\n'
    '         "INSTALLER-ET-DEMARRER-LINUX-MAC.sh : vérifie Node.js, prépare le fichier "\n'
    '         ".env (base, secret de session, dossiers, PORT / PORTAL_PORT des deux "\n'
    '         "interfaces), sécurise les dossiers sensibles, installe les dépendances, "\n'
    '         "crée la base SQLite, construit le site si nécessaire, CRÉE le compte "\n'
    '         "ADMINISTRATEUR (superadministrateur — interactif avec mot de passe "\n'
    '         "masqué ou non interactif via SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD) "\n'
    '         "puis démarre les DEUX interfaces avec journaux, PIDs, adresses réseau "\n'
    '         "et navigateur · HÉRITAGE v0.2.198 — PORTS MODIFIABLES : les deux interfaces écoutent sur "')

# ---- 8) Tableau 5.1 : ligne v0.2.199 -------------------------------------------
rep('"contrôles (302 au total), 0 échec."],],',
    '"contrôles (302 au total), 0 échec."],\n'
    '         ["v0.2.199", "INSTALLATION LINUX TOUT-EN-UN — nouveau script "\n'
    '                      "INSTALLER-ET-DEMARRER-LINUX-MAC.sh : installation des "\n'
    '                      "dépendances, préparation du .env (base, secret de session, "\n'
    '                      "PORT / PORTAL_PORT ajoutés si absents), sécurité des "\n'
    '                      "dossiers, base SQLite, build si nécessaire, CRÉATION DU "\n'
    '                      "COMPTE ADMINISTRATEUR (superadministrateur — interactif "\n'
    '                      "avec mot de passe masqué, ou SUPERADMIN_EMAIL / "\n'
    '                      "SUPERADMIN_PASSWORD) puis démarrage des deux interfaces "\n'
    '                      "avec journaux, PIDs, adresses réseau et navigateur — test "\n'
    '                      "dédié 28 contrôles + smoke test réel complet (build + "\n'
    '                      "compte créé + 2 interfaces HTTP 200), 0 échec."],],')

# ---- 9) Puce dédiée v0.2.199 (après la puce 198) --------------------------------
rep('"— 302 contrôles au total, 0 échec."))',
    '"— 302 contrôles au total, 0 échec."))\n'
    '    STORY.append(bul(\n'
    '        "<b>Installation Linux tout-en-un (v0.2.199)</b> : DEMANDE UTILISATEUR — "\n'
    '        "« ajouter le script installation et demarrage les 2 portails et creation "\n'
    '        "administarteur pour linux ». NOUVEAU : le fichier INSTALLER-ET-DEMARRER-"\n'
    '        "LINUX-MAC.sh, à lancer UNE seule fois à la racine du projet décompressé "\n'
    '        "(bash INSTALLER-ET-DEMARRER-LINUX-MAC.sh). Il fait tout, dans l\'ordre : "\n'
    '        "(1) vérification de Node.js avec les commandes d\'installation (Debian/ "\n'
    '        "Ubuntu, macOS) ; (2) préparation du .env — chemin ABSOLU de la base "\n'
    '        "SQLite, secret de session créé une seule fois puis conservé, lignes "\n'
    '        "PORT / PORTAL_PORT AJOUTÉES si absentes (valeurs existantes jamais "\n'
    '        "modifiées — ports v0.2.198) ; (3) sécurisation automatique des dossiers "\n'
    '        "sensibles (.env 600, base, storage, logs, backups) ; (4) installation "\n'
    '        "des dépendances avec vérification des CLI LOCAUX (plus aucun appel npx, "\n'
    '        "aucun prompt interactif) ; (5) création / mise à jour de la base de "\n'
    '        "données SQLite ; (6) build de production SI nécessaire (nouvelle version "\n'
    '        "extraite) ; (7) CRÉATION DU COMPTE ADMINISTRATEUR — le superadminis-"\n'
    '        "trateur, seul habilité à créer les comptes RH et IT depuis l\'onglet "\n'
    '        "Utilisateurs : questions interactives (mot de passe MASQUÉ) ou mode non "\n'
    '        "interactif SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD (SUPERADMIN_NOM "\n'
    '        "facultatif), INSTALLER_SANS_ADMIN=1 pour passer l\'étape, terminal non "\n'
    '        "interactif sans variables → étape passée avec le mode d\'emploi "\n'
    '        "(node scripts/creer-superadmin.js) ; (8) démarrage des DEUX interfaces "\n'
    '        "en arrière-plan (nohup — le terminal peut être fermé) : administration "\n'
    '        "RH/IT sur PORT (login) et portail employés sur PORTAL_PORT (sans "\n'
    '        "connexion), PIDs affichés, journaux paiesage-admin.log / paiesage-"\n'
    '        "portail.log, adresses réseau local et ouverture du navigateur. Preuve : "\n'
    '        "test dédié scripts/test_v02199_installeur_linux.js — 28 contrôles sur "\n'
    '        "le CODE RÉEL (sections et ordre des 7 étapes, conventions sans npx, "\n'
    '        "ports v0.2.198, modes de création du compte, démarrage nohup, bash -n, "\n'
    '        "fins de ligne LF) + smoke test RÉEL complet exécuté : installation → "\n'
    '        "build → compte administrateur créé → administration et portail en "\n'
    '        "HTTP 200 ; non-régression v0.2.186→198 relancée : 302 contrôles — 330 "\n'
    '        "contrôles au total, 0 échec."))')

# ---- 10) Marqueurs verifier du générateur ---------------------------------------
rep('"V0.2.198", "ServiceRH", "ÉDITION ESSENTIELLE",',
    '"V0.2.199", "ServiceRH", "ÉDITION ESSENTIELLE",')
rep('"198 versions", "Temps de développement et de test", "jours-homme", "Tableau 1.2",',
    '"199 versions", "Temps de développement et de test", "jours-homme", "Tableau 1.2",\n'
    '        "INSTALLER-ET-DEMARRER", "SUPERADMIN_PASSWORD", "creer-superadmin",')

# ---- 11) Annexe ------------------------------------------------------------------
rep("État du code livré v0.2.198. Trois rôles",
    "État du code livré v0.2.199. Trois rôles")

# ---- 12) Chemins de sortie des PDF ---------------------------------------------
rep('os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.198.pdf")',
    'os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.199.pdf")')
rep('os.path.join(RACINE, "download", "servicerh-readme-technique-reduit-v0.2.198.pdf")',
    'os.path.join(RACINE, "download", "servicerh-readme-technique-reduit-v0.2.199.pdf")')

io.open(DST, "w", encoding="utf-8").write(src)
print("transformer_readme_v02199 : %d remplacements → %s" % (remplacements, DST))
