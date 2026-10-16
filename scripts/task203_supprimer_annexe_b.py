#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 203 — Suppression de l'annexe B « Évolutions de l'application v0.2.83 à
v0.2.98 » du générateur scripts/maj_readme_v096.py.

Chirurgie en place :
- suppression du bloc de DONNÉES de l'annexe B (B_INTRO, B_ROWS) ;
- suppression du bloc de RENDU de l'annexe B (entete_B, np_B, tableau évolutions) ;
- renumérotation de l'ancienne annexe C (map de routage) en annexe B
  (PIEDS, sommaire de couverture, en-têtes, fonctions internes) ;
- retrait des renvois « annexe B » / « annexe C » du cœur et de l'annexe A ;
- recalage des marqueurs de contrôle (attendus).

Chaque remplacement est gardé par un compte d'occurrences attendu ; le script
est idempotent-refusant (il échoue sans écrire si un ancre est absent).
"""

CHEMIN = "/home/z/my-project/scripts/maj_readme_v096.py"

with open(CHEMIN, encoding="utf-8") as f:
    lignes = f.readlines()


def index_ligne(lignes, prefixe, debut=0):
    for k in range(debut, len(lignes)):
        if lignes[k].startswith(prefixe):
            return k
    raise AssertionError("ancre introuvable : " + prefixe)


def remplacer(texte, ancien, nouveau, attendu, label):
    n = texte.count(ancien)
    assert n == attendu, "%s : %d occurrence(s), %d attendue(s)" % (label, n, attendu)
    return texte.replace(ancien, nouveau)


# ---- 1. Docstring -----------------------------------------------------------
i0 = index_ligne(lignes, '"""')              # ouverture (ligne 2)
i1 = index_ligne(lignes, '"""', i0 + 1)      # fermeture
nouvelle_doc = [
    "Task 203 — Suppression de l'annexe B (historique des évolutions de\n",
    "l'application) du README officiel : cette annexe ne sert pas au lecteur\n",
    "final (le cœur décrit l'état présent du code livré) et occupait une page\n",
    "entière. Renvois « annexe B » retirés du cœur ; l'annexe « Map de routage\n",
    "des e-mails » est renumérotée B (annexes A et B, sans trou).\n",
    "\n",
    "L'édition reste libellée v0.2.98 : l'état de l'application ne change pas,\n",
    "seul le document est allégé (14 pages -> 13 pages attendues).\n",
    "\n",
    "Sorties : auto-rh-readme-technique.pdf (racine), download/auto-rh-readme-\n",
    "technique.pdf, download/auto-rh-readme-technique-v0.2.98.pdf (édition\n",
    "versionnée servie en priorité par la route publique /api/download-readme).\n",
    "Sauvegarde préalable de l'édition v0.2.98 d'origine : /tmp/my-project/\n",
    "(idempotent — le fichier existe déjà, aucune nouvelle copie).\n",
]
lignes[i0 + 1:i1] = nouvelle_doc

texte = "".join(lignes)

# ---- 2. Chemins : ANCIEN_VERSIONNE supprimé, sauvegarde recalée -------------
texte = remplacer(
    texte,
    'ANCIEN_VERSIONNE = os.path.join(RACINE, "download", "auto-rh-readme-technique-v0.2.97.pdf")\n',
    "", 1, "suppression ANCIEN_VERSIONNE")
texte = remplacer(
    texte,
    'SAUVEGARDE_PRECEDENTE = "/tmp/my-project/auto-rh-readme-technique-v0.2.97-edition-finale.pdf"\n',
    'SAUVEGARDE_PRECEDENTE = "/tmp/my-project/auto-rh-readme-technique-v0.2.98-avant-suppression-annexe-b.pdf"\n',
    1, "SAUVEGARDE_PRECEDENTE")

