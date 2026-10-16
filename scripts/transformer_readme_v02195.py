#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Transforme creer_readme_essentiel_v02194.py en creer_readme_essentiel_v02195.py
(édition v0.2.195 — carte « Décision Manager » du détail des demandes de congé /
d'autorisation de sortie MASQUÉE pour le rôle RH dans l'onglet « Demandes » ;
l'enregistrement manuel de la décision du manager devient un repli réservé au
superadministrateur — même philosophie d'affichage que v0.2.186/194)."""
import io, os

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creer_readme_essentiel_v02194.py")
DST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "creer_readme_essentiel_v02195.py")

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

# ---- 1) Docstring : titre + bloc v0.2.195 ------------------------------------
rep("README officiel AutoRH — ÉDITION ESSENTIELLE v0.2.194 (~15 pages).",
    "README officiel AutoRH — ÉDITION ESSENTIELLE v0.2.195 (~15 pages).\n\n"
    "Demande utilisateur (v0.2.195) : « masquer cette partie dans cadre vert pour role\n"
    "rh dans les demade conge et autorisation » (capture : la carte « Décision Manager »\n"
    "du détail d'une demande — badge « En attente » + rangée « Enregistrer la décision\n"
    "du manager : Acceptée / Refusée »). — NOUVEAU : dans l'onglet « Demandes »\n"
    "(DemandesTab), la CARTE « Décision Manager » du dialogue de détail est MASQUÉE\n"
    "pour le rôle RH pour LES demandes à deux étapes (congé et autorisation de sortie) :\n"
    "une note discrète la remplace (« enregistrée par sa réponse e-mail — ou par le\n"
    "superadministrateur ») et l'ÉTAT de la décision (badge, date, acteur, formulation)\n"
    "reste consultable dans la section « Décision RH » ci-dessous (boîte « ÉTAT\n"
    "ACTUEL ») ainsi que dans la LISTE (badges « M : »). Le repli opérationnel\n"
    "(enregistrement manuel de la décision du manager) devient réservé au\n"
    "SUPERADMIN — les boutons « Acceptée / Refusée » lui restent intégraux ; les\n"
    "boutons de décision du RH (« Accepter la demande », « Refuser la demande »,\n"
    "« Information requise ») restent inchangés. AFFICHAGE SEUL : AUCUN changement\n"
    "serveur ni API (la matrice Manager × RH est intacte).")

# ---- 2) EDITION ---------------------------------------------------------------
rep('EDITION = "v0.2.194"', 'EDITION = "v0.2.195"')

# ---- 3) Bandeau de couverture --------------------------------------------------
rep('espacer("README OFFICIEL · ÉDITION ESSENTIELLE · V0.2.194")',
    'espacer("README OFFICIEL · ÉDITION ESSENTIELLE · V0.2.195")')

# ---- 4) Intro de couverture : phrase v0.2.195 ----------------------------------
rep('"« Demandes » — le matériel cryptographique reste géré par le "\n'
    '        "superadministrateur."))',
    '"« Demandes » — le matériel cryptographique reste géré par le "\n'
    '        "superadministrateur. Depuis la v0.2.195, la carte « Décision Manager » du "\n'
    '        "détail des demandes de congé et d\'autorisation de sortie est masquée pour "\n'
    '        "le rôle RH : le manager décide par e-mail et le repli manuel est réservé "\n'
    '        "au superadministrateur."))')

# ---- 5) Blocs de couverture ----------------------------------------------------
rep('"Réalisé du 12 septembre au 12 octobre 2026 — <b>31 jours calendaires</b>, 194 versions "',
    '"Réalisé du 12 septembre au 12 octobre 2026 — <b>31 jours calendaires</b>, 195 versions "')

# ---- 6) DIFFUSION : nom du fichier ---------------------------------------------
rep("Fichier : download/servicerh-readme-technique-v0.2.194.pdf.",
    "Fichier : download/servicerh-readme-technique-v0.2.195.pdf.")

# ---- 7) SOURCES : tête du bloc --------------------------------------------------
rep('"Code source livré v0.2.194 (CERTIFICAT : IMPORT MASQUÉ POUR LE RH — bloc « Fichier "',
    '"Code source livré v0.2.195 (DÉCISION MANAGER : CARTE MASQUÉE POUR LE RH — la carte "\n'
    '         "« Décision Manager » du détail des demandes de congé / d\'autorisation de "\n'
    '         "sortie (badge + boutons « Enregistrer la décision du manager : Acceptée / "\n'
    '         "Refusée ») est cachée pour le rôle RH, note informative à la place ; l\'état "\n'
    '         "de la décision reste visible dans la section « Décision RH » et dans la "\n'
    '         "liste · repli manuel réservé au SUPERADMIN · CERTIFICAT : IMPORT MASQUÉ "\n'
    '         "POUR LE RH — bloc « Fichier "')

