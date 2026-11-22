#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Transforme creer_readme_essentiel_v02197.py en creer_readme_essentiel_v02198.py
(édition v0.2.198 — PORTS DES DEUX INTERFACES MODIFIABLES PAR LE .ENV :
demande utilisateur « comment changer les deux ports de deux interfaces ? ».
PORT=XXXX (administration RH/IT, défaut 3000) et PORTAL_PORT=XXXX (portail
employés, défaut 4001) se lisent désormais dans le .env de la racine ;
plus AUCUN repli du portail sur PORT (suppression du conflit EADDRINUSE) ;
correctif des affichages erronés (portail Windows annonçait 3001 au lieu de
4001, site Linux annonçait 4000 au lieu de 3000) ; les 8 lanceurs lisent le
.env, affichent les vrais ports et ouvrent le navigateur sur le bon port ;
redemarrer-services-4000-4001.js et service-paiesage.js respectent le .env
(variables PAIESAGE_PORT_* prioritaires, défauts historiques conservés).)"""
import io, os

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creer_readme_essentiel_v02197.py")
DST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creer_readme_essentiel_v02198.py")

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

# ---- 1) Docstring : titre + bloc v0.2.198 ------------------------------------
rep("README officiel ServiceRH — ÉDITION ESSENTIELLE v0.2.197 (~15 pages).",
    "README officiel ServiceRH — ÉDITION ESSENTIELLE v0.2.198 (~15 pages).\n\n"
    "Demande utilisateur (v0.2.198) : « comment changer les deux ports de deux\n"
    "interfaces ? » — NOUVEAU : les deux serveurs lisent leur port dans le fichier\n"
    ".env de la racine — PORT=XXXX pour l'administration RH/IT (défaut 3000) et\n"
    "PORTAL_PORT=XXXX pour le portail employés (défaut 4001) ; mettez TOUJOURS les\n"
    "deux lignes avec des valeurs DIFFÉRENTES puis redémarrez les deux interfaces.\n"
    "CORRECTIFS inclus : le portail ne récupère PLUS le PORT de l'administration\n"
    "(l'ancien repli démarrait les deux serveurs sur le même port → EADDRINUSE) ;\n"
    "le lanceur Windows du portail annonçait le port 3001 alors que le portail\n"
    "écoute en réalité sur 4001 ; le lanceur Linux de l'administration annonçait\n"
    "4000 alors que le site écoute sur 3000. Les 8 lanceurs (3 .bat Windows, 3 .sh\n"
    "Linux/macOS, 2 .vbs silencieux) affichent les VRAIS ports et ouvrent le\n"
    "navigateur sur le port configuré ; redemarrer-services-4000-4001.js (relance\n"
    "après mise à jour) et service-paiesage.js (mode silencieux) respectent le\n"
    ".env — PAIESAGE_PORT_ADMIN / PAIESAGE_PORT_PORTAIL restent prioritaires et\n"
    "les défauts historiques (4000 / 4001) sont conservés.")

# ---- 2) EDITION ---------------------------------------------------------------
rep('EDITION = "v0.2.197"', 'EDITION = "v0.2.198"')

# ---- 3) Bandeau de couverture --------------------------------------------------
rep('espacer("README OFFICIEL · ÉDITION ESSENTIELLE · V0.2.197")',
    'espacer("README OFFICIEL · ÉDITION ESSENTIELLE · V0.2.198")')

# ---- 4) Intro de couverture : phrase v0.2.198 ----------------------------------
rep('"demande de parrainage (nouveau champ « demandes de parrainage (copie) »)."))',
    '"demande de parrainage (nouveau champ « demandes de parrainage (copie) »). Depuis "\n'
    '        "la v0.2.198, les ports des deux interfaces se règlent dans le fichier .env "\n'
    '        "(PORT / PORTAL_PORT)."))')

# ---- 5) Blocs de couverture ----------------------------------------------------
rep('"Réalisé du 12 septembre au 12 octobre 2026 — <b>31 jours calendaires</b>, 197 versions "',
    '"Réalisé du 12 septembre au 12 octobre 2026 — <b>31 jours calendaires</b>, 198 versions "')

# ---- 6) DIFFUSION : nom du fichier ---------------------------------------------
rep("Fichier : download/servicerh-readme-technique-v0.2.197.pdf.",
    "Fichier : download/servicerh-readme-technique-v0.2.198.pdf.")

# ---- 7) SOURCES : tête du bloc --------------------------------------------------
rep('"Code source livré v0.2.197 (PARRAINAGE EN COPIE — le responsable principal du "',
    '"Code source livré v0.2.198 (PORTS MODIFIABLES — les deux interfaces écoutent sur "\n'
    '         "des ports configurables par le fichier .env de la racine : PORT pour "\n'
    '         "l\'administration RH/IT (défaut 3000), PORTAL_PORT pour le portail employés "\n'
    '         "(défaut 4001) ; plus AUCUN repli du portail sur PORT — plus de conflit de "\n'
    '         "port au démarrage (EADDRINUSE) ; les 8 lanceurs (3 .bat Windows, 3 .sh "\n'
    '         "Linux/macOS, 2 .vbs silencieux) lisent le .env, affichent les vrais ports "\n'
    '         "et ouvrent le navigateur sur le bon port ; redemarrer-services-4000-4001.js "\n'
    '         "et service-paiesage.js respectent le .env, variables PAIESAGE_PORT_* "\n'
    '         "prioritaires, défauts historiques 4000 / 4001 conservés · HÉRITAGE "\n'
    '         "v0.2.197 — PARRAINAGE EN COPIE : le responsable principal du "')

# ---- 8) Tableau 5.1 : ligne v0.2.198 -------------------------------------------
rep('"contrôles + E2E routage 30 contrôles + non-régression 268 "\n'
    '                      "contrôles, 0 échec."],],',
    '"contrôles + E2E routage 30 contrôles + non-régression 268 "\n'
    '                      "contrôles, 0 échec."],\n'
    '         ["v0.2.198", "PORTS MODIFIABLES — PORT (administration, défaut 3000) et "\n'
    '                      "PORTAL_PORT (portail employés, défaut 4001) configurables dans "\n'
    '                      "le .env de la racine ; plus AUCUN repli du portail sur PORT "\n'
    '                      "(suppression du conflit de port au démarrage) ; 8 lanceurs mis "\n'
    '                      "à jour (lecture .env, affichage des vrais ports, navigateur "\n'
    '                      "ouvert sur le bon port — plus de 3001 fantôme côté Windows ni "\n'
    '                      "de 4000 obsolète côté Linux) ; redemarrer-services-4000-4001.js "\n'
    '                      "et service-paiesage.js respectent le .env (PAIESAGE_PORT_* "\n'
    '                      "prioritaires) — test dédié 48 contrôles + non-régression 254 "\n'
    '                      "contrôles (302 au total), 0 échec."],],')

# ---- 9) Puce dédiée v0.2.198 (après la puce 197) --------------------------------
rep('"contrôles, 0 échec — 320 contrôles au total."))',
    '"contrôles, 0 échec — 320 contrôles au total."))\n'
    '    STORY.append(bul(\n'
    '        "<b>Ports des deux interfaces modifiables (v0.2.198)</b> : DEMANDE "\n'
    '        "UTILISATEUR — « comment changer les deux ports de deux interfaces ? ». "\n'
    '        "Les deux serveurs lisent désormais leur port dans le fichier .env de la "\n'
    '        "racine : PORT=XXXX pour l\'administration RH/IT (défaut 3000) et "\n'
    '        "PORTAL_PORT=XXXX pour le portail employés (défaut 4001) — mettez "\n'
    '        "TOUJOURS les deux lignes avec des valeurs différentes puis redémarrez "\n'
    '        "les deux interfaces. CORRECTIFS inclus : le portail ne récupère plus le "\n'
    '        "PORT de l\'administration (avant, ajouter PORT au .env démarrait les deux "\n'
    '        "serveurs sur le MÊME port — erreur « EADDRINUSE ») ; le lanceur Windows "\n'
    '        "du portail annonçait le port 3001 alors que le portail écoute en réalité "\n'
    '        "sur 4001 (le navigateur s\'ouvrait donc sur une page introuvable) ; le "\n'
    '        "lanceur Linux de l\'administration annonçait 4000 alors que le site "\n'
    '        "écoute sur 3000. Les 8 lanceurs (DEMARRER-WINDOWS.bat, DEMARRER-PORTAIL-"\n'
    '        "WINDOWS.bat, DEMARRER-TOUT-WINDOWS.bat, les 3 .sh Linux/macOS et les "\n'
    '        "2 .vbs du démarrage silencieux) affichent les VRAIS ports et ouvrent le "\n'
    '        "navigateur sur le port configuré ; redemarrer-services-4000-4001.js "\n'
    '        "(relance après mise à jour) et service-paiesage.js (mode silencieux) "\n'
    '        "respectent eux aussi le .env — PAIESAGE_PORT_ADMIN / PAIESAGE_PORT_"\n'
    '        "PORTAIL restent prioritaires et les défauts historiques (4000 / 4001) "\n'
    '        "sont conservés. Preuve : test dédié scripts/test_v02198_ports.js — "\n'
    '        "48 contrôles sur le CODE RÉEL (résolution du port du portail, lanceurs "\n'
    '        "Windows/Linux/VBS, lirePortEnv éprouvé sur un .env temporaire, priorités "\n'
    '        "PAIESAGE_PORT_*) ; non-régression v0.2.186→197 relancée : 254 contrôles "\n'
    '        "— 302 contrôles au total, 0 échec."))')

# ---- 10) Marqueurs verifier du générateur ---------------------------------------
rep('"V0.2.197", "ServiceRH", "ÉDITION ESSENTIELLE",',
    '"V0.2.198", "ServiceRH", "ÉDITION ESSENTIELLE",')
rep('"197 versions", "Temps de développement et de test", "jours-homme", "Tableau 1.2",',
    '"198 versions", "Temps de développement et de test", "jours-homme", "Tableau 1.2",\n'
    '        "PORTS MODIFIABLES", "PORTAL_PORT", "EADDRINUSE",\n'
    '        "lirePortEnv", "redemarrer-services",')

# ---- 11) Annexe ------------------------------------------------------------------
rep("État du code livré v0.2.197. Trois rôles",
    "État du code livré v0.2.198. Trois rôles")

# ---- 12) Chemins de sortie des PDF ---------------------------------------------
rep('os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.197.pdf")',
    'os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.198.pdf")')
rep('os.path.join(RACINE, "download", "servicerh-readme-technique-reduit-v0.2.197.pdf")',
    'os.path.join(RACINE, "download", "servicerh-readme-technique-reduit-v0.2.198.pdf")')

io.open(DST, "w", encoding="utf-8").write(src)
print("transformer_readme_v02198 : %d remplacements → %s" % (remplacements, DST))