# ---- 3. Suppression du bloc de DONNÉES de l'annexe B ------------------------
lignes = texte.splitlines(keepends=True)
i_deb = index_ligne(lignes, "# ---- Annexe B : évolutions v0.2.83 à v0.2.98")
i_fin = index_ligne(lignes, "# ---- Annexe C : map de routage des e-mails des demandes (Task 198)", i_deb + 1)
assert i_fin > i_deb, "bloc données annexe B : bornes incohérentes"
lignes[i_deb:i_fin + 1] = ["# ---- Annexe B : map de routage des e-mails des demandes --------------------\n"]
texte = "".join(lignes)
assert "B_INTRO = (" not in texte and "B_ROWS = [" not in texte, "définitions B_INTRO/B_ROWS résiduelles"

# ---- 4. PIEDS ---------------------------------------------------------------
texte = remplacer(
    texte,
    'PIEDS = {\n'
    '    "A": "Annexe A : matrice des droits des rôles (état du code v0.2.98)",\n'
    '    "B": "Annexe B : évolutions v0.2.83 à v0.2.98",\n'
    '    "C": "Annexe C : map de routage des e-mails des demandes (v0.2.94)",\n'
    '}\n',
    'PIEDS = {\n'
    '    "A": "Annexe A : matrice des droits des rôles (état du code v0.2.98)",\n'
    '    "B": "Annexe B : map de routage des e-mails des demandes (v0.2.94)",\n'
    '}\n',
    1, "PIEDS")

# ---- 5. Sommaire de couverture ----------------------------------------------
texte = remplacer(
    texte,
    '    "Annexe B — Évolutions de l\'application v0.2.83 à v0.2.98",\n'
    '    "Annexe C — Map de routage des e-mails des demandes (5 types, 8 champs)",\n',
    '    "Annexe B — Map de routage des e-mails des demandes (5 types, 8 champs)",\n',
    1, "SOMMAIRE annexes")

# ---- 6. Descriptif de couverture --------------------------------------------
texte = remplacer(
    texte,
    '"240 000 fiches (20 ans), exploitation et dépannage. Les annexes A à C complètent le cœur : "\n'
    '            "matrice des droits des rôles, évolutions v0.2.83 à v0.2.98 et map de routage des e-mails "\n'
    '            "des demandes du portail employé.")',
    '"240 000 fiches (20 ans), exploitation et dépannage. Les annexes A et B complètent le cœur : "\n'
    '            "matrice des droits des rôles et map de routage des e-mails des demandes du portail '
    'employé.")',
    1, "descriptif couverture")

# ---- 7. Renvois annexe C -> annexe B (annexe A + cœur) ----------------------
texte = remplacer(texte,
                  "(détails en annexe C) — et tests d'envoi SMTP / IMAP",
                  "(détails en annexe B) — et tests d'envoi SMTP / IMAP",
                  1, "ligne SMTP annexe A")
texte = remplacer(texte,
                  "pour les 5 types (détails en annexe C).",
                  "pour les 5 types (détails en annexe B).",
                  1, "portail : détails routage")
texte = remplacer(texte,
                  '"annexe C. Réception des réponses du RH par IMAP',
                  '"annexe B. Réception des réponses du RH par IMAP',
                  1, "cœur : map complète")

# ---- 8. Renvois annexe B retirés du cœur ------------------------------------
texte = remplacer(
    texte,
    '             "comportement tel qu\'il se manifeste à l\'écran et dans les API. L\'installation est détaillée en "\n'
    '             "section 3, l\'exploitation quotidienne en section 6 ; les évolutions récentes sont récapitulées "\n'
    '             "en annexe B.")',
    '             "comportement tel qu\'il se manifeste à l\'écran et dans les API. L\'installation est détaillée en "\n'
    '             "section 3, l\'exploitation quotidienne en section 6.")',
    1, "intro section 2")
