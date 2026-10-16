#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Transforme creer_readme_essentiel_v02196.py en creer_readme_essentiel_v02197.py
(édition v0.2.197 — PARRAINAGE EN COPIE : nouvelle adresse de configuration
« E-mail dédié — demandes de parrainage (copie) » (parrainageCopieEmail) qui
reçoit une COPIE des demandes de parrainage — le responsable principal du
parrainage — pendant que l'adresse dédiée (parrainageEmail) reste destinataire
PRINCIPAL pour la validation par réponse e-mail ; copie identique au principal =
IGNORÉE + JOURNALISÉE (« demande-creation-copie-ignoree »,
COPIE_IDENTIQUE_PRINCIPAL) ; vérification complète des copies congé /
autorisation de sortie (cadre rouge de la capture) : chaîne prouvée de bout en
bout — la configuration est bien enregistrée et les copies partent bien)."""
import io, os

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creer_readme_essentiel_v02196.py")
DST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creer_readme_essentiel_v02197.py")

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

# ---- 1) Docstring : titre + bloc v0.2.197 ------------------------------------
rep("README officiel AutoRH — ÉDITION ESSENTIELLE v0.2.196 (~15 pages).",
    "README officiel AutoRH — ÉDITION ESSENTIELLE v0.2.197 (~15 pages).\n\n"
    "Demande utilisateur (v0.2.197) : « Pour les demandes de congé et d'autorisation,\n"
    "la configuration des adresses e-mail en copie dans le cadre rouge ne fonctionne\n"
    "pas. Merci de vérifier et de corriger ce problème. Pour les demandes de\n"
    "parrainage, je souhaite également ajouter une adresse e-mail en copie de\n"
    "responsable principal du parrainage. » — NOUVEAU : adresse en COPIE des demandes\n"
    "de PARRAINAGE (parrainageCopieEmail — champ « E-mail dédié — demandes de\n"
    "parrainage (copie) » du panneau SMTP → routage) : le responsable principal du\n"
    "parrainage reçoit une COPIE de chaque demande pendant que l'adresse dédiée\n"
    "(parrainageEmail) reste destinataire PRINCIPAL pour la validation par réponse\n"
    "e-mail ; vide = AUCUNE copie (jamais de doublon) ; copie identique au principal =\n"
    "IGNORÉE + JOURNALISÉE (« demande-creation-copie-ignoree », code\n"
    "COPIE_IDENTIQUE_PRINCIPAL — visibilité immédiate du routage dans le journal).\n"
    "VÉRIFICATION (cadre rouge) : la chaîne des copies congé / autorisation de sortie\n"
    "est prouvée de bout en bout (panneau → API → base → portail → SMTP puits) :\n"
    "les copies partent bien aux adresses configurées (congeEmail / autorisationEmail,\n"
    "repli boîte RH si l'adresse dédiée est vide).")

# ---- 2) EDITION ---------------------------------------------------------------
rep('EDITION = "v0.2.196"', 'EDITION = "v0.2.197"')

# ---- 3) Bandeau de couverture --------------------------------------------------
rep('espacer("README OFFICIEL · ÉDITION ESSENTIELLE · V0.2.196")',
    'espacer("README OFFICIEL · ÉDITION ESSENTIELLE · V0.2.197")')

# ---- 4) Intro de couverture : phrase v0.2.197 ----------------------------------
rep('"au superadministrateur. Depuis la v0.2.196, les adresses dédiées des "\n'
    '        "attestations (panneau SMTP → routage) reçoivent une COPIE des demandes : la "\n'
    '        "boîte du service RH redevient destinataire principal."))',
    '"au superadministrateur. Depuis la v0.2.196, les adresses dédiées des "\n'
    '        "attestations (panneau SMTP → routage) reçoivent une COPIE des demandes : la "\n'
    '        "boîte du service RH redevient destinataire principal. Depuis la v0.2.197, "\n'
    '        "le responsable principal du parrainage reçoit aussi une COPIE de chaque "\n'
    '        "demande de parrainage (nouveau champ « demandes de parrainage (copie) »)."))')

# ---- 5) Blocs de couverture ----------------------------------------------------
rep('"Réalisé du 12 septembre au 12 octobre 2026 — <b>31 jours calendaires</b>, 196 versions "',
    '"Réalisé du 12 septembre au 12 octobre 2026 — <b>31 jours calendaires</b>, 197 versions "')

# ---- 6) DIFFUSION : nom du fichier ---------------------------------------------
rep("Fichier : download/servicerh-readme-technique-v0.2.196.pdf.",
    "Fichier : download/servicerh-readme-technique-v0.2.197.pdf.")

# ---- 7) SOURCES : tête du bloc --------------------------------------------------
rep('"Code source livré v0.2.196 (ATTESTATIONS EN COPIE — la boîte du service RH redevient "\n'
    '         "destinataire PRINCIPAL des demandes d\'attestation de travail et d\'attestation "\n'
    '         "de salaire ; les adresses DÉDIÉES du panneau SMTP → routage reçoivent une COPIE "\n'
    '         "systématique ; boîte RH absente → repli sur l\'adresse dédiée ; adresse dédiée "\n'
    '         "absente → AUCUNE copie ; garde IMAP : la boîte dédiée reste habilitée à répondre "\n'
    '         "(rôle « rh ») · DÉCISION MANAGER : CARTE MASQUÉE POUR LE RH — la carte "',
    '"Code source livré v0.2.197 (PARRAINAGE EN COPIE — le responsable principal du "\n'
    '         "parrainage reçoit une COPIE de chaque demande de parrainage "\n'
    '         "(parrainageCopieEmail) pendant que l\'adresse dédiée reste destinataire "\n'
    '         "PRINCIPAL ; vide = AUCUNE copie ; copie identique au principal = IGNORÉE + "\n'
    '         "JOURNALISÉE (COPIE_IDENTIQUE_PRINCIPAL) ; copies congé / autorisation "\n'
    '         "revérifiées de bout en bout · ATTESTATIONS EN COPIE — la boîte du service RH redevient "\n'
    '         "destinataire PRINCIPAL des demandes d\'attestation de travail et d\'attestation "\n'
    '         "de salaire ; les adresses DÉDIÉES du panneau SMTP → routage reçoivent une COPIE "\n'
    '         "systématique ; boîte RH absente → repli sur l\'adresse dédiée ; adresse dédiée "\n'
    '         "absente → AUCUNE copie ; garde IMAP : la boîte dédiée reste habilitée à répondre "\n'
    '         "(rôle « rh ») · DÉCISION MANAGER : CARTE MASQUÉE POUR LE RH — la carte "')

# ---- 8) Tableau 5.1 : ligne v0.2.197 -------------------------------------------
rep('"test dédié 36 contrôles + E2E routage 24 contrôles, 0 échec."],],',
    '"test dédié 36 contrôles + E2E routage 24 contrôles, 0 échec."],\n'
    '         ["v0.2.197", "PARRAINAGE EN COPIE — nouvelle adresse de configuration "\n'
    '                      "« E-mail dédié — demandes de parrainage (copie) » "\n'
    '                      "(parrainageCopieEmail, MailConfig) : le responsable principal du "\n'
    '                      "parrainage reçoit une COPIE de chaque demande de parrainage "\n'
    '                      "(l\'adresse dédiée parrainageEmail reste destinataire PRINCIPAL "\n'
    '                      "pour la validation par réponse e-mail) ; vide = AUCUNE copie "\n'
    '                      "(jamais de doublon du principal) ; copie identique au principal "\n'
    '                      "= IGNORÉE + JOURNALISÉE (« demande-creation-copie-ignoree », "\n'
    '                      "code COPIE_IDENTIQUE_PRINCIPAL) ; VÉRIFICATION du cadre rouge : "\n'
    '                      "copies congé / autorisation prouvées de bout en bout "\n'
    '                      "(panneau → API → base → portail → SMTP puits) — test dédié 22 "\n'
    '                      "contrôles + E2E routage 30 contrôles + non-régression 268 "\n'
    '                      "contrôles, 0 échec."],],')

# ---- 9) Puce dédiée v0.2.197 (après la puce 196) --------------------------------
rep('"suites v0.2.186→193 relancées : 232 contrôles, 0 échec."))',
    '"suites v0.2.186→193 relancées : 232 contrôles, 0 échec."))\n'
    '    STORY.append(bul(\n'
    '        "<b>Routage e-mail : parrainage EN COPIE (v0.2.197)</b> : DEMANDE "\n'
    '        "UTILISATEUR — « Pour les demandes de parrainage, je souhaite également "\n'
    '        "ajouter une adresse e-mail en copie de responsable principal du parrainage » "\n'
    '        "(et : « vérifier et corriger » la configuration des copies congé / "\n'
    '        "autorisation — cadre rouge). NOUVEAU : champ « E-mail dédié — demandes de "\n'
    '        "parrainage (copie) » du panneau SMTP → routage (parrainageCopieEmail) — le "\n'
    '        "responsable principal du parrainage reçoit une COPIE de chaque demande de "\n'
    '        "parrainage, l\'adresse dédiée (parrainageEmail) restant destinataire "\n'
    '        "PRINCIPAL pour la validation par réponse e-mail. Vide = AUCUNE copie "\n'
    '        "(jamais de doublon du principal) ; copie identique au principal = copie "\n'
    '        "IGNORÉE + JOURNALISÉE (« demande-creation-copie-ignoree », code "\n'
    '        "COPIE_IDENTIQUE_PRINCIPAL — visible dans le journal des envois de "\n'
    '        "l\'administration : la copie ne part pas parce que la boîte configurée "\n'
    '        "traite déjà la demande). VÉRIFICATION du cadre rouge : la chaîne des copies "\n'
    '        "congé / autorisation de sortie a été rejouée de bout en bout sur le code "\n'
    '        "v0.2.197 — enregistrement par le VRAI panneau SMTP (superadmin), "\n'
    '        "persistance après rechargement, soumission des demandes au VRAI portail, "\n'
    '        "RCPT TO captés par un SMTP puits : copie congé → congeEmail, copie "\n'
    '        "autorisation → autorisationEmail (repli boîte RH si vide), copie parrainage "\n'
    '        "→ parrainageCopieEmail. Preuves : test dédié "\n'
    '        "scripts/test_v02197_parrainage_copie.js — 22 contrôles sur le CODE RÉEL du "\n'
    '        "portail (lecture config, copie parrainage, AUCUNE copie si vide, copie "\n'
    '        "identique ignorée, non-régression congé/autorisation/attestation, chaîne "\n'
    '        "d\'interface complète) ; E2E test_v094_routage_emails.js étendu — 30 "\n'
    '        "contrôles avec SMTP puits (RCPT TO réels pour les 5 types + copie parrainage "\n'
    '        "+ copie ignorée journalisée) ; suites v0.2.186→196 relancées : 268 "\n'
    '        "contrôles, 0 échec — 320 contrôles au total."))')

# ---- 10) Marqueurs verifier du générateur ---------------------------------------
rep('"V0.2.196", "AutoRH", "ÉDITION ESSENTIELLE",',
    '"V0.2.197", "AutoRH", "ÉDITION ESSENTIELLE",')
rep('"196 versions", "Temps de développement et de test", "jours-homme", "Tableau 1.2",',
    '"197 versions", "Temps de développement et de test", "jours-homme", "Tableau 1.2",\n'
    '        "PARRAINAGE EN COPIE", "parrainageCopieEmail", "responsable principal du parrainage",\n'
    '        "COPIE_IDENTIQUE_PRINCIPAL", "demande-creation-copie-ignoree",')
rep('"ATTESTATIONS EN COPIE", "attestations de travail (copie)", "attestations de salaire (copie)",',
    '"ATTESTATIONS EN COPIE", "attestations de travail (copie)", "attestations de salaire (copie)",\n'
    '        "PARRAINAGE EN COPIE", "demandes de parrainage (copie)",')

# ---- 11) Annexe ------------------------------------------------------------------
rep("État du code livré v0.2.196. Trois rôles",
    "État du code livré v0.2.197. Trois rôles")

# ---- 12) Chemins de sortie des PDF ---------------------------------------------
rep('os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.196.pdf")',
    'os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.197.pdf")')
rep('os.path.join(RACINE, "download", "servicerh-readme-technique-reduit-v0.2.196.pdf")',
    'os.path.join(RACINE, "download", "servicerh-readme-technique-reduit-v0.2.197.pdf")')

io.open(DST, "w", encoding="utf-8").write(src)
print("transformer_readme_v02197 : %d remplacements → %s" % (remplacements, DST))
