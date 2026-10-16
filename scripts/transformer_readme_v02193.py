#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Transforme creer_readme_essentiel_v02192.py en creer_readme_essentiel_v02193.py
(édition v0.2.193 — notifications d'acceptation / de refus TOUJOURS envoyées ;
les interrupteurs « Réponse PDF » ne gouvernent plus que la pièce jointe PDF)."""
import io, os

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creer_readme_essentiel_v02192.py")
DST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creer_readme_essentiel_v02193.py")

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

# ---- 1) Docstring : titre + bloc v0.2.193 ------------------------------------
rep("README officiel AutoRH — ÉDITION ESSENTIELLE v0.2.192 (~15 pages).",
    "README officiel AutoRH — ÉDITION ESSENTIELLE v0.2.193 (~15 pages).\n\n"
    "Demande utilisateur (v0.2.193) : « Même si les interrupteurs sont activés ou désactivés,\n"
    "les e-mails de notification d'acceptation ou de refus doivent toujours être envoyés. Les\n"
    "interrupteurs doivent uniquement contrôler l'envoi de la réponse automatique par PDF, sans\n"
    "modifier le fonctionnement des notifications par e-mail ». — NOUVELLE SÉMANTIQUE sur les\n"
    "TROIS voies (portail congé/autorisation, administration acceptation signée, administration\n"
    "refus signé) : la notification de décision part TOUJOURS à TOUS les destinataires\n"
    "historiques (employé « À », service RH et manager en copies) — AUCUN interrupteur ne peut\n"
    "plus en exclure quelqu'un. Les 4 interrupteurs du panneau « Envoi par e-mail (réponse PDF\n"
    "en pièce jointe) » ne gouvernent PLUS QUE LA RÉPONSE PDF : le document signé et tamponné\n"
    "n'est joint qu'aux destinataires dont l'interrupteur est activé (maître ON) ; les autres\n"
    "reçoivent LA MÊME notification SANS le PDF (au plus deux messages). L'interrupteur maître\n"
    "« Envoi automatique de l'e-mail » ne supprime PLUS aucun envoi (code ENVOI_DESACTIVE\n"
    "retiré) — OFF = personne ne reçoit le PDF, tout le monde reçoit la notification. Refus\n"
    "congé/autorisation (pas de PDF — v0.2.188) : les drapeaux sont SANS EFFET, tout le monde\n"
    "est notifié. Preuve : test v0.2.193 dédié 53/53 (traiterAcceptationFinale et traiterRefus\n"
    "RÉELS sur la vraie base ReponsePdfConfig, fonction portail réelle, code extrait) + suites\n"
    "v0.2.179→191 adaptées et relancées — 0 échec ; build production OK ; panneau vérifié dans\n"
    "le navigateur (descriptions mises à jour).")

# ---- 2) EDITION ---------------------------------------------------------------
rep('EDITION = "v0.2.192"', 'EDITION = "v0.2.193"')

# ---- 3) Bandeau de couverture --------------------------------------------------
rep('espacer("README OFFICIEL · ÉDITION ESSENTIELLE · V0.2.192")',
    'espacer("README OFFICIEL · ÉDITION ESSENTIELLE · V0.2.193")')

# ---- 4) Intro de couverture : phrase v0.2.193 ----------------------------------
rep('"TOUJOURS accessibles : la colonne Actions est COLLANTE à droite du tableau, "\n'
    '        "sans aucun défilement de colonnes."))',
    '"TOUJOURS accessibles : la colonne Actions est COLLANTE à droite du tableau, "\n'
    '        "sans aucun défilement de colonnes. Depuis la v0.2.193, les e-mails de "\n'
    '        "notification d\'acceptation et de refus sont TOUJOURS envoyés à l\'employé, au "\n'
    '        "service RH et au manager — les interrupteurs « Réponse PDF » ne gouvernent plus "\n'
    '        "que la pièce jointe PDF."))')

# ---- 5) Blocs de couverture ----------------------------------------------------
rep('"Réalisé du 12 septembre au 12 octobre 2026 — <b>31 jours calendaires</b>, 192 versions "',
    '"Réalisé du 12 septembre au 12 octobre 2026 — <b>31 jours calendaires</b>, 193 versions "')

# ---- 6) DIFFUSION : nom du fichier ---------------------------------------------
rep("Fichier : download/servicerh-readme-technique-v0.2.192.pdf.",
    "Fichier : download/servicerh-readme-technique-v0.2.193.pdf.")

# ---- 7) SOURCES : tête du bloc --------------------------------------------------
rep('"Code source livré v0.2.192 (BOUTONS DE GESTION TOUJOURS ACCESSIBLES — colonne "',
    '"Code source livré v0.2.193 (NOTIFICATIONS TOUJOURS ENVOYÉES — les e-mails de "\n'
    '         "décision partent à TOUS les destinataires historiques, quel que soit l\'état des "\n'
    '         "interrupteurs ; le PDF signé et tamponné n\'est joint qu\'aux destinataires "\n'
    '         "activés, les autres reçoivent la même notification SANS le PDF ; maître OFF = "\n'
    '         "plus AUCUNE suppression d\'envoi (ENVOI_DESACTIVE retiré) · BOUTONS DE GESTION "\n'
    '         "TOUJOURS ACCESSIBLES — colonne "')
rep('"INTERRUPTHEURS E-MAIL EFFECTIFS DANS LES DEUX SENS — "\n'
    '         "panneau appliqué sur TOUTES les voies : maître OFF = aucun envoi, destinataire "\n'
    '         "désactivé = exclu — « Employé "\n'
    '         "(destinataire) », « Auto-RH » et « Manager / N+1 » du panneau Réponse PDF filtrent "\n'
    '         "la réponse automatique e-mail : désactivé = exclu de l\'envoi · PDF de réponse "',
    '"INTERRUPTHEURS E-MAIL — SÉMANTIQUE v0.2.193 : notification TOUJOURS "\n'
    '         "envoyée, PDF seul gouverné (historique v0.2.190/191 : les interrupteurs "\n'
    '         "« Employé (destinataire) », « Auto-RH » et « Manager / N+1 » filtraient les "\n'
    '         "destinataires de la réponse automatique — REMPLACÉ par la répartition "\n'
    '         "avec/sans PDF) · PDF de réponse "')

# ---- 8) Tableau 5.1 : ligne v0.2.193 -------------------------------------------
rep('"redimensionnement conservées (option data-col-sticky du hook)."],],',
    '"redimensionnement conservées (option data-col-sticky du hook)."],\n'
    '         ["v0.2.193", "NOTIFICATIONS TOUJOURS ENVOYÉES : les e-mails de notification "\n'
    '                      "d\'acceptation / de refus partent TOUJOURS à l\'employé « À », au "\n'
    '                      "service RH et au manager (copies historiques rétablies) — AUCUN "\n'
    '                      "interrupteur ne les coupe plus (ENVOI_DESACTIVE retiré) ; les 4 "\n'
    '                      "interrupteurs du panneau « Réponse PDF » ne gouvernent PLUS QUE LA "\n'
    '                      "PIÈCE JOINTE : PDF signé aux destinataires activés, la même "\n'
    '                      "notification SANS PDF aux autres (au plus deux messages) ; refus "\n'
    '                      "congé/autorisation (pas de PDF) : drapeaux sans effet — tout le "\n'
    '                      "monde est notifié."],],')

# ---- 9) Puce dédiée v0.2.193 (après la puce 192) --------------------------------
rep('        "conservée ; build production OK."))',
    '        "conservée ; build production OK."))\n'
    '    STORY.append(bul(\n'
    '        "<b>Notifications toujours envoyées — interrupteurs = réponse PDF seulement "\n'
    '        "(v0.2.193)</b> : DEMANDE UTILISATEUR — « Même si les interrupteurs sont activés "\n'
    '        "ou désactivés, les e-mails de notification d\'acceptation ou de refus doivent "\n'
    '        "toujours être envoyés. Les interrupteurs doivent uniquement contrôler l\'envoi de "\n'
    '        "la réponse automatique par PDF, sans modifier le fonctionnement des notifications "\n'
    '        "par e-mail ». NOUVELLE SÉMANTIQUE appliquée aux TROIS voies de décision : "\n'
    '        "(1) PORTAIL (congé / autorisation de sortie par e-mail) — les copies "\n'
    '        "historiques (service RH + boîte du manager) sont RÉTABLIES sans aucun filtrage "\n'
    '        "par interrupteur, l\'employé reste « À » ; l\'interrupteur maître « Envoi "\n'
    '        "automatique de l\'e-mail » ne supprime PLUS l\'envoi (code ENVOI_DESACTIVE "\n'
    '        "retiré) ; (2) ADMINISTRATION — acceptation signée (document-acceptation.js) et "\n'
    '        "(3) refus signé (document-refus.js) — les destinataires sont TOUJOURS complets "\n'
    '        "(employé « À », RH + manager en Cc, adresses plus jamais retirées par les "\n'
    '        "interrupteurs). LES 4 INTERRUPTEURS ne gouvernent PLUS QUE LA RÉPONSE PDF : "\n'
    '        "le document signé et tamponné est joint au SEUL groupe activé (maître ON ET "\n'
    '        "interrupteur du destinataire ON) ; chaque destinataire exclu reçoit LA MÊME "\n'
    '        "notification SANS le PDF — au plus DEUX messages (avec PDF, puis sans PDF), "\n'
    '        "même objet, même corps, mêmes pièces des décideurs, journal par message avec "\n'
    '        "l\'indicateur « reponsePdf ». AUCUN PDF disponible (refus congé/autorisation — "\n'
    '        "v0.2.188, génération absente, maître OFF) → les drapeaux sont SANS EFFET : tout "\n'
    '        "le monde reçoit la notification. Cas extrêmes : employé sans adresse e-mail → "\n'
    '        "la notification part aux copies (RH promu « À », plus JAMAIS bloquant) ; "\n'
    '        "AUCUNE adresse connue → AUCUN_DESTINATAIRE (seul cas restant). Le panneau "\n'
    '        "affiche la nouvelle sémantique (maître = « RÉPONSE PDF », note « ne retirent "\n'
    '        "PLUS personne »). JAMAIS bloquant ; défauts historiques conservés (config "\n'
    '        "absente = tous activés). Preuve : test v0.2.193 dédié 53/53 OK (traiterAcceptation"\n'
    '        "Finale et traiterRefus RÉELS sur la vraie base ReponsePdfConfig : tous ON → 1 "\n'
    '        "message avec PDF ; manager OFF → 2 messages dont le manager SANS PDF ; maître "\n'
    '        "OFF → 1 message SANS PDF à tout le monde ; fonction portail réelle + code "\n'
    '        "extrait) ; suites v0.2.179→191 relancées (adaptées à la nouvelle sémantique) — "\n'
    '        "0 échec ; node --check OK ; build production OK ; panneau vérifié dans le "\n'
    '        "navigateur."))')

# ---- 10) Marqueurs verifier du générateur ---------------------------------------
rep('"V0.2.192", "AutoRH", "ÉDITION ESSENTIELLE",',
    '"V0.2.193", "AutoRH", "ÉDITION ESSENTIELLE",')
rep('"192 versions", "Temps de développement et de test", "jours-homme", "Tableau 1.2",',
    '"193 versions", "Temps de développement et de test", "jours-homme", "Tableau 1.2",\n'
    '        "Notifications toujours envoyées — interrupteurs = réponse PDF seulement",\n'
    '        "interrupteurs = réponse PDF seulement", "ENVOI_DESACTIVE retiré",\n'
    '        "ne retirent PLUS personne", "SANS le PDF", "au plus DEUX messages",')
rep('"Interrupteurs e-mail effectifs dans les deux sens", "ENVOI_DESACTIVE",\n'
    '        "Boutons de gestion toujours accessibles",',
    '"Interrupteurs e-mail effectifs dans les deux sens", "ENVOI_DESACTIVE",\n'
    '        "Boutons de gestion toujours accessibles",\n'
    '        "notification TOUJOURS envoyée", "LA MÊME notification SANS le PDF",')

# ---- 11) Annexe ------------------------------------------------------------------
rep("État du code livré v0.2.192. Trois rôles",
    "État du code livré v0.2.193. Trois rôles")

# ---- 12) Chemins de sortie des PDF ---------------------------------------------
rep('os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.192.pdf")',
    'os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.193.pdf")')
rep('os.path.join(RACINE, "download", "servicerh-readme-technique-reduit-v0.2.192.pdf")',
    'os.path.join(RACINE, "download", "servicerh-readme-technique-reduit-v0.2.193.pdf")')

io.open(DST, "w", encoding="utf-8").write(src)
print("transformer_readme_v02193 : %d remplacements → %s" % (remplacements, DST))
