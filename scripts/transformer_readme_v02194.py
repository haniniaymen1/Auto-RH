#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Transforme creer_readme_essentiel_v02193.py en creer_readme_essentiel_v02194.py
(édition v0.2.194 — bloc d'IMPORT du fichier de certificat MASQUÉ pour le rôle RH
dans les sections « Importer » et « Demandes » ; matériel cryptographique réservé
au superadministrateur, même pattern que ReponsePdfPanel v0.2.186)."""
import io, os

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creer_readme_essentiel_v02193.py")
DST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creer_readme_essentiel_v02194.py")

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

# ---- 1) Docstring : titre + bloc v0.2.194 ------------------------------------
rep("README officiel AutoRH — ÉDITION ESSENTIELLE v0.2.193 (~15 pages).",
    "README officiel AutoRH — ÉDITION ESSENTIELLE v0.2.194 (~15 pages).\n\n"
    "Demande utilisateur (v0.2.194) : « masquer ce bloc pour le role rh dans la section\n"
    "importer et demande » (capture : le bloc « Fichier de certificat de CETTE section »\n"
    "+ « Clé privée associée (.pem, .key, .der) — facultative » + avertissement « Aucun\n"
    "certificat DÉDIÉ importé »). — NOUVEAU : le bloc d'IMPORT du fichier de certificat\n"
    "(choix du fichier .p12/.pfx/…, mot de passe PKCS#12, clé privée associée, notes\n"
    "d'attente/de retrait et avertissements d'import) est MASQUÉ pour le rôle RH dans les\n"
    "DEUX sections qui le portent : onglet « Importer » (SignaturePanel — rubrique\n"
    "« Certificat de signature électronique » des fiches de paie) et onglet « Demandes »\n"
    "(SignaturePanelReponses — rubrique « Certificat de signature électronique\n"
    "(réponses) ») ; une note informative indique au RH que l'import est réservé au\n"
    "superadministrateur. L'interrupteur d'utilisation, le positionnement du bloc et\n"
    "l'affichage des métadonnées restent visibles ; le certificat enregistré continue de\n"
    "s'appliquer (fiches et réponses) quelle que soit la personne qui consulte. Même\n"
    "pattern que ReponsePdfPanel v0.2.186 (prop masquerCertificat) — 3e section ainsi\n"
    "gouvernée. SUPERADMIN conserve les blocs ENTIERS ; AUCUN changement serveur (les\n"
    "routes d'import restaient déjà gardées par la session).")

# ---- 2) EDITION ---------------------------------------------------------------
rep('EDITION = "v0.2.193"', 'EDITION = "v0.2.194"')

# ---- 3) Bandeau de couverture --------------------------------------------------
rep('espacer("README OFFICIEL · ÉDITION ESSENTIELLE · V0.2.193")',
    'espacer("README OFFICIEL · ÉDITION ESSENTIELLE · V0.2.194")')

# ---- 4) Intro de couverture : phrase v0.2.194 ----------------------------------
rep('"que la pièce jointe PDF."))',
    '"que la pièce jointe PDF. Depuis la v0.2.194, le bloc d\'import du fichier de "\n'
    '        "certificat est masqué pour le rôle RH dans les sections « Importer » et "\n'
    '        "« Demandes » — le matériel cryptographique reste géré par le "\n'
    '        "superadministrateur."))')

# ---- 5) Blocs de couverture ----------------------------------------------------
rep('"Réalisé du 12 septembre au 12 octobre 2026 — <b>31 jours calendaires</b>, 193 versions "',
    '"Réalisé du 12 septembre au 12 octobre 2026 — <b>31 jours calendaires</b>, 194 versions "')

# ---- 6) DIFFUSION : nom du fichier ---------------------------------------------
rep("Fichier : download/servicerh-readme-technique-v0.2.193.pdf.",
    "Fichier : download/servicerh-readme-technique-v0.2.194.pdf.")

# ---- 7) SOURCES : tête du bloc --------------------------------------------------
rep('"Code source livré v0.2.193 (NOTIFICATIONS TOUJOURS ENVOYÉES — les e-mails de "',
    '"Code source livré v0.2.194 (CERTIFICAT : IMPORT MASQUÉ POUR LE RH — bloc « Fichier "\n'
    '         "de certificat de CETTE section » + clé privée + avertissements d\'import "\n'
    '         "cachés dans les sections « Importer » et « Demandes », note « réservé au "\n'
    '         "superadministrateur » à la place ; interrupteur et positionnement conservés · "\n'
    '         "NOTIFICATIONS TOUJOURS ENVOYÉES — les e-mails de "')

# ---- 8) Tableau 5.1 : ligne v0.2.194 -------------------------------------------
rep('"monde est notifié."],],',
    '"monde est notifié."],\n'
    '         ["v0.2.194", "CERTIFICAT : IMPORT MASQUÉ POUR LE RH — le bloc d\'import du "\n'
    '                      "fichier de certificat (fichier, mot de passe PKCS#12, clé privée "\n'
    '                      "associée, notes d\'attente et avertissements) est masqué dans les "\n'
    '                      "sections « Importer » et « Demandes » ; une note renvoie le RH au "\n'
    '                      "superadministrateur ; interrupteur, positionnement et métadonnées "\n'
    '                      "restent visibles ; configuration enregistrée inchangée et "\n'
    '                      "toujours appliquée."],],')

# ---- 9) Puce dédiée v0.2.194 (après la puce 193) --------------------------------
rep('        "navigateur."))',
    '        "navigateur."))\n'
    '    STORY.append(bul(\n'
    '        "<b>Certificat : bloc d\'import masqué pour le rôle RH (v0.2.194)</b> : "\n'
    '        "DEMANDE UTILISATEUR — « masquer ce bloc pour le role rh dans la section importer "\n'
    '        "et demande » (capture du bloc « Fichier de certificat de CETTE section »). Le "\n'
    '        "bloc d\'IMPORT du fichier de certificat est désormais caché pour le rôle RH dans "\n'
    '        "les DEUX sections qui le portent : (1) onglet « Importer » — rubrique "\n'
    '        "« Certificat de signature électronique » (fiches de paie) : choix du fichier, "\n'
    '        "mot de passe PKCS#12, clé privée associée, notes « à retirer » / « nouveau "\n'
    '        "fichier en attente » ; (2) onglet « Demandes » — rubrique « Certificat de "\n'
    '        "signature électronique (réponses) » : mêmes éléments + avertissements « Aucun "\n'
    '        "certificat DÉDIÉ importé » et « configuration pas encore enregistrée ». Une "\n'
    '        "note informe le RH que l\'import est réservé au superadministrateur. RESTE "\n'
    '        "VISIBLE : l\'interrupteur d\'utilisation du certificat, le positionnement du "\n'
    '        "bloc (mode certActif) et l\'affichage des métadonnées (titulaire, émetteur, "\n'
    '        "validité, empreinte). SUPERADMIN conserve les blocs complets ; la "\n'
    '        "configuration enregistrée s\'applique quelle que soit la personne qui consulte "\n'
    '        "(aucun écrasement possible — le champ fichier reste vide côté RH). Même "\n'
    '        "pattern que ReponsePdfPanel v0.2.186 (prop masquerCertificat) — le RH ne "\n'
    '        "gère AUCUN matériel cryptographique. AUCUN changement serveur. Preuve : build "\n'
    '        "production OK ; navigateur RÉEL — RH : blocs absents (texte introuvable dans "\n'
    '        "les deux onglets) + note affichée ; SUPERADMIN : blocs entiers conservés ; "\n'
    '        "captures task194-rh-importer.png / task194-rh-demandes.png / "\n'
    '        "task194-superadmin-demandes.png ; suites v0.2.190→193 relancées 0 échec."))')

# ---- 10) Marqueurs verifier du générateur ---------------------------------------
rep('"V0.2.193", "AutoRH", "ÉDITION ESSENTIELLE",',
    '"V0.2.194", "AutoRH", "ÉDITION ESSENTIELLE",')
rep('"193 versions", "Temps de développement et de test", "jours-homme", "Tableau 1.2",',
    '"194 versions", "Temps de développement et de test", "jours-homme", "Tableau 1.2",\n'
    '        "Certificat : bloc d\'import masqué pour le rôle RH", "Fichier de certificat de CETTE section",\n'
    '        "réservé au superadministrateur", "matériel cryptographique", "masquerCertificat",')
rep('"notification TOUJOURS envoyée", "LA MÊME notification SANS le PDF",',
    '"notification TOUJOURS envoyée", "LA MÊME notification SANS le PDF",\n'
    '        "CERTIFICAT : IMPORT MASQUÉ POUR LE RH", "réservé au",')

# ---- 11) Annexe ------------------------------------------------------------------
rep("État du code livré v0.2.193. Trois rôles",
    "État du code livré v0.2.194. Trois rôles")

# ---- 12) Chemins de sortie des PDF ---------------------------------------------
rep('os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.193.pdf")',
    'os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.194.pdf")')
rep('os.path.join(RACINE, "download", "servicerh-readme-technique-reduit-v0.2.193.pdf")',
    'os.path.join(RACINE, "download", "servicerh-readme-technique-reduit-v0.2.194.pdf")')

io.open(DST, "w", encoding="utf-8").write(src)
print("transformer_readme_v02194 : %d remplacements → %s" % (remplacements, DST))
