#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Transforme creer_readme_essentiel_v02201.py en creer_readme_essentiel_v02202.py
(édition v0.2.202 — INSTALLATION : ERREUR « DATABASE_URL » CORRIGÉE — capture
utilisateur « fix it » : sous Windows, DEMARRER-TOUT-WINDOWS.bat → npm install
OK → prisma db push → P1012 « Environment variable not found: DATABASE_URL » →
« [ERREUR] La creation de la base de donnees a echoue. » CAUSE : les deux
lanceurs « TOUT » exécutaient l'installation commune SANS préparer le .env.
CORRECTIF : .env (DATABASE_URL absolu) préparé AVANT les commandes Prisma dans
DEMARRER-TOUT-WINDOWS.bat et DEMARRER-TOUT-LINUX-MAC.sh ; durcissement npm ≥ 11
(« npm warn install-scripts » visible sur la même capture) : les 6 lanceurs
testent le CLIENT GÉNÉRÉ node_modules/.prisma/client/index.js avant de sauter
« prisma generate » (DEMARRER-WINDOWS.bat gagne un generate unifié) ; guide :
entrée « Environment variable not found: DATABASE_URL » dans les problèmes
courants.)"""
import io, os

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creer_readme_essentiel_v02201.py")
DST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creer_readme_essentiel_v02202.py")

src = io.open(SRC, encoding="utf-8").read()
remplacements = 0

def rep(ancien, nouveau, obligatoire=True):
    global src, remplacements
    n = src.count(ancien)
    if n != 1:
        if obligatoire:
            raise SystemExit("ANCRE INTROUVABLE (%d trouvée) : %r" % (n, ancien[:90]))
        return
    src = src.replace(ancien, nouveau, 1)
    remplacements += 1

# ---- 1) Docstring -------------------------------------------------------------
rep("README officiel ServiceRH — ÉDITION ESSENTIELLE v0.2.201 (~15 pages).",
    "README officiel ServiceRH — ÉDITION ESSENTIELLE v0.2.202 (~15 pages).\n\n"
    "Demande utilisateur (v0.2.202) : « fix it » + capture d'écran — sous Windows,\n"
    "DEMARRER-TOUT-WINDOWS.bat → npm install réussi → « Error: Prisma validation\n"
    "— error: Environment variable not found: DATABASE_URL » (P1012) → « [ERREUR]\n"
    "La creation de la base de donnees a echoue. ». CAUSE : les deux lanceurs\n"
    "« TOUT » (Windows + Linux/macOS) exécutaient l'installation commune (npm\n"
    "install + prisma db push) SANS préparer le fichier .env — contrairement à\n"
    "tous les autres lanceurs ; sur un poste neuf, l'échec était garanti.\n"
    "CORRECTIF : le .env (DATABASE_URL absolu) est préparé AVANT les commandes\n"
    "Prisma dans DEMARRER-TOUT-WINDOWS.bat et DEMARRER-TOUT-LINUX-MAC.sh ;\n"
    "durcissement npm ≥ 11 (la même capture montre « npm warn install-scripts » :\n"
    "le postinstall de @prisma/client peut être sauté) : les 6 lanceurs testent\n"
    "désormais le CLIENT GÉNÉRÉ node_modules/.prisma/client/index.js avant de\n"
    "sauter « prisma generate », et DEMARRER-WINDOWS.bat gagne un generate unifié ;\n"
    "GUIDE-INSTALLATION-LINUX-WINDOWS.txt : nouvelle entrée dans les problèmes\n"
    "courants. Preuve : test dédié 34 contrôles dont l'EXÉCUTION RÉELLE du bloc\n"
    "du lanceur sur un dossier VIERGE suivi d'un VRAI « prisma db push » ;\n"
    "non-régression 360 contrôles — 394 au total, 0 échec.")

# ---- 2) EDITION ---------------------------------------------------------------
rep('EDITION = "v0.2.201"', 'EDITION = "v0.2.202"')

# ---- 3) Bandeau de couverture --------------------------------------------------
rep('espacer("README OFFICIEL · ÉDITION ESSENTIELLE · V0.2.201")',
    'espacer("README OFFICIEL · ÉDITION ESSENTIELLE · V0.2.202")')

# ---- 4) Intro de couverture ----------------------------------------------------
rep('"le même menu de création du superadministrateur que sous Windows."))',
    '"le même menu de création du superadministrateur que sous Windows. Depuis la "\n'
    '        "v0.2.202, les lanceurs « TOUT » préparent le fichier .env AVANT la création "\n'
    '        "de la base : l\'erreur « Environment variable not found: DATABASE_URL » "\n'
    '        "à la première installation est corrigée."))')

# ---- 5) Blocs de couverture ----------------------------------------------------
rep('"Réalisé du 12 septembre au 12 octobre 2026 — <b>31 jours calendaires</b>, 201 versions "',
    '"Réalisé du 12 septembre au 12 octobre 2026 — <b>31 jours calendaires</b>, 202 versions "')

# ---- 6) DIFFUSION : nom du fichier ---------------------------------------------
rep("Fichier : download/servicerh-readme-technique-v0.2.201.pdf.",
    "Fichier : download/servicerh-readme-technique-v0.2.202.pdf.")

# ---- 7) SOURCES : tête du bloc --------------------------------------------------
rep('         "Code source livré v0.2.201 (LANCEUR SUPERADMIN LINUX — NOUVEAU "',
    '         "Code source livré v0.2.202 (INSTALLATION : ERREUR DATABASE_URL CORRIGÉE — les lanceurs "\n'
    '         "« TOUT » (DEMARRER-TOUT-WINDOWS.bat / DEMARRER-TOUT-LINUX-MAC.sh) "\n'
    '         "préparent DÉSORMAIS le fichier .env (DATABASE_URL absolu) AVANT la "\n'
    '         "création de la base : sur un poste neuf, « prisma db push » ne peut "\n'
    '         "plus échouer avec P1012 « Environment variable not found: "\n'
    '         "DATABASE_URL » ; écriture atomique .env.tmp → move, valeurs "\n'
    '         "existantes préservées (PORT / PORTAL_PORT), jamais de doublon ; "\n'
    '         "DURCISSEMENT npm ≥ 11 : les 6 lanceurs testent le CLIENT GÉNÉRÉ "\n'
    '         "node_modules/.prisma/client/index.js (et non plus le seul paquet "\n'
    '         "@prisma/client) avant de sauter « prisma generate » — si npm a sauté "\n'
    '         "les scripts d\'installation, le client n\'existait pas et le site "\n'
    '         "plantait au démarrage ; generate UNIFIÉ dans DEMARRER-WINDOWS.bat ; "\n'
    '         "guide : entrée dédiée dans les problèmes courants · HÉRITAGE v0.2.201 — LANCEUR SUPERADMIN LINUX : nouveau "')

# ---- 8) Tableau 5.1 : ligne v0.2.202 -------------------------------------------
rep('                      "guide mis à jour aux trois endroits — test dédié "\n'
    '                      "12 contrôles, 0 échec."],],',
    '                      "guide mis à jour aux trois endroits — test dédié "\n'
    '                      "12 contrôles, 0 échec."],\n'
    '         ["v0.2.202", "INSTALLATION : ERREUR DATABASE_URL CORRIGÉE — "\n'
    '                      "les lanceurs « TOUT » (DEMARRER-TOUT-WINDOWS.bat / "\n'
    '                      "DEMARRER-TOUT-LINUX-MAC.sh) préparent le .env "\n'
    '                      "(DATABASE_URL absolu) AVANT « prisma db push » "\n'
    '                      "(poste neuf : plus de P1012) ; durcissement "\n'
    '                      "npm ≥ 11 : generate testé sur le client GÉNÉRÉ "\n'
    '                      "(.prisma/client/index.js) dans les 6 lanceurs ; "\n'
    '                      "generate unifié dans DEMARRER-WINDOWS.bat ; "\n'
    '                      "guide : entrée problèmes courants — test dédié "\n'
    '                      "34 contrôles, 0 échec."],],')

# ---- 9) Puce dédiée v0.2.202 (après la puce 201) --------------------------------
rep('        "contrôles — 360 contrôles au total, 0 échec."))',
    '        "contrôles — 360 contrôles au total, 0 échec."))\n'
    '    STORY.append(bul(\n'
    '        "<b>Installation : erreur « DATABASE_URL » corrigée (v0.2.202)</b> : DEMANDE "\n'
    '        "UTILISATEUR — « fix it » + capture d\'écran : sous Windows, "\n'
    '        "DEMARRER-TOUT-WINDOWS.bat → npm install réussi → « Error: Prisma validation "\n'
    '        "— error: Environment variable not found: DATABASE_URL » (P1012) → "\n'
    '        "« [ERREUR] La creation de la base de donnees a echoue. ». CAUSE : les deux "\n'
    '        "lanceurs « TOUT » (Windows + Linux/macOS) exécutaient l\'installation "\n'
    '        "commune (npm install + prisma db push) SANS préparer le fichier .env — "\n'
    '        "contrairement à tous les autres lanceurs ; sur un poste NEUF (aucun "\n'
    '        ".env) l\'échec était garanti. CORRECTIF : les deux lanceurs « TOUT » "\n'
    '        "préparent DÉSORMAIS le .env AVANT les commandes Prisma (DATABASE_URL="\n'
    '        "file:<dossier>/db/custom.db — écriture atomique .env.tmp → move, "\n'
    '        "valeurs existantes préservées : PORT / PORTAL_PORT conservés, "\n'
    '        "DATABASE_URL réécrite SANS doublon) + variable d\'environnement posée "\n'
    '        "en ceinture et bretelles ; AUTH_SECRET reste créé par les lanceurs "\n'
    '        "individuels (comportement inchangé, garde données conservée). "\n'
    '        "DURCISSEMENT (même capture : « npm warn install-scripts ») : npm ≥ 11 "\n'
    '        "peut sauter les scripts d\'installation → le postinstall de "\n'
    '        "@prisma/client (« prisma generate ») peut être sauté : le PAQUET "\n'
    '        "existait mais le CLIENT GÉNÉRÉ node_modules/.prisma/client n\'existait "\n'
    '        "pas — les 6 lanceurs (3 .bat Windows + 3 .sh Linux/macOS) testent "\n'
    '        "désormais node_modules/.prisma/client/index.js avant de sauter "\n'
    '        "« prisma generate », et DEMARRER-WINDOWS.bat gagne un generate UNIFIÉ "\n'
    '        "après l\'installation des dépendances (le site ne peut plus démarrer "\n'
    '        "sans client généré). GUIDE-INSTALLATION-LINUX-WINDOWS.txt : nouvelle "\n'
    '        "entrée « Environment variable not found: DATABASE_URL » dans les "\n'
    '        "problèmes courants (relancer simplement le lanceur). PREUVE : test "\n'
    '        "dédié scripts/test_v02202_env_tout_lanceurs.js — 34 contrôles dont "\n'
    '        "l\'EXÉCUTION RÉELLE du bloc extrait du lanceur Linux sur un dossier "\n'
    '        "VIERGE suivi d\'un VRAI « prisma db push » (base SQLite créée, en-tête "\n'
    '        "vérifiée) et des 3 scénarios .env (aucun .env → créé ; .env existant → "\n'
    '        "PORT / PORTAL_PORT conservés + DATABASE_URL ajoutée une seule fois ; "\n'
    '        "DATABASE_URL déjà présente → réécrite sans doublon) ; non-régression "\n'
    '        "v0.2.186→201 relancée : 360 contrôles — 394 contrôles au total, "\n'
    '        "0 échec."))')

# ---- 10) Marqueurs verifier du générateur ---------------------------------------
rep('"V0.2.201", "ServiceRH", "ÉDITION ESSENTIELLE",',
    '"V0.2.202", "ServiceRH", "ÉDITION ESSENTIELLE",')
rep('"201 versions", "Temps de développement et de test", "jours-homme", "Tableau 1.2",',
    '"202 versions", "Temps de développement et de test", "jours-homme", "Tableau 1.2",\n'
    '        "CREER-SUPERADMIN-LINUX-MAC", "DEMARRER-TOUT",')

# ---- 11) Annexe ------------------------------------------------------------------
rep("État du code livré v0.2.201. Trois rôles",
    "État du code livré v0.2.202. Trois rôles")

# ---- 12) Chemins de sortie des PDF ---------------------------------------------
rep('os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.201.pdf")',
    'os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.202.pdf")')
rep('os.path.join(RACINE, "download", "servicerh-readme-technique-reduit-v0.2.201.pdf")',
    'os.path.join(RACINE, "download", "servicerh-readme-technique-reduit-v0.2.202.pdf")')

io.open(DST, "w", encoding="utf-8").write(src)
print("transformer_readme_v02202 : %d remplacements → %s" % (remplacements, DST))
