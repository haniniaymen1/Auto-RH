#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Transforme creer_readme_essentiel_v02191.py en creer_readme_essentiel_v02192.py
(édition v0.2.192 — boutons de gestion des comptes TOUJOURS accessibles)."""
import io, os

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creer_readme_essentiel_v02191.py")
DST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creer_readme_essentiel_v02192.py")

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

# ---- 1) Docstring : titre + bloc v0.2.192 ------------------------------------
rep("README officiel AutoRH — ÉDITION ESSENTIELLE v0.2.191 (~14 pages).",
    "README officiel AutoRH — ÉDITION ESSENTIELLE v0.2.192 (~15 pages).\n\n"
    "Demande utilisateur (v0.2.192) : « Afficher les boutons de gestion des comptes de manière\n"
    "plus pratique afin de faciliter leur utilisation, sans avoir à faire défiler les colonnes\n"
    "vers la gauche et vers la droite ». — COLONNE ACTIONS COLLANTE À DROITE du tableau\n"
    "« Comptes utilisateurs — superadministration » : les 5 boutons (Désactiver / Manager /\n"
    "Mot de passe / Rôle / Supprimer — et « Réactiver » le cas échéant) restent VISIBLES et\n"
    "CLIQUABLES même quand le tableau défile horizontalement (position sticky, fond opaque,\n"
    "séparation + ombre portée). Le hook de redimensionnement des colonnes est étendu par une\n"
    "option OPT-IN (attribut data-col-sticky=\"right\") qui RESPECTE la position collante au\n"
    "lieu d'imposer « relative » — les autres tableaux ne changent PAS de comportement.\n"
    "Compactage : colonnes secondaires masquées sur les écrans étroits (Manager < XL,\n"
    "Créé le < LG) et e-mail tronqué avec infobulle — à 1000 px de large le tableau ne défile\n"
    "PLUS du tout ; les poignées de redimensionnement restent fonctionnelles. Preuve :\n"
    "vérification navigateur réelle (colonnes mesurées au pixel, défilement forcé à 780 px —\n"
    "Actions collée au bord droit, boutons cliquables vérifiés par elementFromPoint, dialogue\n"
    "Rôle ouvert/fermé, sticky conservé) + build production OK.")

# ---- 2) EDITION ---------------------------------------------------------------
rep('EDITION = "v0.2.191"', 'EDITION = "v0.2.192"')

# ---- 3) Bandeau de couverture --------------------------------------------------
rep('espacer("README OFFICIEL · ÉDITION ESSENTIELLE · V0.2.191")',
    'espacer("README OFFICIEL · ÉDITION ESSENTIELLE · V0.2.192")')

# ---- 4) Intro de couverture : phrase v0.2.192 ----------------------------------
rep('"ET administration) — y compris l\'interrupteur maître « Envoi automatique de "\n'
    '        "l\'e-mail »."))',
    '"ET administration) — y compris l\'interrupteur maître « Envoi automatique de "\n'
    '        "l\'e-mail ». Depuis la v0.2.192, les boutons de gestion des comptes restent "\n'
    '        "TOUJOURS accessibles : la colonne Actions est COLLANTE à droite du tableau, "\n'
    '        "sans aucun défilement de colonnes."))')

# ---- 5) Blocs de couverture ----------------------------------------------------
rep('"Réalisé du 12 septembre au 12 octobre 2026 — <b>31 jours calendaires</b>, 191 versions "',
    '"Réalisé du 12 septembre au 12 octobre 2026 — <b>31 jours calendaires</b>, 192 versions "')

# ---- 6) DIFFUSION : nom du fichier ---------------------------------------------
rep("Fichier : download/servicerh-readme-technique-v0.2.191.pdf.",
    "Fichier : download/servicerh-readme-technique-v0.2.192.pdf.")

# ---- 7) SOURCES : tête du bloc -------------------------------------------------
rep('"Code source livré v0.2.191 (INTERRUPTHEURS E-MAIL EFFECTIFS DANS LES DEUX SENS — "\n'
    '         "panneau appliqué sur TOUTES les voies : maître OFF = aucun envoi, destinataire "',
    '"Code source livré v0.2.192 (BOUTONS DE GESTION TOUJOURS ACCESSIBLES — colonne "\n'
    '         "Actions du tableau « Comptes utilisateurs » COLLANTE à droite : Désactiver / "\n'
    '         "Manager / Mot de passe / Rôle / Supprimer visibles et cliquables SANS défilement "\n'
    '         "horizontal ; Manager masquée < XL, Créé le < LG ; e-mail tronqué avec infobulle · "\n'
    '         "INTERRUPTHEURS E-MAIL EFFECTIFS DANS LES DEUX SENS — "\n'
    '         "panneau appliqué sur TOUTES les voies : maître OFF = aucun envoi, destinataire "')

# ---- 8) Tableau 5.1 : ligne v0.2.192 -------------------------------------------
rep('"lecture silencieuse, client Prisma ancien)."],],',
    '"lecture silencieuse, client Prisma ancien)."],\n'
    '         ["v0.2.192", "BOUTONS DE GESTION TOUJOURS ACCESSIBLES : la colonne Actions du "\n'
    '                      "tableau « Comptes utilisateurs — superadministration » est COLLANTE "\n'
    '                      "à droite (sticky, fond opaque, séparation + ombre) — les 5 boutons "\n'
    '                      "restent visibles et cliquables SANS défilement horizontal ; "\n'
    '                      "colonnes secondaires masquées sur écrans étroits (Manager < XL, "\n'
    '                      "Créé le < LG) ; e-mail tronqué avec infobulle ; poignées de "\n'
    '                      "redimensionnement conservées (option data-col-sticky du hook)."],],')

# ---- 9) Puce dédiée v0.2.192 (après la puce 191) --------------------------------
rep('"document-refus, génération 189) — 0 échec ; node --check OK ; build OK."))',
    '"document-refus, génération 189) — 0 échec ; node --check OK ; build OK."))\n'
    '    STORY.append(bul(\n'
    '        "<b>Boutons de gestion toujours accessibles (v0.2.192)</b> : DEMANDE "\n'
    '        "UTILISATEUR — « Afficher les boutons de gestion des comptes de manière plus "\n'
    '        "pratique afin de faciliter leur utilisation, sans avoir à faire défiler les "\n'
    '        "colonnes vers la gauche et vers la droite ». CORRECTIF D\'AFFICHAGE dans le "\n'
    '        "tableau « Comptes utilisateurs — superadministration » : (1) la colonne "\n'
    '        "Actions est COLLANTE à droite (position sticky, fond opaque, séparation à "\n'
    '        "gauche + ombre portée) — Désactiver / Manager / Mot de passe / Rôle / "\n'
    '        "Supprimer (et « Réactiver » pour les comptes dont le délai d\'activation a "\n'
    '        "expiré) restent visibles et cliquables MÊME quand le tableau défile "\n'
    '        "horizontalement ; (2) le hook de redimensionnement des colonnes impose une "\n'
    '        "position « relative » à chaque en-tête : il est étendu par une option OPT-IN "\n'
    '        "(attribut data-col-sticky=&quot;right&quot;) qui respecte la position "\n'
    '        "collante — AUCUN changement pour les autres tableaux (poignées de "\n'
    '        "redimensionnement et double-clic de réinitialisation conservés) ; (3) "\n'
    '        "COMPACTAGE : colonnes secondaires masquées sur les écrans étroits (Manager "\n'
    '        "masquée sous XL, Créé le sous LG) et e-mail tronqué avec infobulle — à "\n'
    '        "1000 px de large le tableau ne défile PLUS du tout, et en dessous le seul "\n'
    '        "défilement résiduel n\'empêche plus JAMAIS d\'atteindre les boutons. "\n'
    '        "Modification d\'affichage SEULE : handlers, dialogues, API et permissions "\n'
    '        "inchangés (superadministrateur seul). Preuve : vérification navigateur "\n'
    '        "réelle — colonnes mesurées au pixel (1400 px : 7 colonnes et 5 boutons sans "\n'
    '        "défilement ; 1000 px : AUCUN défilement), défilement forcé à 780 px — "\n'
    '        "Actions collée au bord droit (écart 0 px) et boutons cliquables vérifiés "\n'
    '        "par elementFromPoint, dialogue « Rôle » ouvert puis fermé, position collante "\n'
    '        "conservée ; build production OK."))')

# ---- 10) Marqueurs verifier du générateur ---------------------------------------
rep('"V0.2.191", "AutoRH", "ÉDITION ESSENTIELLE",',
    '"V0.2.192", "AutoRH", "ÉDITION ESSENTIELLE",')
rep('"191 versions", "Temps de développement et de test", "jours-homme", "Tableau 1.2",',
    '"192 versions", "Temps de développement et de test", "jours-homme", "Tableau 1.2",\n'
    '        "Boutons de gestion toujours accessibles (v0.2.192)", "COLLANTE à droite",\n'
    '        "colonne Actions du tableau", "sans aucun défilement de colonnes",')
rep('"Interrupteurs e-mail effectifs dans les deux sens", "ENVOI_DESACTIVE",',
    '"Interrupteurs e-mail effectifs dans les deux sens", "ENVOI_DESACTIVE",\n'
    '        "Boutons de gestion toujours accessibles",')

# ---- 11) Annexe ------------------------------------------------------------------
rep("État du code livré v0.2.191. Trois rôles",
    "État du code livré v0.2.192. Trois rôles")

# ---- 12) Chemins de sortie des PDF ---------------------------------------------
rep('os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.191.pdf")',
    'os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.192.pdf")')
rep('os.path.join(RACINE, "download", "servicerh-readme-technique-reduit-v0.2.191.pdf")',
    'os.path.join(RACINE, "download", "servicerh-readme-technique-reduit-v0.2.192.pdf")')

io.open(DST, "w", encoding="utf-8").write(src)
print("transformer_readme_v02192 : %d remplacements → %s" % (remplacements, DST))
