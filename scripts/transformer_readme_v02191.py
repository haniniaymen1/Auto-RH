#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Transforme creer_readme_essentiel_v02190.py en creer_readme_essentiel_v02191.py
(édition v0.2.191 — les interrupteurs e-mail fonctionnent DANS LES DEUX SENS)."""
import io, os

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creer_readme_essentiel_v02190.py")
DST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creer_readme_essentiel_v02191.py")

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

# ---- 1) Docstring : titre + bloc v0.2.191 ------------------------------------
rep("README officiel AutoRH — ÉDITION ESSENTIELLE v0.2.190 (~14 pages).",
    "README officiel AutoRH — ÉDITION ESSENTIELLE v0.2.191 (~14 pages).\n\n"
    "Demande utilisateur (v0.2.191) : « les interrupteurs de la section « Envoi par e-mail\n"
    "(réponse PDF en pièce jointe) » ne fonctionnent ni lorsqu'ils sont activés ni lorsqu'ils\n"
    "sont désactivés ». — DEUX CAUSES RACINES CORRIGÉES : (1) le module document-acceptation.js\n"
    "(chargerConfig — partagé par TOUTES les décisions de l'administration : acceptation / refus\n"
    "signés, réponse avec document importé) IGNORAIT le panneau tant que la section n'était pas\n"
    "« engagée » (interrupteur de génération OFF — LE DÉFAUT — et aucun certificat dédié\n"
    "importé) : repli sur la configuration historique TOUS ON → les 4 interrupteurs e-mail\n"
    "restaient SANS AUCUN EFFET ; (2) la voie e-mail du portail ne consultait pas l'interrupteur\n"
    "MAÎTRE « Envoi automatique de l'e-mail » (emailActif) et son échec de lecture de\n"
    "configuration était SILENCIEUX (client Prisma ancien → repli défauts ON sans aucune trace).\n"
    "CORRECTIF : les 4 interrupteurs e-mail (maître + Employé / RH / Manager) s'appliquent DÈS\n"
    "QUE LA LIGNE ReponsePdfConfig EXISTE, sur TOUTES les voies (portail + administration) ;\n"
    "maître OFF → AUCUN envoi (journal ENVOI_DESACTIVE) ; diagnostics explicites (garde client\n"
    "Prisma ancien + trace des interrupteurs lus à chaque décision). Preuve : 40 contrôles\n"
    "dédiés + 520 contrôles de non-régression (10 suites chiffrées) + 4 suites complémentaires\n"
    "— 0 échec.")

# ---- 2) EDITION ---------------------------------------------------------------
rep('EDITION = "v0.2.190"', 'EDITION = "v0.2.191"')

# ---- 3) Bandeau de couverture --------------------------------------------------
rep('espacer("README OFFICIEL · ÉDITION ESSENTIELLE · V0.2.190")',
    'espacer("README OFFICIEL · ÉDITION ESSENTIELLE · V0.2.191")')

# ---- 4) Intro de couverture : sentence v0.2.191 --------------------------------
rep('"la réponse automatique e-mail : destinataire désactivé = exclu de l\'envoi — le "\n'
    '        "manager désactivé ne reçoit plus la décision ni le PDF."))',
    '"la réponse automatique e-mail : destinataire désactivé = exclu de l\'envoi — le "\n'
    '        "manager désactivé ne reçoit plus la décision ni le PDF. Depuis la v0.2.191, ces "\n'
    '        "interrupteurs sont respectés DANS LES DEUX SENS et sur TOUTES les voies (portail "\n'
    '        "ET administration) — y compris l\'interrupteur maître « Envoi automatique de "\n'
    '        "l\'e-mail »."))')

# ---- 5) Blocs de couverture ----------------------------------------------------
rep('"Réalisé du 12 septembre au 12 octobre 2026 — <b>31 jours calendaires</b>, 190 versions "',
    '"Réalisé du 12 septembre au 12 octobre 2026 — <b>31 jours calendaires</b>, 191 versions "')
rep("download/servicerh-readme-technique-v0.2.190.pdf.",
    "download/servicerh-readme-technique-v0.2.191.pdf.")
rep('"Code source livré v0.2.190 (INTERRUPTeurs DES DESTINATAIRES respectés — « Employé "',
    '"Code source livré v0.2.191 (INTERRUPTHEURS E-MAIL EFFECTIFS DANS LES DEUX SENS — "\n'
    '         "panneau appliqué sur TOUTES les voies : maître OFF = aucun envoi, destinataire "\n'
    '         "désactivé = exclu — « Employé "')
rep('"12 octobre 2026 — fondée sur le code v0.2.190 ; maintenue à jour au fil des livraisons."',
    '"12 octobre 2026 — fondée sur le code v0.2.191 ; maintenue à jour au fil des livraisons."')

# ---- 6) Section 1 : nombre de versions -----------------------------------------
rep('"calendaires</b>, en cycles courts : <b>190 versions numérotées</b> (v0.2.1 à v0.2.190), "',
    '"calendaires</b>, en cycles courts : <b>191 versions numérotées</b> (v0.2.1 à v0.2.191), "')
rep('"Fonctionnalités vérifiables dans le code livré v0.2.190. Installation : "',
    '"Fonctionnalités vérifiables dans le code livré v0.2.191. Installation : "')

# ---- 7) Section 2 : paragraphe deux étapes -------------------------------------
rep('"= exclu de l\'envoi ; employé désactivé → premier Cc activé promu « À »."))',
    '"= exclu de l\'envoi ; employé désactivé → premier Cc activé promu « À ». La v0.2.191 "\n'
    '        "rend ces interrupteurs EFFECTIFS DANS LES DEUX SENS : le module de génération les "\n'
    '        "respecte dès que le panneau a été utilisé (section « non engagée » comprise) et le "\n'
    '        "maître OFF supprime TOUT envoi de décision."))')

# ---- 8) Section 5 : ligne de tableau v0.2.191 ----------------------------------
rep('"aucun destinataire = aucun envoi ; config absente = tous activés."],],',
    '"aucun destinataire = aucun envoi ; config absente = tous activés."],\n'
    '         ["v0.2.191", "INTERRUPTHEURS E-MAIL EFFECTIFS DANS LES DEUX SENS : le module "\n'
    '                      "d\'acceptation/refus (administration) applique les 4 interrupteurs "\n'
    '                      "e-mail du panneau DÈS QUE la ligne existe — MÊME section « non "\n'
    '                      "engagée » (cause n°1 : repli historique TOUS ON) ; la voie e-mail "\n'
    '                      "consulte le MAÎTRE « Envoi automatique » (OFF = AUCUN envoi — "\n'
    '                      "ENVOI_DESACTIVE) et diagnostique TOUT échec de lecture (cause n°2 : "\n'
    '                      "lecture silencieuse, client Prisma ancien)."],],')

# ---- 9) Section 5 : puce détaillée v0.2.191 ------------------------------------
rep('"panneau→base, simulations exécutées du bloc réel — manager désactivé, RH désactivé, "\n'
    '        "employé désactivé, tous activés, demande adressée au RH) + non-régression 278 "\n'
    '        "contrôles (v0.2.184 à v0.2.189) — 319 contrôles, 0 échec ; node --check OK."))',
    '"panneau→base, simulations exécutées du bloc réel — manager désactivé, RH désactivé, "\n'
    '        "employé désactivé, tous activés, demande adressée au RH) + non-régression 278 "\n'
    '        "contrôles (v0.2.184 à v0.2.189) — 319 contrôles, 0 échec ; node --check OK."))\n'
    '    STORY.append(bul(\n'
    '        "<b>Interrupteurs e-mail effectifs dans les deux sens (v0.2.191)</b> : DEMANDE "\n'
    '        "UTILISATEUR — « les interrupteurs de la section « Envoi par e-mail (réponse PDF "\n'
    '        "en pièce jointe) » ne fonctionnent ni lorsqu\\\'ils sont activés ni lorsqu\\\'ils "\n'
    '        "sont désactivés ». DEUX CAUSES RACINES. (1) Le module document-acceptation.js "\n'
    '        "(chargerConfig — partagé par TOUTES les décisions de l\'administration : "\n'
    '        "acceptation / refus signés, réponse avec document importé) ignorait le panneau "\n'
    '        "tant que la section n\'était pas « ENGAGÉE » (interrupteur de génération OFF — "\n'
    '        "LE DÉFAUT — et aucun certificat dédié importé) : repli sur la configuration "\n'
    '        "historique (TOUS ON, sans interrupteur Employé) → les 4 interrupteurs e-mail "\n'
    '        "restaient SANS AUCUN EFFET sur les e-mails de décision émis par l\'administration. "\n'
    '        "CORRECTIF : chargerConfig applique DÉSORMAIS les 4 interrupteurs e-mail (maître "\n'
    '        "+ Employé / RH / Manager) DÈS QUE LA LIGNE ReponsePdfConfig EXISTE — la règle de "\n'
    '        "continuité v0.2.148 reste limitée aux VISUELS du document (paraphe, tampon, QR, "\n'
    '        "certificat) ; une installation qui n\'a jamais ouvert le panneau conserve les "\n'
    '        "défauts historiques (tous activés — identiques) : AUCUN changement tant qu\'aucun "\n'
    '        "interrupteur n\'est touché. (2) La voie e-mail du portail ne consultait pas "\n'
    '        "l\'interrupteur MAÎTRE « Envoi automatique de l\'e-mail » (emailActif) et son "\n'
    '        "échec de lecture était SILENCIEUX (ex. client Prisma ancien sans le modèle → "\n'
    '        "repli défauts ON sans trace) — CORRECTIF : maître OFF → AUCUNE réponse de "\n'
    '        "décision (journal ENVOI_DESACTIVE, trace console) ; garde explicite « modèle "\n'
    '        "ReponsePdfConfig absent du client Prisma » (remédiation : npx prisma generate "\n'
    '        "puis redémarrer le portail) ; trace des interrupteurs LUS à chaque décision. "\n'
    '        "(3) Description du maître clarifiée dans le panneau. Preuve v0.2.191 : 40 "\n'
    '        "contrôles dédiés (chargerConfig RÉEL sur la vraie base — section non engagée, "\n'
    '        "engagée, ligne absente ; traiterAcceptationFinale RÉEL — manager/RH/employé/ "\n'
    '        "maître désactivés, promotion du premier Cc ; code portail RÉEL — maître OFF, "\n'
    '        "drapeaux, client Prisma ancien, fonction envoyerEmailDecisionConge) + "\n'
    '        "non-régression 520 contrôles chiffrés (10 suites : v0.2.190 41, Task 185 35, "\n'
    '        "v0.2.184 61, v0.2.185 58, v0.2.179 23, v0.2.180 21, v0.2.182 63, v0.2.187 30, "\n'
    '        "tampon 44, expressions 144) + 4 suites complémentaires (v0.2.188, v0.2.189, "\n'
    '        "document-refus, génération 189) — 0 échec ; node --check OK ; build OK."))')

# ---- 10) Annexe : état du code --------------------------------------------------
rep('"État du code livré v0.2.190. Trois rôles d\'administration (SuperAdmin, RH, IT) sur le port "',
    '"État du code livré v0.2.191. Trois rôles d\'administration (SuperAdmin, RH, IT) sur le port "')

# ---- 11) main() : noms de fichiers ---------------------------------------------
rep('pdf_dl = os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.190.pdf")',
    'pdf_dl = os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.191.pdf")')
rep('os.path.join(RACINE, "download", "servicerh-readme-technique-reduit-v0.2.190.pdf")',
    'os.path.join(RACINE, "download", "servicerh-readme-technique-reduit-v0.2.191.pdf")')
rep('title="AutoRH — README officiel — édition essentielle v0.2.190"',
    'title="AutoRH — README officiel — édition essentielle v0.2.191"')

# ---- 12) verifier() : marqueurs --------------------------------------------------
rep('"V0.2.190", "AutoRH", "ÉDITION ESSENTIELLE",',
    '"V0.2.191", "AutoRH", "ÉDITION ESSENTIELLE",')
rep('"190 versions", "Temps de développement et de test", "jours-homme", "Tableau 1.2",',
    '"191 versions", "Temps de développement et de test", "jours-homme", "Tableau 1.2",\n'
    '        "Interrupteurs e-mail effectifs dans les deux sens", "ENVOI_DESACTIVE",\n'
    '        "40 contrôles dédiés", "520 contrôles", "section non engagée",\n'
    '        "modèle ReponsePdfConfig absent du client Prisma",')
rep('"v0.2.190",\n        "DEUX ÉTAPES",',
    '"v0.2.190", "v0.2.191",\n        "DEUX ÉTAPES",')

# ---- 13) verifier() : marqueur insécable ----------------------------------------
# La formulation v0.2.184 peut désormais tomber EXACTEMENT à la frontière d'une
# page (l'en-tête courant s'intercale entre les deux moitiés dans l'extraction
# pypdf) — le marqueur est vérifié par sa PREMIÈRE moitié, insécable
# (« Elle poursuit son circuit de validation habituel » reste vérifié à part).
rep('"notificationEtapeIntermediaire", "Document(s) transmis avec la réponse à votre demande",',
    '"notificationEtapeIntermediaire", "Document(s) transmis avec la",')

io.open(DST, "w", encoding="utf-8").write(src)
print("OK : %s écrit (%d transformations) — %d octets" % (DST, remplacements, os.path.getsize(DST)))