# ---- 8) Tableau 5.1 : ligne v0.2.195 -------------------------------------------
rep('"toujours appliquée."],],',
    '"toujours appliquée."],\n'
    '         ["v0.2.195", "DÉCISION MANAGER : CARTE MASQUÉE POUR LE RH — dans le détail "\n'
    '                      "des demandes de congé et d\'autorisation de sortie (onglet "\n'
    '                      "« Demandes »), la carte « Décision Manager » (badge + boutons "\n'
    '                      "« Enregistrer la décision du manager ») est masquée pour le "\n'
    '                      "rôle RH ; une note indique que la décision est enregistrée par "\n'
    '                      "la réponse e-mail du manager (ou par le superadministrateur) ; "\n'
    '                      "l\'état de la décision reste affiché dans la section « Décision "\n'
    '                      "RH » et dans la liste (badge « M : ») ; repli manuel réservé au "\n'
    '                      "SUPERADMIN — aucun changement serveur."],],')

# ---- 9) Puce dédiée v0.2.195 (après la puce 194) --------------------------------
rep('"captures task194-rh-importer.png / task194-rh-demandes.png / "\n'
    '        "task194-superadmin-demandes.png ; suites v0.2.190→193 relancées 0 échec."))',
    '"captures task194-rh-importer.png / task194-rh-demandes.png / "\n'
    '        "task194-superadmin-demandes.png ; suites v0.2.190→193 relancées 0 échec."))\n'
    '    STORY.append(bul(\n'
    '        "<b>Demandes : carte « Décision Manager » masquée pour le rôle RH "\n'
    '        "(v0.2.195)</b> : DEMANDE UTILISATEUR — « masquer cette partie dans cadre vert "\n'
    '        "pour role rh dans les demade conge et autorisation » (capture de la carte "\n'
    '        "« Décision Manager » dans le détail d\'une demande de congé). Dans l\'onglet "\n'
    '        "« Demandes », le dialogue de détail des demandes à DEUX étapes (congé et "\n'
    '        "autorisation de sortie) n\'affiche PLUS la carte « Décision Manager » au rôle "\n'
    '        "RH : le rangée « Enregistrer la décision du manager : Acceptée / Refusée » "\n'
    '        "(repli opérationnel Task 181) disparaît et une note discrète la remplace — "\n'
    '        "« Décision du manager : enregistrée par sa réponse e-mail (ou par le "\n'
    '        "superadministrateur) — son état est affiché dans la section « Décision RH » "\n'
    '        "ci-dessous ». RIEN n\'est perdu pour le RH : l\'état de la décision du manager "\n'
    '        "(badge, date, acteur, formulation) reste visible dans la boîte « ÉTAT "\n'
    '        "ACTUEL » de la section « Décision RH » (v0.2.154) ET dans la liste des "\n'
    '        "demandes (badge « M : ») ; les cartes « Décision RH » et « Statut final » "\n'
    '        "restent affichées ; les boutons propres au RH (« Accepter la demande », "\n'
    '        "« Refuser la demande », « Information requise ») sont inchangés. Le "\n'
    '        "SUPERADMIN conserve la carte ENTIÈRE (enregistrement manuel de la décision "\n'
    '        "du manager toujours possible — repli opérationnel). AFFICHAGE SEUL : AUCUN "\n'
    '        "changement serveur ni API — la matrice Manager × RH (Task 181) et la "\n'
    '        "reconnaissance des réponses e-mail restent intactes. Preuve : build "\n'
    '        "production OK ; navigateur RÉEL — RH : carte absente + note affichée sur "\n'
    '        "une demande de congé ET une autorisation de sortie, aucun bouton "\n'
    '        "« Enregistrer la décision du manager » ; SUPERADMIN : carte entière "\n'
    '        "conservée ; captures task195-rh-demande-conge.png / "\n'
    '        "task195-rh-demande-autorisation.png / task195-superadmin-demande-conge.png ; "\n'
    '        "suites v0.2.190→193 relancées : 232 contrôles, 0 échec."))')

# ---- 10) Marqueurs verifier du générateur ---------------------------------------
rep('"V0.2.194", "AutoRH", "ÉDITION ESSENTIELLE",',
    '"V0.2.195", "AutoRH", "ÉDITION ESSENTIELLE",')
rep('"194 versions", "Temps de développement et de test", "jours-homme", "Tableau 1.2",',
    '"195 versions", "Temps de développement et de test", "jours-homme", "Tableau 1.2",\n'
    '        "DÉCISION MANAGER : CARTE MASQUÉE POUR LE RH", "Enregistrer la décision du manager",\n'
    '        "enregistrée par sa réponse e-mail", "ÉTAT ACTUEL", "DemandesTab",')
rep('"CERTIFICAT : IMPORT MASQUÉ POUR LE RH", "réservé au",',
    '"CERTIFICAT : IMPORT MASQUÉ POUR LE RH", "réservé au",\n'
    '        "DÉCISION MANAGER : CARTE MASQUÉE POUR LE RH",')

# ---- 11) Annexe ------------------------------------------------------------------
rep("État du code livré v0.2.194. Trois rôles",
    "État du code livré v0.2.195. Trois rôles")

# ---- 12) Chemins de sortie des PDF ---------------------------------------------
rep('os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.194.pdf")',
    'os.path.join(RACINE, "download", "servicerh-readme-technique-v0.2.195.pdf")')
rep('os.path.join(RACINE, "download", "servicerh-readme-technique-reduit-v0.2.194.pdf")',
    'os.path.join(RACINE, "download", "servicerh-readme-technique-reduit-v0.2.195.pdf")')

io.open(DST, "w", encoding="utf-8").write(src)
print("transformer_readme_v02195 : %d remplacements → %s" % (remplacements, DST))
