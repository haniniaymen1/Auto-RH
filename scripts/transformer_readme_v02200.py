#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Transforme creer_readme_essentiel_v02199.py en creer_readme_essentiel_v02200.py
(édition v0.2.200 — SUPPRESSION DES COMPTES ADMIN + GUIDE D'INSTALLATION
LINUX/WINDOWS + CHANGEMENT DES PORTS — demande utilisateur : « supprimer si il
y a des comptes admin ainsi donne moi comment j installe dans linux et comment
l installe dans windows ? , et comment changer les port des interfaces dans
linux et dans windows ». Les 3 comptes de démonstration sont SUPPRIMÉS ; la
base embarquée dans le ZIP complet est régénérée VIERGE (schéma Prisma, zéro
compte, zéro donnée) ; nouveau GUIDE-INSTALLATION-LINUX-WINDOWS.txt : install
Linux/macOS (script tout-en-un), install Windows (.bat + menu superadmin),
changement des ports (PORT / PORTAL_PORT du .env) pour les deux systèmes.)"""
import io, os

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creer_readme_essentiel_v02199.py")
DST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creer_readme_essentiel_v02200.py")

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

# ---- 1) Docstring : titre + bloc v0.2.200 ------------------------------------
rep("README officiel ServiceRH — ÉDITION ESSENTIELLE v0.2.199 (~15 pages).",
    "README officiel ServiceRH — ÉDITION ESSENTIELLE v0.2.200 (~15 pages).\n\n"
    "Demande utilisateur (v0.2.200) : « supprimer si il y a des comptes admin ainsi\n"
    "donne moi comment j installe dans linux et comment l installe dans windows ? ,\n"
    "et comment changer les port des interfaces dans linux et dans windows » :\n"
    "(1) SUPPRESSION — les 3 comptes de démonstration (2 superadministrateurs +\n"
    "1 RH) ont été supprimés de la base ; la base embarquée dans le ZIP complet est\n"
    "régénérée VIERGE (schéma Prisma appliqué, ZÉRO compte, ZÉRO donnée) : le\n"
    "premier compte créé à l'installation est l'ADMINISTRATEUR ; (2) NOUVEAU\n"
    "GUIDE-INSTALLATION-LINUX-WINDOWS.txt : installation Linux/macOS (script\n"
    "tout-en-un INSTALLER-ET-DEMARRER-LINUX-MAC.sh — dépendances, .env, base,\n"
    "build, création du compte administrateur, démarrage des deux interfaces),\n"
    "installation Windows (Node LTS + DEMARRER-WINDOWS.bat + DEMARRER-PORTAIL-\n"
    "WINDOWS.bat ou DEMARRER-TOUT-WINDOWS.bat + menu CREER-SUPERADMIN-WINDOWS.bat),\n"
    "CHANGEMENT DES PORTS des deux interfaces (PORT = administration RH/IT,\n"
    "PORTAL_PORT = portail employés, lignes du .env, valeurs DIFFÉRENTES) pour les\n"
    "deux systèmes, mode non interactif, accès réseau/pare-feu, problèmes courants.\n"
    "Preuve : test dédié 18 contrôles — vérification RÉELLE des bases (0 compte\n"
    "dans la base de l'arbre ET dans la base vierge embarquée) + ZIP reconstruit\n"
    "avec la base vierge vérifiée, 0 échec.")

# ---- 2) EDITION ---------------------------------------------------------------
rep('EDITION = "v0.2.199"', 'EDITION = "v0.2.200"')

# ---- 3) Bandeau de couverture --------------------------------------------------
rep('espacer("README OFFICIEL · ÉDITION ESSENTIELLE · V0.2.199")',
    'espacer("README OFFICIEL · ÉDITION ESSENTIELLE · V0.2.200")')

# ---- 4) Intro de couverture : phrase v0.2.200 ----------------------------------
rep('"deux interfaces (INSTALLER-ET-DEMARRER-LINUX-MAC.sh)."))',
    '"deux interfaces (INSTALLER-ET-DEMARRER-LINUX-MAC.sh). Depuis la v0.2.200, la "\n'
    '        "base livrée est VIERGE (aucun compte — le premier compte créé devient "\n'
    '        "l\'administrateur) et un guide couvre l\'installation et le changement "\n'
    '        "des ports sous Linux et Windows (GUIDE-INSTALLATION-LINUX-WINDOWS.txt)."))')

# ---- 5) Blocs de couverture ----------------------------------------------------
rep('"Réalisé du 12 septembre au 12 octobre 2026 — <b>31 jours calendaires</b>, 199 versions "',
    '"Réalisé du 12 septembre au 12 octobre 2026 — <b>31 jours calendaires</b>, 200 versions "')

# ---- 6) DIFFUSION : nom du fichier ---------------------------------------------
rep("Fichier : download/servicerh-readme-technique-v0.2.199.pdf.",
    "Fichier : download/servicerh-readme-technique-v0.2.200.pdf.")

# ---- 7) SOURCES : tête du bloc --------------------------------------------------
rep('"Code source livré v0.2.199 (INSTALLATION LINUX TOUT-EN-UN — nouveau fichier "',
    '"Code source livré v0.2.200 (BASE VIERGE + GUIDE D\'INSTALLATION — les "\n'
    '         "3 comptes de démonstration ont été SUPPRIMÉS (2 superadministrateurs "\n'
    '         "+ 1 RH) ; la base embarquée dans le ZIP complet est régénérée VIERGE "\n'
    '         "(schéma Prisma, zéro compte, zéro donnée — le premier compte créé à "\n'
    '         "l\'installation devient l\'administrateur) ; NOUVEAU GUIDE-INSTALLATION-"\n'
    '         "LINUX-WINDOWS.txt : installation Linux/macOS (script tout-en-un), "\n'
    '         "installation Windows (.bat + menu superadministrateur), CHANGEMENT "\n'
    '         "DES PORTS des deux interfaces (PORT / PORTAL_PORT du .env, valeurs "\n'
    '         "DIFFÉRENTES) pour les deux systèmes, mode non interactif, accès "\n'
    '         "réseau/pare-feu, problèmes courants · HÉRITAGE v0.2.199 — INSTALLATION LINUX TOUT-EN-UN : nouveau fichier "')

# ---- 8) Tableau 5.1 : ligne v0.2.200 -------------------------------------------
rep('"compte créé + 2 interfaces HTTP 200), 0 échec."],],',
    '"compte créé + 2 interfaces HTTP 200), 0 échec."],\n'
    '         ["v0.2.200", "COMPTES SUPPRIMÉS + GUIDE D\'INSTALLATION — les 3 comptes "\n'
    '                      "de démonstration (2 superadministrateurs + 1 RH) "\n'
    '                      "SUPPRIMÉS ; base embarquée dans le ZIP complet "\n'
    '                      "régénérée VIERGE (schéma Prisma, zéro compte, zéro "\n'
    '                      "donnée — vérification RÉELLE : 0 compte) ; nouveau "\n'
    '                      "GUIDE-INSTALLATION-LINUX-WINDOWS.txt : installation "\n'
    '                      "Linux/macOS et Windows, création du compte "\n'
    '                      "administrateur (les deux systèmes), CHANGEMENT DES "\n'
    '                      "PORTS (PORT / PORTAL_PORT du .env, valeurs "\n'
    '                      "DIFFÉRENTES, relance des lanceurs) pour les deux "\n'
    '                      "systèmes, mode non interactif, accès réseau, "\n'
    '                      "problèmes courants — test dédié 18 contrôles, 0 échec."],],')

# ---- 9) Puce dédiée v0.2.200 (après la puce 199) --------------------------------
rep('"contrôles au total, 0 échec."))',
    '"contrôles au total, 0 échec."))\n'
    '    STORY.append(bul(\n'
    '        "<b>Comptes supprimés + guide d\'installation et des ports (v0.2.200)</b> : "\n'
    '        "DEMANDE UTILISATEUR — « supprimer si il y a des comptes admin ainsi donne "\n'
    '        "moi comment j\'installe dans linux et comment l\'installe dans windows ?, "\n'
    '        "et comment changer les port des interfaces dans linux et dans windows ». "\n'
    '        "SUPPRESSION : les 3 comptes de démonstration (2 superadministrateurs, "\n'
    '        "dont une ligne historique illisible d\'une session perdue du 24/09, "\n'
    '        "+ 1 RH) ont été supprimés de la base de données ; la base embarquée "\n'
    '        "dans le ZIP complet est régénérée VIERGE (schéma Prisma appliqué, "\n'
    '        "ZÉRO compte, ZÉRO donnée — archive de traçabilité scripts/base-vierge/) : "\n'
    '        "à la première installation vous créez VOTRE administrateur (Linux : "\n'
    '        "question du script d\'installation, Windows : menu CREER-SUPERADMIN-"\n'
    '        "WINDOWS.bat choix 2) et il crée ensuite les comptes RH et IT depuis "\n'
    '        "l\'onglet Utilisateurs ; cohérence vérifiée des DEUX flux de clé de "\n'
    '        "chiffrement (secret généré ou clé par défaut) sur une base vide. "\n'
    '        "GUIDE : nouveau fichier GUIDE-INSTALLATION-LINUX-WINDOWS.txt à la "\n'
    '        "racine du ZIP — (1) installation LINUX/macOS : Node 20+, décompression "\n'
    '        "du ZIP, bash INSTALLER-ET-DEMARRER-LINUX-MAC.sh (étapes, création du "\n'
    '        "compte avec mot de passe masqué, mode non interactif SUPERADMIN_EMAIL / "\n'
    '        "SUPERADMIN_PASSWORD, nohup, journaux, arrêt) ; (2) installation "\n'
    '        "WINDOWS : Node LTS depuis nodejs.org, DEMARRER-WINDOWS.bat (installe, "\n'
    '        "construit, démarre l\'administration), DEMARRER-PORTAIL-WINDOWS.bat, "\n'
    '        "DEMARRER-TOUT-WINDOWS.bat, variantes silencieuses .vbs, menu "\n'
    '        "CREER-SUPERADMIN-WINDOWS.bat (état / créer / promouvoir) ; (3) "\n'
    '        "CHANGEMENT DES PORTS des deux interfaces : PORT (administration RH/IT, "\n'
    '        "défaut 3000) et PORTAL_PORT (portail employés, défaut 4001) dans le "\n'
    '        "fichier .env à la racine — lignes ajoutées automatiquement si absentes, "\n'
    '        "valeurs DOIVENT être DIFFÉRENTES, exemple PORT=8080 / PORTAL_PORT=8081, "\n'
    '        "relance des lanceurs des deux systèmes (les .bat relisent le .env à "\n'
    '        "chaque démarrage), priorité des variables PAIESAGE_PORT_* du service "\n'
    '        "silencieux, accès réseau http://IP-DU-PC:PORT et pare-feu ; (4) "\n'
    '        "politique de mot de passe (8 caractères minimum, minuscule + majuscule "\n'
    '        "+ chiffre + symbole) et problèmes courants (EADDRINUSE, page blanche "\n'
    '        "de première construction, compte oubli). Preuve : test dédié "\n'
    '        "scripts/test_v02200_guide_comptes.js — 18 contrôles dont la "\n'
    '        "vérification RÉELLE des bases (0 compte dans db/custom.db de l\'arbre "\n'
    '        "ET dans la base vierge embarquée), ZIP complet reconstruit avec la "\n'
    '        "base vierge (0 compte vérifié DANS le ZIP) ; non-régression v0.2.186→199 "\n'
    '        "relancée : 330 contrôles — 348 contrôles au total, 0 échec."))')

# ---- 10) Marqueurs verifier du générateur ---------------------------------------
rep('"V0.2.199", "ServiceRH", "ÉDITION ESSENTIELLE",',
    '"V0.2.200", "ServiceRH", "ÉDITION ESSENTIELLE",')
rep('"199 versions", "Temps de développement et de test", "jours-homme", "Tableau 1.2",',
    '"200 versions", "Temps de développement et de test", "jours-homme", "Tableau 1.2",\n'
    '        "GUIDE-INSTALLATION-LINUX-WINDOWS", "BASE VIERGE", "supprimés",')

# ---- 11) Annexe ------------------------------------------------------------------
rep("État du code livré v0.2.199. Trois rôles",
    "État du code livré v0.2.200. Trois rôles")

# ---- 12) Chemins de sortie des PDF ---------------------------------------------
rep('os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.199.pdf")',
    'os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.200.pdf")')
rep('os.path.join(RACINE, "download", "servicerh-readme-technique-reduit-v0.2.199.pdf")',
    'os.path.join(RACINE, "download", "servicerh-readme-technique-reduit-v0.2.200.pdf")')

io.open(DST, "w", encoding="utf-8").write(src)
print("transformer_readme_v02200 : %d remplacements → %s" % (remplacements, DST))
