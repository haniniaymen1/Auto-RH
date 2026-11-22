#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Transforme creer_readme_essentiel_v02200.py en creer_readme_essentiel_v02201.py
(édition v0.2.201 — LANCEUR LINUX/macOS DE CRÉATION DU SUPERADMIN — demande
utilisateur : « script de creation compte super admin n existe pas pour linux ».
NOUVEAU CREER-SUPERADMIN-LINUX-MAC.sh : équivalent du CREER-SUPERADMIN-WINDOWS.bat
(même menu interactif 1 état / 2 créer / 3 promouvoir / 4 quitter, mêmes gardes :
Node présent, ZIP décompressé, projet installé) ; exécution réelle vérifiée ;
GUIDE-INSTALLATION-LINUX-WINDOWS.txt mis à jour aux trois endroits (installation
Linux, compte administrateur, compte oubli) — plus d'instruction directe
« node scripts/creer-superadmin.js » dans le guide.)"""
import io, os

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creer_readme_essentiel_v02200.py")
DST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creer_readme_essentiel_v02201.py")

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

# ---- 1) Docstring : titre + bloc v0.2.201 ------------------------------------
rep("README officiel ServiceRH — ÉDITION ESSENTIELLE v0.2.200 (~15 pages).",
    "README officiel ServiceRH — ÉDITION ESSENTIELLE v0.2.201 (~15 pages).\n\n"
    "Demande utilisateur (v0.2.201) : « script de creation compte super admin n\n"
    "existe pas pour linux » : NOUVEAU CREER-SUPERADMIN-LINUX-MAC.sh à la racine\n"
    "du projet et du ZIP — équivalent Linux/macOS du CREER-SUPERADMIN-WINDOWS.bat :\n"
    "même menu interactif (1 état des comptes, 2 CRÉER un superadministrateur,\n"
    "3 promouvoir un compte existant, 4 quitter), mêmes gardes avant lancement\n"
    "(Node.js présent, ZIP décompressé, projet installé sinon renvoi vers\n"
    "INSTALLER-ET-DEMARRER-LINUX-MAC.sh), messages d'erreur ASCII ; le menu lance\n"
    "scripts/creer-superadmin.js (saisie de mot de passe MASQUÉE) ; exécution\n"
    "réelle vérifiée (option 1 : « aucun compte — créez le premier via l'option 2 »\n"
    "sur la base vierge v0.2.200). GUIDE-INSTALLATION-LINUX-WINDOWS.txt mis à\n"
    "jour aux trois endroits (installation Linux, compte administrateur, compte\n"
    "oublié) — l'instruction directe « node scripts/creer-superadmin.js » est\n"
    "remplacée par le lanceur.")

# ---- 2) EDITION ---------------------------------------------------------------
rep('EDITION = "v0.2.200"', 'EDITION = "v0.2.201"')

# ---- 3) Bandeau de couverture --------------------------------------------------
rep('espacer("README OFFICIEL · ÉDITION ESSENTIELLE · V0.2.200")',
    'espacer("README OFFICIEL · ÉDITION ESSENTIELLE · V0.2.201")')

# ---- 4) Intro de couverture : phrase v0.2.201 ----------------------------------
rep('"des ports sous Linux et Windows (GUIDE-INSTALLATION-LINUX-WINDOWS.txt)."))',
    '"des ports sous Linux et Windows (GUIDE-INSTALLATION-LINUX-WINDOWS.txt). Depuis "\n'
    '        "la v0.2.201, le lanceur CREER-SUPERADMIN-LINUX-MAC.sh offre sous Linux/macOS "\n'
    '        "le même menu de création du superadministrateur que sous Windows."))')

# ---- 5) Blocs de couverture ----------------------------------------------------
rep('"Réalisé du 12 septembre au 12 octobre 2026 — <b>31 jours calendaires</b>, 200 versions "',
    '"Réalisé du 12 septembre au 12 octobre 2026 — <b>31 jours calendaires</b>, 201 versions "')

# ---- 6) DIFFUSION : nom du fichier ---------------------------------------------
rep("Fichier : download/servicerh-readme-technique-v0.2.200.pdf.",
    "Fichier : download/servicerh-readme-technique-v0.2.201.pdf.")

# ---- 7) SOURCES : tête du bloc --------------------------------------------------
rep('"Code source livré v0.2.200 (BASE VIERGE + GUIDE D\'INSTALLATION — les "',
    '"Code source livré v0.2.201 (LANCEUR SUPERADMIN LINUX — NOUVEAU "\n'
    '         "CREER-SUPERADMIN-LINUX-MAC.sh : équivalent Linux/macOS du "\n'
    '         "CREER-SUPERADMIN-WINDOWS.bat, même menu interactif (1 état des "\n'
    '         "comptes, 2 CRÉER un superadministrateur, 3 promouvoir un compte "\n'
    '         "existant, 4 quitter), mêmes gardes (Node présent, ZIP décompressé, "\n'
    '         "projet installé), mot de passe masqué ; exécution réelle vérifiée "\n'
    '         "sur la base vierge ; GUIDE-INSTALLATION-LINUX-WINDOWS.txt mis à "\n'
    '         "jour aux trois endroits · HÉRITAGE v0.2.200 — BASE VIERGE + GUIDE D\'INSTALLATION : les "')

# ---- 8) Tableau 5.1 : ligne v0.2.201 -------------------------------------------
rep('"problèmes courants — test dédié 18 contrôles, 0 échec."],],',
    '"problèmes courants — test dédié 18 contrôles, 0 échec."],\n'
    '         ["v0.2.201", "LANCEUR SUPERADMIN LINUX — NOUVEAU "\n'
    '                      "CREER-SUPERADMIN-LINUX-MAC.sh : équivalent du "\n'
    '                      ".bat Windows (menu interactif : état des comptes, "\n'
    '                      "CRÉER un superadministrateur, promouvoir un compte "\n'
    '                      "existant, quitter ; gardes Node / ZIP / "\n'
    '                      "installation ; mot de passe masqué) ; exécution "\n'
    '                      "réelle vérifiée (option 1 sur la base vierge) ; "\n'
    '                      "guide mis à jour aux trois endroits — test dédié "\n'
    '                      "12 contrôles, 0 échec."],],')

# ---- 9) Puce dédiée v0.2.201 (après la puce 200) --------------------------------
rep("— 348 contrôles au total, 0 échec.\"))",
    "— 348 contrôles au total, 0 échec.\"))\n"
    '    STORY.append(bul(\n'
    '        "<b>Lanceur superadmin Linux (v0.2.201)</b> : DEMANDE UTILISATEUR — « script "\n'
    '        "de creation compte super admin n existe pas pour linux ». Effectivement, "\n'
    '        "Windows disposait de CREER-SUPERADMIN-WINDOWS.bat mais Linux/macOS n\'avait "\n'
    '        "que l\'instruction directe node scripts/creer-superadmin.js (et la création "\n'
    '        "par le script d\'installation) : NOUVEAU CREER-SUPERADMIN-LINUX-MAC.sh à la "\n'
    '        "racine du projet et du ZIP, équivalent fidèle du .bat Windows — même menu "\n'
    '        "interactif (1 : état des comptes RH/IT/superadmin avec e-mails et noms "\n'
    '        "déchiffrés, 2 : CRÉER un compte superadministrateur, 3 : promouvoir un "\n'
    '        "compte existant, 4 : quitter), mêmes gardes AVANT lancement (Node.js "\n'
    '        "présent sinon lien nodejs.org + commande Ubuntu/Debian ; ZIP décompressé "\n'
    '        "sinon renvoi vers le ZIP complet ; dépendances installées sinon renvoi "\n'
    '        "vers bash INSTALLER-ET-DEMARRER-LINUX-MAC.sh), exécution via « exec node "\n'
    '        "scripts/creer-superadmin.js » (mot de passe SAISIE MASQUÉE, comptes "\n'
    '        "chiffrés en base comme le login — Task 32) ; bit exécutable + syntaxe "\n'
    '        "vérifiées, messages d\'erreur ASCII stricts (aucun souci d\'encodage "\n'
    '        "terminal). EXÉCUTION RÉELLE vérifiée : option 1 sur la base vierge "\n'
    '        "v0.2.200 affiche « aucun compte — créez le premier via l\'option 2 » et "\n'
    '        "« Aucun superadministrateur actif : creez-en un (option 2 ou 3) ». "\n'
    '        "GUIDE-INSTALLATION-LINUX-WINDOWS.txt mis à jour aux trois endroits "\n'
    '        "(section installation Linux : créer le compte PLUS TARD ; section compte "\n'
    '        "administrateur : même menu que sous Windows ; section problèmes courants : "\n'
    '        "compte oublié) — plus aucune instruction directe « node scripts/creer-"\n'
    '        "superadmin.js » dans le guide. Preuve : test dédié "\n'
    '        "scripts/test_v02201_lanceur_superadmin.js — 12 contrôles dont "\n'
    '        "l\'EXÉCUTION RÉELLE du lanceur (menu ouvert, état lu dans la base vierge), "\n'
    '        "bash -n, gardes, guide ; non-régression v0.2.186→200 relancée : 348 "\n'
    '        "contrôles — 360 contrôles au total, 0 échec."))')

# ---- 10) Marqueurs verifier du générateur ---------------------------------------
rep('"V0.2.200", "ServiceRH", "ÉDITION ESSENTIELLE",',
    '"V0.2.201", "ServiceRH", "ÉDITION ESSENTIELLE",')
rep('"200 versions", "Temps de développement et de test", "jours-homme", "Tableau 1.2",',
    '"201 versions", "Temps de développement et de test", "jours-homme", "Tableau 1.2",\n'
    '        "CREER-SUPERADMIN-LINUX-MAC",')
rep('"GUIDE-INSTALLATION-LINUX-WINDOWS", "BASE VIERGE", "supprimés",',
    '"GUIDE-INSTALLATION-LINUX-WINDOWS", "BASE VIERGE", "supprimés",')

# ---- 11) Annexe ------------------------------------------------------------------
rep("État du code livré v0.2.200. Trois rôles",
    "État du code livré v0.2.201. Trois rôles")

# ---- 12) Chemins de sortie des PDF ---------------------------------------------
rep('os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.200.pdf")',
    'os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.201.pdf")')
rep('os.path.join(RACINE, "download", "servicerh-readme-technique-reduit-v0.2.200.pdf")',
    'os.path.join(RACINE, "download", "servicerh-readme-technique-reduit-v0.2.201.pdf")')

io.open(DST, "w", encoding="utf-8").write(src)
print("transformer_readme_v02201 : %d remplacements → %s" % (remplacements, DST))
