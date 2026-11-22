#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Transforme creer_readme_essentiel_v02202.py en creer_readme_essentiel_v02203.py
(édition v0.2.203 — DÉMARRAGE / ARRÊT SILENCIEUX EN ARRIÈRE-PLAN, Windows ET
Linux — demande utilisateur : « démarrage et arrêt du serveur en arrière-plan,
en mode totalement silencieux... aucune fenêtre de terminal, popup ou
interruption de l'application ». Livré : moteur scripts/service-paiesage.js
(commande record + repli d'arrêt PRÉCIS par découverte de ports avec contrôle
que le processus est bien node — jamais de kill/taskkill global), handlers
SIGTERM/SIGINT dans start-prod.js, anti-double-instance + enregistrement des
PIDs dans DEMARRER-TOUT-LINUX-MAC.sh, VBS Windows rendant la main immédiatement
sans AUCUN popup au flux normal, 4 NOUVEAUX scripts Linux (DEMARRER/ARRETER/
ETAT/JOURNAUX-SILENCIEUX-LINUX-MAC.sh), guide section 6.)"""
import io, os

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creer_readme_essentiel_v02202.py")
DST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creer_readme_essentiel_v02203.py")

src = io.open(SRC, encoding="utf-8").read()
n_rep = 0

def rep(ancien, nouveau):
    global src, n_rep
    n = src.count(ancien)
    if n != 1:
        raise SystemExit("ANCRE (%d trouvée, 1 requise) : %r" % (n, ancien[:90]))
    src = src.replace(ancien, nouveau, 1)
    n_rep += 1

# ---- 1) Docstring -------------------------------------------------------------
rep("README officiel ServiceRH — ÉDITION ESSENTIELLE v0.2.202 (~15 pages).",
    "README officiel ServiceRH — ÉDITION ESSENTIELLE v0.2.203 (~15 pages).\n\n"
    "Demande utilisateur (v0.2.203) : démarrage et ARRÊT du serveur en arrière-\n"
    "plan, TOTALEMENT silencieux, Windows ET Linux — aucune fenêtre CMD/\n"
    "PowerShell/Bash, aucun popup, arrêt précis sans kill/taskkill global,\n"
    "libération des ports, aucun processus résiduel, logs en fichiers. Livré :\n"
    "moteur scripts/service-paiesage.js (commande record pour les lanceurs\n"
    "externes + REPLI D'ARRÊT PRÉCIS : découverte des processus à l'écoute des\n"
    "ports du .env, contrôle que le binaire est bien node via /proc/<pid>/exe\n"
    "(Next renomme son processus : « next-server », « MainThread ») — jamais\n"
    "global, non-node signalé et épargné) ; handlers SIGTERM/SIGINT dans\n"
    "start-prod.js (journal + exit 0) ; DEMARRER-TOUT-LINUX-MAC.sh : anti-\n"
    "double-instance + enregistrement des PIDs démarrés ; VBS Windows rendent\n"
    "la main IMMÉDIATEMENT sans AUCUN popup au flux normal (état/journaux\n"
    "consultables à l'initiative de l'utilisateur via ETAT/JOURNAUX) ; 4\n"
    "NOUVEAUX scripts Linux silencieux ; guide section 6. Preuve : test dédié\n"
    "33 contrôles dont le CYCLE RÉEL COMPLET sur les serveurs (arrêt silencieux\n"
    "→ ports libérés → démarrage arrière-plan rendant la main → PIDs\n"
    "enregistrés → état → arrêt précis par PIDs → redémarrage final) ;\n"
    "non-régression 394 contrôles — 427 au total, 0 échec.")

# ---- 2) EDITION ---------------------------------------------------------------
rep('EDITION = "v0.2.202"', 'EDITION = "v0.2.203"')

# ---- 3) Bandeau de couverture --------------------------------------------------
rep('espacer("README OFFICIEL · ÉDITION ESSENTIELLE · V0.2.202")',
    'espacer("README OFFICIEL · ÉDITION ESSENTIELLE · V0.2.203")')

# ---- 4) Intro de couverture ----------------------------------------------------
rep('"à la première installation est corrigée."))',
    '"à la première installation est corrigée. Depuis la v0.2.203, les deux "\n'
    '        "interfaces démarrent et s\'arrêtent en arrière-plan de façon "\n'
    '        "TOTALEMENT silencieuse (aucune fenêtre, aucun popup), sous Windows "\n'
    '        "comme sous Linux."))')

# ---- 5) Blocs de couverture ----------------------------------------------------
rep('"Réalisé du 12 septembre au 12 octobre 2026 — <b>31 jours calendaires</b>, 202 versions "',
    '"Réalisé du 12 septembre au 12 octobre 2026 — <b>31 jours calendaires</b>, 203 versions "')

# ---- 6) DIFFUSION : nom du fichier ---------------------------------------------
rep("Fichier : download/servicerh-readme-technique-v0.2.202.pdf.",
    "Fichier : download/servicerh-readme-technique-v0.2.203.pdf.")

# ---- 7) SOURCES : tête du bloc --------------------------------------------------
rep('         "Code source livré v0.2.202 (INSTALLATION : ERREUR DATABASE_URL CORRIGÉE — les lanceurs "',
    '         "Code source livré v0.2.203 (DÉMARRAGE/ARRÊT SILENCIEUX EN ARRIÈRE-PLAN — Windows ET Linux : "\n'
    '         "moteur scripts/service-paiesage.js enrichi — commande RECORD pour "\n'
    '         "les lanceurs externes (fusion des PIDs) et REPLI D\'ARRÊT PRÉCIS : "\n'
    '         "découverte des processus à l\'écoute des PORTS du .env (netstat -ano "\n'
    '         "sous Windows, ss puis lsof sous Linux) + contrôle que le BINAIRE est "\n'
    '         "bien node via /proc/PID/exe (les serveurs renomment leur "\n'
    '         "processus : « next-server », « MainThread ») — JAMAIS de "\n'
    '         "taskkill/killall global, un port occupé par un non-node est "\n'
    '         "signalé et ÉPARGNÉ ; handlers SIGTERM/SIGINT dans start-prod.js "\n'
    '         "(journal « arrêt du serveur » + exit 0) ; DEMARRER-TOUT-LINUX-MAC.sh : "\n'
    '         "anti-double-instance (une interface qui répond n\'est pas relancée) "\n'
    '         "+ enregistrement des PIDs démarrés ; VBS Windows rendent la main "\n'
    '         "IMMÉDIATEMENT, plus AUCUN popup au flux normal (état/journaux via "\n'
    '         "ETAT-SILENCIEUX / JOURNAUX-SILENCIEUX, à l\'initiative de "\n'
    '         "l\'utilisateur) ; 4 NOUVEAUX scripts Linux : DEMARRER/ARRETER/ETAT/"\n'
    '         "JOURNAUX-SILENCIEUX-LINUX-MAC.sh ; guide section 6 · HÉRITAGE v0.2.202 — INSTALLATION : ERREUR DATABASE_URL CORRIGÉE — les lanceurs "')

# ---- 8) Tableau 5.1 : ligne v0.2.203 -------------------------------------------
rep('                      "guide : entrée problèmes courants — test dédié "\n'
    '                      "34 contrôles, 0 échec."],],',
    '                      "guide : entrée problèmes courants — test dédié "\n'
    '                      "34 contrôles, 0 échec."],\n'
    '         ["v0.2.203", "DÉMARRAGE/ARRÊT SILENCIEUX EN ARRIÈRE-PLAN "\n'
    '                      "(Windows ET Linux) : moteur enrichi (record + "\n'
    '                      "arrêt PRÉCIS par ports avec contrôle du binaire "\n'
    '                      "node), SIGTERM/SIGINT dans start-prod.js, "\n'
    '                      "anti-double-instance + PIDs dans "\n'
    '                      "DEMARRER-TOUT-LINUX-MAC.sh, VBS sans AUCUN "\n'
    '                      "popup, 4 NOUVEAUX scripts Linux silencieux, "\n'
    '                      "guide section 6 — test dédié "\n'
    '                      "33 contrôles, 0 échec."],],')

# ---- 9) Puce dédiée v0.2.203 (après la puce 202) --------------------------------
rep('        "v0.2.186→201 relancée : 360 contrôles — 394 contrôles au total, "\n'
    '        "0 échec."))',
    '        "v0.2.186→201 relancée : 360 contrôles — 394 contrôles au total, "\n'
    '        "0 échec."))\n'
    '    STORY.append(bul(\n'
    '        "<b>Démarrage et arrêt silencieux en arrière-plan (v0.2.203)</b> : DEMANDE "\n'
    '        "UTILISATEUR — démarrage et arrêt du serveur en arrière-plan, "\n'
    '        "TOTALEMENT silencieux, Windows ET Linux : aucune fenêtre "\n'
    '        "CMD/PowerShell/Bash, aucun popup, arrêt uniquement du processus du "\n'
    '        "serveur concerné, fermeture propre quand possible, libération des "\n'
    '        "ports, aucun processus résiduel, logs en fichiers, aucun changement "\n'
    '        "dégradant de l\'existant. WINDOWS : le moteur scripts/"\n'
    '        "service-paiesage.js (déjà présent) est conservé et ENRICHI — spawn "\n'
    '        "détaché windowsHide (aucune fenêtre noire), PIDs dans "\n'
    '        "logs/paiesage-processus.json, journaux en fichiers ; DEMARRER-SILENCIEUX-WINDOWS.vbs "\n'
    '        "et ARRETER-SILENCIEUX-WINDOWS.vbs rendent la main IMMÉDIATEMENT et "\n'
    '        "n\'affichent plus AUCUN popup au flux normal (plus de fenêtre de "\n'
    '        "confirmation, plus de navigateur ouvert automatiquement) — l\'état "\n'
    '        "reste consultable AVEC ETAT-SILENCIEUX-WINDOWS.vbs et les "\n'
    '        "journaux avec JOURNAUX-SILENCIEUX-WINDOWS.vbs, à l\'initiative de "\n'
    '        "l\'utilisateur ; l\'arrêt est IDEMPOTENT et VÉRIFIE que les ports "\n'
    '        "sont libres. ARRÊT PRÉCIS (les deux systèmes) : d\'abord les PIDs "\n'
    '        "enregistrés (arbre des processus), SINON découverte des processus à "\n'
    '        "l\'écoute des ports du .env (netstat -ano sous Windows ; ss puis "\n'
    '        "lsof sous Linux) AVEC contrôle que le BINAIRE réel est bien node "\n'
    '        "(/proc/PID/exe — les serveurs renomment leur processus via "\n'
    '        "process.title : « next-server (v1... », « MainThread ») : un port "\n'
    '        "occupé par un AUTRE programme est signalé et JAMAIS arrêté — "\n'
    '        "aucune commande globale taskkill/killall ; L\'arrêt gracieux : les "\n'
    '        "serveurs gèrent SIGTERM (portail : server.close déjà en place ; "\n'
    '        "administration : handlers ajoutés dans start-prod.js avec journal "\n'
    '        "« arrêt du serveur » et exit 0). LINUX : 4 NOUVEAUX scripts à la "\n'
    '        "racine (DEMARRER-SILENCIEUX-LINUX-MAC.sh : rend la main "\n'
    '        "immédiatement, tout en nohup journalisé ; ARRETER-SILENCIEUX-LINUX-MAC.sh : "\n'
    '        "moteur stop précis ; ETAT-SILENCIEUX-LINUX-MAC.sh : état des "\n'
    '        "serveurs ; JOURNAUX-SILENCIEUX-LINUX-MAC.sh : dernières lignes des "\n'
    '        "journaux) ; DEMARRER-TOUT-LINUX-MAC.sh gagne l\'ANTI-DOUBLE-INSTANCE "\n'
    '        "(une interface qui répond déjà n\'est PAS relancée) et l\'enregistrement "\n'
    '        "des PIDs démarrés (commande record, fusion « 0 = conserver "\n'
    '        "l\'existant ») : l\'arrêt silencieux fonctionne donc quel que soit "\n'
    '        "le mode de démarrage. GUIDE : nouvelle section 6 « DEMARRAGE ET "\n'
    '        "ARRET SILENCIEUX (ARRIERE-PLAN) ». PREUVE : test dédié "\n'
    '        "scripts/test_v02203_silencieux.js — 33 contrôles dont le CYCLE "\n'
    '        "RÉEL COMPLET sur les serveurs du projet : arrêt silencieux (ports "\n'
    '        "libérés, ETAT=OK journalisé), démarrage arrière-plan rendant la "\n'
    '        "main en moins de 20 s, PIDs enregistrés, état « EN FONCTIONNEMENT », "\n'
    '        "arrêt PRÉCIS par PIDs (aucun processus résiduel), redémarrage final "\n'
    '        "(application utilisable) ; découverte des vrais processus renommés "\n'
    '        "(next-server / MainThread) prouvée en exécution ; non-régression "\n'
    '        "v0.2.186→202 relancée : 394 contrôles — 427 contrôles au total, "\n'
    '        "0 échec."))')

# ---- 10) Marqueurs verifier ------------------------------------------------------
rep('"V0.2.202", "ServiceRH", "ÉDITION ESSENTIELLE",',
    '"V0.2.203", "ServiceRH", "ÉDITION ESSENTIELLE",')
rep('"202 versions", "Temps de développement et de test", "jours-homme", "Tableau 1.2",',
    '"203 versions", "Temps de développement et de test", "jours-homme", "Tableau 1.2",\n'
    '        "DEMARRER-SILENCIEUX-LINUX-MAC", "service-paiesage",')

# ---- 11) Annexe ------------------------------------------------------------------
rep("État du code livré v0.2.202. Trois rôles",
    "État du code livré v0.2.203. Trois rôles")

# ---- 12) Chemins de sortie des PDF ---------------------------------------------
rep('os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.202.pdf")',
    'os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.203.pdf")')
rep('os.path.join(RACINE, "download", "servicerh-readme-technique-reduit-v0.2.202.pdf")',
    'os.path.join(RACINE, "download", "servicerh-readme-technique-reduit-v0.2.203.pdf")')

# ---- 13) Titre de métadonnées du PDF (resté à v0.2.191) -------------------------
rep('title="ServiceRH — README officiel — édition essentielle v0.2.191",',
    'title="ServiceRH — README officiel — édition essentielle v0.2.203",')

io.open(DST, "w", encoding="utf-8").write(src)
print("transformer_readme_v02203 : %d remplacements → %s" % (n_rep, DST))
