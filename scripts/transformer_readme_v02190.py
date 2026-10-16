#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Transforme creer_readme_essentiel_v02189.py en creer_readme_essentiel_v02190.py
(édition v0.2.190 — correctif interrupteurs destinataires Employé/RH/Manager)."""
import io, os

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creer_readme_essentiel_v02189.py")
DST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creer_readme_essentiel_v02190.py")

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

# ---- 1) Docstring : titre + bloc v0.2.190 ------------------------------------
rep("README officiel AutoRH — ÉDITION ESSENTIELLE v0.2.189 (~14 pages).",
    "README officiel AutoRH — ÉDITION ESSENTIELLE v0.2.190 (~14 pages).\n\n"
    "Demande utilisateur (v0.2.190) : « lorsque je désactive l'interrupteur de manager, [le\n"
    "manager] reçoit toujours automatiquement la réponse PDF — vérifier les interrupteurs\n"
    "manager, RH et aussi employé ». — CORRECTIF DES INTERRUPTeurs DES DESTINATAIRES : la\n"
    "voie e-mail automatique (traiterMessageRecu → envoyerEmailDecisionConge) construisait\n"
    "ses copies (Cc) SANS lire le panneau Réponse PDF : ccDecision ajoutait TOUJOURS la boîte\n"
    "du service RH ET la boîte du manager (destinataire de la demande — congé / autorisation).\n"
    "Désormais, la configuration ReponsePdfConfig (id « reponse-pdf ») est lue avant chaque\n"
    "réponse de décision : « Auto-RH » désactivé → boîte RH plus en Cc ; « Manager / N+1 »\n"
    "désactivé → boîte du manager plus en Cc ; « Employé (destinataire) » désactivé → premier\n"
    "Cc activé promu « À » (sémantique du module document-acceptation.js) ; AUCUN destinataire\n"
    "activé → AUCUN envoi (journal code AUCUN_DESTINATAIRE) ; config absente → tous activés\n"
    "(historique v0.2.168 conservé) ; JAMAIS bloquant. Preuve : 41 contrôles dédiés +\n"
    "non-régression 278 contrôles (v0.2.184 à v0.2.189) — 319 contrôles, 0 échec.")

# ---- 2) EDITION ---------------------------------------------------------------
rep('EDITION = "v0.2.189"', 'EDITION = "v0.2.190"')

# ---- 3) Bandeau de couverture --------------------------------------------------
rep('espacer("README OFFICIEL · ÉDITION ESSENTIELLE · V0.2.189")',
    'espacer("README OFFICIEL · ÉDITION ESSENTIELLE · V0.2.190")')

# ---- 4) Intro de couverture : sentence v0.2.190 --------------------------------
rep('"sans aucun acteur ; les autres informations et la mise en page du document sont "\n'
    '        "conservées."))',
    '"sans aucun acteur ; les autres informations et la mise en page du document sont "\n'
    '        "conservées. Depuis la v0.2.190, les interrupteurs « Employé (destinataire) », "\n'
    '        "« Auto-RH » et « Manager / N+1 de la demande » du panneau Réponse PDF FILTRENT "\n'
    '        "la réponse automatique e-mail : destinataire désactivé = exclu de l\'envoi — le "\n'
    '        "manager désactivé ne reçoit plus la décision ni le PDF."))')

# ---- 5) Blocs de couverture ----------------------------------------------------
rep('"Réalisé du 12 septembre au 12 octobre 2026 — <b>31 jours calendaires</b>, 189 versions "',
    '"Réalisé du 12 septembre au 12 octobre 2026 — <b>31 jours calendaires</b>, 190 versions "')
rep("download/servicerh-readme-technique-v0.2.189.pdf.",
    "download/servicerh-readme-technique-v0.2.190.pdf.")
rep('"Code source livré v0.2.189 (PDF de réponse automatique SIMPLIFIÉ — « Décision rendue "',
    '"Code source livré v0.2.190 (INTERRUPTeurs DES DESTINATAIRES respectés — « Employé "\n'
    '         "(destinataire) », « Auto-RH » et « Manager / N+1 » du panneau Réponse PDF filtrent "\n'
    '         "la réponse automatique e-mail : désactivé = exclu de l\'envoi · PDF de réponse "\n'
    '         "automatique SIMPLIFIÉ — « Décision rendue "')
rep('"12 octobre 2026 — fondée sur le code v0.2.189 ; maintenue à jour au fil des livraisons."',
    '"12 octobre 2026 — fondée sur le code v0.2.190 ; maintenue à jour au fil des livraisons."')

# ---- 6) Section 1 : nombre de versions -----------------------------------------
rep('"calendaires</b>, en cycles courts : <b>189 versions numérotées</b> (v0.2.1 à v0.2.189), "',
    '"calendaires</b>, en cycles courts : <b>190 versions numérotées</b> (v0.2.1 à v0.2.190), "')
rep('"Fonctionnalités vérifiables dans le code livré v0.2.189. Installation : "',
    '"Fonctionnalités vérifiables dans le code livré v0.2.190. Installation : "')

# ---- 7) Section 2 : paragraphe deux étapes -------------------------------------
rep('"« Décision finale : Acceptée — … », sans aucun acteur (mise en page inchangée)."))',
    '"« Décision finale : Acceptée — … », sans aucun acteur (mise en page inchangée). Depuis "\n'
    '        "la <b>v0.2.190</b>, les interrupteurs destinataires (Employé / Auto-RH / Manager "\n'
    '        "N+1 — panneau Réponse PDF) FILTRENT la réponse automatique : destinataire désactivé "\n'
    '        "= exclu de l\'envoi ; employé désactivé → premier Cc activé promu « À »."))')

# ---- 8) Section 5 : ligne de tableau v0.2.190 ----------------------------------
rep('"appliqué à tous les PDF de réponse automatique (acceptation ET refus)."],],',
    '"appliqué à tous les PDF de réponse automatique (acceptation ET refus)."],\n'
    '         ["v0.2.190", "INTERRUPTeurs DES DESTINATAIRES RESPECTÉS : « Employé (destinataire) », "\n'
    '                      "« Auto-RH » et « Manager / N+1 de la demande » (panneau Réponse PDF) "\n'
    '                      "FILTRENT la réponse automatique e-mail — destinataire désactivé = exclu "\n'
    '                      "de l\'envoi (le manager désactivé ne reçoit plus la décision/PDF) ; "\n'
    '                      "aucun destinataire = aucun envoi ; config absente = tous activés."],],')

# ---- 9) Section 5 : puce détaillée v0.2.190 ------------------------------------
rep('"manager ni du décideur). Preuve v0.2.189 : 39 contrôles dédiés (sources) + 28 contrôles "\n'
    '        "de contenu extrait du PDF réellement généré + non-régression 486 contrôles (v0.2.180 à "\n'
    '        "v0.2.188) — 553 contrôles, 0 échec ; node --check OK."))',
    '"manager ni du décideur). Preuve v0.2.189 : 39 contrôles dédiés (sources) + 28 contrôles "\n'
    '        "de contenu extrait du PDF réellement généré + non-régression 486 contrôles (v0.2.180 à "\n'
    '        "v0.2.188) — 553 contrôles, 0 échec ; node --check OK."))\n'
    '    STORY.append(bul(\n'
    '        "<b>Interrupteurs des destinataires respectés (v0.2.190)</b> : DEMANDE UTILISATEUR — "\n'
    '        "« lorsque je désactive l\'interrupteur de manager, [le manager] reçoit toujours "\n'
    '        "automatiquement la réponse PDF ; vérifier les interrupteurs manager, RH et aussi "\n'
    '        "employé ». CAUSE (v0.2.189) : la voie e-mail automatique (traiterMessageRecu → "\n'
    '        "envoyerEmailDecisionConge) construisait ses copies (Cc) en ignorant le panneau "\n'
    '        "Réponse PDF : ccDecision ajoutait TOUJOURS la boîte du service RH ET la boîte du "\n'
    '        "manager (destinataire de la demande — congé / autorisation de sortie) ; désactiver "\n'
    '        "« Manager / N+1 de la demande », « Auto-RH » ou « Employé (destinataire) » "\n'
    '        "n\'avait AUCUN effet sur la réponse automatique (le module document-acceptation.js "\n'
    '        "respecte bien ces interrupteurs, mais la voie automatique lui passe sansEmail = "\n'
    '        "true — son e-mail propre n\'est jamais envoyé). CORRECTIF (v0.2.190) : le portail "\n'
    '        "lit DÉSORMAIS la configuration ReponsePdfConfig (id « reponse-pdf ») avant chaque "\n'
    '        "réponse de décision — « Auto-RH » désactivé → la boîte RH n\'est plus en Cc ; "\n'
    '        "« Manager / N+1 » désactivé → la boîte du manager n\'est plus en Cc (lorsque la "\n'
    '        "demande est adressée DIRECTEMENT au service RH, l\'interrupteur RH régit seul cette "\n'
    '        "adresse) ; « Employé (destinataire) » désactivé → l\'employé n\'est plus le "\n'
    '        "destinataire « À » : le PREMIER Cc activé est promu (sémantique IDENTIQUE au module "\n'
    '        "document-acceptation.js) ; AUCUN destinataire activé → AUCUN envoi (incident "\n'
    '        "journalisé — code AUCUN_DESTINATAIRE) ; configuration absente ou illisible → TOUS "\n'
    '        "ACTIVÉS (comportement historique v0.2.168 conservé) ; JAMAIS bloquant. Les PDF "\n'
    '        "restent inchangés (acceptation : PDF signé joint ; refus : notification sans PDF — "\n'
    '        "v0.2.188) ainsi que la transmission intermédiaire aux RH et la notification "\n'
    '        "« document disponible ». Preuve v0.2.190 : 41 contrôles dédiés (lecture de "\n'
    '        "configuration, filtrage Cc, option envoyerEmployeDecision, gardes et journal, persistance "\n'
    '        "panneau→base, simulations exécutées du bloc réel — manager désactivé, RH désactivé, "\n'
    '        "employé désactivé, tous activés, demande adressée au RH) + non-régression 278 "\n'
    '        "contrôles (v0.2.184 à v0.2.189) — 319 contrôles, 0 échec ; node --check OK."))')

# ---- 10) Annexe : état du code --------------------------------------------------
rep('"État du code livré v0.2.189. Trois rôles d\'administration (SuperAdmin, RH, IT) sur le port "',
    '"État du code livré v0.2.190. Trois rôles d\'administration (SuperAdmin, RH, IT) sur le port "')

# ---- 11) main() : noms de fichiers ---------------------------------------------
rep('pdf_dl = os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.189.pdf")',
    'pdf_dl = os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.190.pdf")')
rep('os.path.join(RACINE, "download", "servicerh-readme-technique-reduit-v0.2.189.pdf")',
    'os.path.join(RACINE, "download", "servicerh-readme-technique-reduit-v0.2.190.pdf")')
rep('title="AutoRH — README officiel — édition essentielle v0.2.189"',
    'title="AutoRH — README officiel — édition essentielle v0.2.190"')

# ---- 12) verifier() : marqueurs --------------------------------------------------
rep('"V0.2.189", "AutoRH", "ÉDITION ESSENTIELLE",',
    '"V0.2.190", "AutoRH", "ÉDITION ESSENTIELLE",')
rep('"189 versions", "Temps de développement et de test", "jours-homme", "Tableau 1.2",',
    '"190 versions", "Temps de développement et de test", "jours-homme", "Tableau 1.2",\n'
    '        "Interrupteurs des destinataires respectés", "AUCUN_DESTINATAIRE",\n'
    '        "41 contrôles dédiés", "319 contrôles", "envoyerEmployeDecision",\n'
    '        "le manager désactivé ne reçoit plus la décision ni le PDF",')
rep('"v0.2.189",\n        "DEUX ÉTAPES",',
    '"v0.2.189", "v0.2.190",\n        "DEUX ÉTAPES",')

io.open(DST, "w", encoding="utf-8").write(src)
print("OK : %s écrit (%d transformations) — %d octets" % (DST, remplacements, os.path.getsize(DST)))