texte = remplacer(texte,
                  '"glisser-déposer (annexe B). Tous les formats tamponnés : PDF (y compris pages pivotées), images, "',
                  '"glisser-déposer. Tous les formats tamponnés : PDF (y compris pages pivotées), images, "',
                  1, "cœur : aperçu A4")
texte = remplacer(texte,
                  '"multi-formats chiffré sur disque (v0.2.88) — détails en annexe B.")',
                  '"multi-formats chiffré sur disque.")',
                  1, "cœur : certificat multi-formats")
texte = remplacer(
    texte,
    '             "installer la dernière revient à bénéficier de l\'ensemble des correctifs ; les évolutions "\n'
    '             "v0.2.83 à v0.2.98 sont récapitulées en annexe B.")',
    '             "installer la dernière revient à bénéficier de l\'ensemble des correctifs.")',
    1, "intro section 7")

# ---- 9. Docstring de dessine_annexes ----------------------------------------
texte = remplacer(texte,
                  '    """Annexes A/B/C reprises de la v0.2.95 (Tasks 195-198) sur le même canvas."""',
                  '    """Annexes A (matrice des droits) et B (map de routage des e-mails) sur le même canvas."""',
                  1, "docstring dessine_annexes")

# ---- 10. Suppression du bloc de RENDU de l'annexe B -------------------------
lignes = texte.splitlines(keepends=True)
i_deb = index_ligne(lignes, "    # ================= ANNEXE B ")
i_fin = index_ligne(lignes, "    # ================= ANNEXE C ", i_deb + 1)
assert i_fin > i_deb, "bloc rendu annexe B : bornes incohérentes"
# garde-fou : le bloc supprimé doit contenir les fonctions propres à l'annexe B
bloc = "".join(lignes[i_deb:i_fin])
for attendu_dans_bloc in ("def entete_B(", "def np_B():", "B_INTRO", "B_ROWS", "dessiner_entete_evol"):
    assert attendu_dans_bloc in bloc, "bloc rendu : ancre manquante dans le bloc : " + attendu_dans_bloc
lignes[i_deb:i_fin + 1] = ["    # ================= ANNEXE B : map de routage des e-mails ==================\n"]
texte = "".join(lignes)

# ---- 11. Renumérotation de la map : C -> B ----------------------------------
texte = remplacer(texte, "entete_C", "entete_B", 3, "entete_C -> entete_B")
texte = remplacer(texte, "np_C", "np_B", 5, "np_C -> np_B")
texte = remplacer(texte, "titre_bloc_c", "titre_bloc_b", 4, "titre_bloc_c -> titre_bloc_b")
texte = remplacer(texte, "tableau_c", "tableau_b", 3, "tableau_c -> tableau_b")
texte = remplacer(texte, 'PIEDS["C"]', 'PIEDS["B"]', 2, 'PIEDS["C"] -> PIEDS["B"]')
texte = remplacer(texte,
                  '"Annexe C — Map de routage des e-mails des demandes"',
                  '"Annexe B — Map de routage des e-mails des demandes"',
                  1, "titre annexe map")
texte = remplacer(texte,
                  '"Annexe C — Map de routage des e-mails (suite)"',
                  '"Annexe B — Map de routage des e-mails (suite)"',
                  1, "titre annexe map (suite)")
texte = remplacer(texte,
                  "# équilibre C-1 / C-2 : le bloc Mécanique commune démarre sur la page suivante",
                  "# équilibre B-1 / B-2 : le bloc Mécanique commune démarre sur la page suivante",
                  1, "commentaire équilibre")

# ---- 12. Marqueurs de contrôle (attendus) -----------------------------------
texte = remplacer(texte,
                  '        "Sommaire", "v0.2.97", "v0.2.98",\n',
                  '        "Sommaire", "v0.2.98",\n',
                  1, "marqueur v0.2.97")
texte = remplacer(texte,
                  "        # annexes — canaris Tasks 196/197/198 (conservés)\n",
                  "        # annexes — canaris (matrice, onglets, portail, principes, map)\n",
                  1, "commentaire canaris")
