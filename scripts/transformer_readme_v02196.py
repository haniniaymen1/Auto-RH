#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Transforme creer_readme_essentiel_v02195.py en creer_readme_essentiel_v02196.py
(édition v0.2.196 — ADRESSES DÉDIÉES DES ATTESTATIONS « EN COPIE » : la boîte du
service RH redevient destinataire PRINCIPAL des demandes d'attestation de travail
et d'attestation de salaire ; les adresses dédiées du panneau SMTP → routage
(attestationTravailEmail / attestationSalaireEmail — Task 197) reçoivent désormais
une COPIE systématique, même sémantique « (copie) » que le congé et l'autorisation
de sortie ; garde IMAP : la boîte dédiée reste habilitée à répondre — rôle « rh »)."""
import io, os

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creer_readme_essentiel_v02195.py")
DST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creer_readme_essentiel_v02196.py")

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

# ---- 1) Docstring : titre + bloc v0.2.196 ------------------------------------
rep("README officiel AutoRH — ÉDITION ESSENTIELLE v0.2.195 (~15 pages).",
    "README officiel AutoRH — ÉDITION ESSENTIELLE v0.2.196 (~15 pages).\n\n"
    "Demande utilisateur (v0.2.196) : « Ajouter cette configuration en copie dans la\n"
    "configuration des e-mails dédiée au service RH. je parle dans le cadre vert »\n"
    "(capture : le cadre vert entourait les champs « E-mail dédié — attestations de\n"
    "travail » et « E-mail dédié — attestations de salaire » du panneau SMTP →\n"
    "routage). — NOUVEAU : la boîte du service RH REDEVIENT destinataire PRINCIPAL\n"
    "des demandes d'attestation de travail et d'attestation de salaire (comportement\n"
    "historique Task 116 restauré) et les ADRESSES DÉDIÉES du type (Task 197) reçoivent\n"
    "désormais une COPIE systématique — exactement la sémantique « (copie) » du congé\n"
    "et de l'autorisation de sortie : libellés « (copie) », descriptions mises à jour,\n"
    "boîte RH absente → repli sur l'adresse dédiée (la demande doit toujours aboutir),\n"
    "adresse dédiée absente → AUCUNE copie (jamais de doublon RH). La garde IMAP des\n"
    "réponses conserve la boîte dédiée comme expéditeur habilité (rôle « rh », 4e\n"
    "expéditeur légitime). Congé / autorisation / parrainage : STRICTEMENT inchangés.")

# ---- 2) EDITION ---------------------------------------------------------------
rep('EDITION = "v0.2.195"', 'EDITION = "v0.2.196"')

# ---- 3) Bandeau de couverture --------------------------------------------------
rep('espacer("README OFFICIEL · ÉDITION ESSENTIELLE · V0.2.195")',
    'espacer("README OFFICIEL · ÉDITION ESSENTIELLE · V0.2.196")')

# ---- 4) Intro de couverture : phrase v0.2.196 ----------------------------------
rep('"le rôle RH : le manager décide par e-mail et le repli manuel est réservé "\n'
    '        "au superadministrateur."))',
    '"le rôle RH : le manager décide par e-mail et le repli manuel est réservé "\n'
    '        "au superadministrateur. Depuis la v0.2.196, les adresses dédiées des "\n'
    '        "attestations (panneau SMTP → routage) reçoivent une COPIE des demandes : la "\n'
    '        "boîte du service RH redevient destinataire principal."))')

# ---- 5) Blocs de couverture ----------------------------------------------------
rep('"Réalisé du 12 septembre au 12 octobre 2026 — <b>31 jours calendaires</b>, 195 versions "',
    '"Réalisé du 12 septembre au 12 octobre 2026 — <b>31 jours calendaires</b>, 196 versions "')

# ---- 6) DIFFUSION : nom du fichier ---------------------------------------------
rep("Fichier : download/servicerh-readme-technique-v0.2.195.pdf.",
    "Fichier : download/servicerh-readme-technique-v0.2.196.pdf.")

# ---- 7) SOURCES : tête du bloc --------------------------------------------------
rep('"Code source livré v0.2.195 (DÉCISION MANAGER : CARTE MASQUÉE POUR LE RH — la carte "',
    '"Code source livré v0.2.196 (ATTESTATIONS EN COPIE — la boîte du service RH redevient "\n'
    '         "destinataire PRINCIPAL des demandes d\'attestation de travail et d\'attestation "\n'
    '         "de salaire ; les adresses DÉDIÉES du panneau SMTP → routage reçoivent une COPIE "\n'
    '         "systématique ; boîte RH absente → repli sur l\'adresse dédiée ; adresse dédiée "\n'
    '         "absente → AUCUNE copie ; garde IMAP : la boîte dédiée reste habilitée à répondre "\n'
    '         "(rôle « rh ») · DÉCISION MANAGER : CARTE MASQUÉE POUR LE RH — la carte "')

# ---- 8) Tableau 5.1 : ligne v0.2.196 -------------------------------------------
rep('"SUPERADMIN — aucun changement serveur."],],',
    '"SUPERADMIN — aucun changement serveur."],\n'
    '         ["v0.2.196", "ATTESTATIONS EN COPIE — la boîte du service RH redevient "\n'
    '                      "destinataire PRINCIPAL des demandes d\'attestation de travail et "\n'
    '                      "d\'attestation de salaire (comportement historique Task 116 "\n'
    '                      "restauré) ; les adresses dédiées du panneau SMTP → routage "\n'
    '                      "(attestationTravailEmail / attestationSalaireEmail — Task 197) "\n'
    '                      "reçoivent une COPIE systématique, libellés « (copie) » et "\n'
    '                      "descriptions mis à jour ; boîte RH absente → repli sur l\'adresse "\n'
    '                      "dédiée ; adresse dédiée absente → AUCUNE copie (jamais de doublon "\n'
    '                      "RH) ; garde IMAP : la boîte dédiée reste expéditeur habilité "\n'
    '                      "(rôle « rh ») ; congé / autorisation / parrainage inchangés — "\n'
    '                      "test dédié 36 contrôles + E2E routage 24 contrôles, 0 échec."],],')

# ---- 9) Puce dédiée v0.2.196 (après la puce 195) --------------------------------
rep('"suites v0.2.190→193 relancées : 232 contrôles, 0 échec."))',
    '"suites v0.2.190→193 relancées : 232 contrôles, 0 échec."))\n'
    '    STORY.append(bul(\n'
    '        "<b>Routage e-mail : attestations EN COPIE (v0.2.196)</b> : DEMANDE "\n'
    '        "UTILISATEUR — « Ajouter cette configuration en copie dans la configuration "\n'
    '        "des e-mails dédiée au service RH. je parle dans le cadre vert » (capture du "\n'
    '        "panneau SMTP → routage, cadre vert autour des deux champs d\'attestations). "\n'
    '        "Depuis la v0.2.94 (Task 197), l\'adresse dédiée du type d\'attestation recevait "\n'
    '        "la demande À LA PLACE de la boîte RH (« dédiée prioritaire », repli RH). "\n'
    '        "DÉSORMAIS : la boîte du service RH REDEVIENT destinataire PRINCIPAL "\n'
    '        "(comportement historique Task 116 restauré) et l\'adresse dédiée reçoit une "\n'
    '        "COPIE systématique — même sémantique que le congé et l\'autorisation de "\n'
    '        "sortie. Panneau SMTP → routage : libellés mis à jour — « attestations de "\n'
    '        "travail (copie) » et « attestations de salaire (copie) » — descriptions "\n'
    '        "précises (« Reçoit une COPIE… la boîte du service RH reste destinataire "\n'
    '        "principale. Vide : aucune copie supplémentaire ») ; la description de la "\n'
    '        "boîte RH précise qu\'elle reste destinataire principal. Repli : boîte RH "\n'
    '        "absente → la demande part à l\'adresse dédiée (elle doit toujours aboutir) ; "\n'
    '        "adresse dédiée absente → AUCUNE copie (jamais de doublon RH). Garde IMAP des "\n'
    '        "réponses : l\'adresse dédiée de SON type reste expéditeur habilité (rôle "\n'
    '        "« rh » — 4e expéditeur légitime, continuité de la sémantique Task 197 où "\n'
    '        "cette boîte était destinataire) ; la boîte dédiée de l\'AUTRE type et les "\n'
    '        "boîtes copies congé/autorisation restent NON habilitées. Preuve : test dédié "\n'
    '        "scripts/test_v02196_attestations_copie.js — 36 contrôles sur le CODE RÉEL du "\n'
    '        "portail (routage, envois capturés, journal, garde IMAP) ; E2E "\n'
    '        "test_v094_routage_emails.js actualisé — 24 contrôles avec SMTP puits (RCPT "\n'
    '        "TO réels : 2 principaux RH + 2 copies dédiées pour les attestations) ; "\n'
    '        "suites v0.2.186→193 relancées : 232 contrôles, 0 échec."))')

# ---- 10) Marqueurs verifier du générateur ---------------------------------------
rep('"V0.2.195", "AutoRH", "ÉDITION ESSENTIELLE",',
    '"V0.2.196", "AutoRH", "ÉDITION ESSENTIELLE",')
rep('"195 versions", "Temps de développement et de test", "jours-homme", "Tableau 1.2",',
    '"196 versions", "Temps de développement et de test", "jours-homme", "Tableau 1.2",\n'
    '        "ATTESTATIONS EN COPIE", "attestationTravailEmail", "attestationSalaireEmail",\n'
    '        "COPIE systématique", "4e expéditeur légitime", "destinataire PRINCIPAL",')
rep('"DÉCISION MANAGER : CARTE MASQUÉE POUR LE RH", "Enregistrer la décision du manager",',
    '"DÉCISION MANAGER : CARTE MASQUÉE POUR LE RH", "Enregistrer la décision du manager",\n'
    '        "ATTESTATIONS EN COPIE", "attestations de travail (copie)", "attestations de salaire (copie)",')

# ---- 10bis) Verifier : ignorer le CHROME du PDF (pieds de page) -----------------
# Une expression peut tomber PILE sur un saut de page (« attestations de salaire »
# en bas de page 18, « (copie) » en haut de la suivante) : le pied de page inséré
# entre les deux fragments empêchait l'appariement. On retire les lignes de
# pied de page AVANT la vérification (le contenu utile reste intact).
rep('    texte_complet = " ".join((lecteur.pages[i].extract_text() or "") for i in range(nb))',
    '    texte_complet = " ".join((lecteur.pages[i].extract_text() or "") for i in range(nb))\n'
    '    texte_complet = "\\n".join(\n'
    '        l_ for l_ in texte_complet.splitlines()\n'
    '        if not l_.strip().startswith("page ") and "Documentation technique et README officiel" not in l_\n'
    '    )')

# ---- 11) Annexe ------------------------------------------------------------------
rep("État du code livré v0.2.195. Trois rôles",
    "État du code livré v0.2.196. Trois rôles")

# ---- 12) Chemins de sortie des PDF ---------------------------------------------
rep('os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.195.pdf")',
    'os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.196.pdf")')
rep('os.path.join(RACINE, "download", "servicerh-readme-technique-reduit-v0.2.195.pdf")',
    'os.path.join(RACINE, "download", "servicerh-readme-technique-reduit-v0.2.196.pdf")')

io.open(DST, "w", encoding="utf-8").write(src)
print("transformer_readme_v02196 : %d remplacements → %s" % (remplacements, DST))