texte = remplacer(
    texte,
    '        "Annexe B", "v0.2.83", "HMAC", "scope=reponse", "parrainage",\n'
    '        "Send Mail", "Configuration des réponses",\n'
    '        "Booléen « configurée » seul", "Oui (consultation seule)",\n'
    '        "Map de configuration des mails", "attestationTravailEmail",\n',
    '        "HMAC", "parrainage",\n'
    '        "Send Mail", "Configuration des réponses",\n'
    '        "Booléen « configurée » seul", "Oui (consultation seule)",\n'
    '        "attestationTravailEmail",\n',
    1, "canaris annexe B évolutions")
texte = remplacer(texte,
                  '        "Annexe C", "Routage par type de demande",\n',
                  '        "Annexe B — Map de routage des e-mails", "Routage par type de demande",\n',
                  1, "canaris annexe map")
texte = remplacer(
    texte,
    '        "DESTINATAIRE_ABSENT", "model MailConfig",\n'
    '        # annexe B — ligne v0.2.97 (QR « Fiche en ligne » + signature)\n'
    '        "Fiche en ligne", "PKCS#7", "signatures-exemple-auto-rh.zip",\n'
    '        # annexe B — ligne v0.2.98 (correctif aperçu FICHE)\n'
    '        "Données de la réponse",\n',
    '        "DESTINATAIRE_ABSENT", "model MailConfig",\n'
    '        # QR « Fiche en ligne » (annexe A — fiches de paie)\n'
    '        "Fiche en ligne",\n',
    1, "canaris lignes v0.2.97/v0.2.98")

# ---- 13. main() : sauvegarde, bloc ANCIEN, message final --------------------
texte = remplacer(texte,
                  "    # sauvegarde idempotente de l'édition v0.2.97 (édition finale) avant livraison v0.2.98\n",
                  "    # sauvegarde idempotente de l'édition v0.2.98 d'origine avant suppression de l'annexe B\n",
                  1, "commentaire sauvegarde")
texte = remplacer(texte,
                  "        print(\"Sauvegarde de l'édition v0.2.97 avant la v0.2.98 : \" + SAUVEGARDE_PRECEDENTE)",
                  "        print(\"Sauvegarde de l'édition v0.2.98 d'origine : \" + SAUVEGARDE_PRECEDENTE)",
                  1, "print sauvegarde")
texte = remplacer(
    texte,
    '    # édition supplantée retirée (convention des Tasks 195-198)\n'
    '    if os.path.exists(ANCIEN_VERSIONNE) and nb >= 12:\n'
    '        os.remove(ANCIEN_VERSIONNE)\n',
    "",
    1, "bloc ANCIEN_VERSIONNE")
texte = remplacer(texte,
                  '    print("OK : édition v0.2.98 — %d pages (édition précédente : 14 pages)" % nb)',
                  '    print("OK : édition v0.2.98 sans annexe B — %d pages (édition précédente : 14 pages)" % nb)',
                  1, "message final")

# ---- 14. Contrôles finaux ---------------------------------------------------
for residu in ("ANCIEN_VERSIONNE", "B_INTRO", "B_ROWS", "entete_C", "np_C(",
               "titre_bloc_c", "tableau_c", "v0.2.83", "v0.2.97", "scope=reponse",
               "Annexe C", "annexe C", "PKCS#7", "signatures-exemple-auto-rh",
               "Données de la réponse"):
    assert residu not in texte, "résidu non supprimé : " + residu

compile(texte, CHEMIN, "exec")  # syntaxe valide

with open(CHEMIN, "w", encoding="utf-8") as f:
    f.write(texte)

nb_lignes = texte.count("\n")
print("OK : maj_readme_v096.py édité — %d lignes (avant : 1579)." % nb_lignes)
print("Annexe B (évolutions) supprimée ; map de routage renumérotée annexe B ; marqueurs recalés.")
