#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Debug Task 203 — localise les résidus après chirurgie (sans écrire)."""

CHEMIN = "/home/z/my-project/scripts/maj_readme_v096.py"
with open(CHEMIN, encoding="utf-8") as f:
    lignes = f.readlines()


def index_ligne(lignes, prefixe, debut=0):
    for k in range(debut, len(lignes)):
        if lignes[k].startswith(prefixe):
            return k
    raise AssertionError("ancre introuvable : " + prefixe)


# étape 1 : docstring
i0 = index_ligne(lignes, '"""')
i1 = index_ligne(lignes, '"""', i0 + 1)
nouvelle_doc = ["# docdebug\n"] * 15
lignes[i0 + 1:i1] = nouvelle_doc
texte = "".join(lignes)

# étape 3 : bloc données
lignes = texte.splitlines(keepends=True)
i_deb = index_ligne(lignes, "# ---- Annexe B : évolutions v0.2.83 à v0.2.98")
i_fin = index_ligne(lignes, "# ---- Annexe C : map de routage des e-mails des demandes (Task 198)", i_deb + 1)
lignes[i_deb:i_fin] = ["# ---- Annexe B : map debug ---\n"]
texte = "".join(lignes)

# étape 10 : bloc rendu
lignes = texte.splitlines(keepends=True)
i_deb = index_ligne(lignes, "    # ================= ANNEXE B ")
i_fin = index_ligne(lignes, "    # ================= ANNEXE C ", i_deb + 1)
lignes[i_deb:i_fin] = ["    # ================= ANNEXE B : map debug ====\n"]
texte = "".join(lignes)

# étape 11 : renommages (mêmes comptes que la chirurgie)
for ancien, nouveau, attendu in (
    ("entete_C", "entete_B", 3),
    ("np_C", "np_B", 5),
    ("titre_bloc_c", "titre_bloc_b", 4),
    ("tableau_c", "tableau_b", 3),
    ('PIEDS["C"]', 'PIEDS["B"]', 2),
    ('"Annexe C — Map de routage des e-mails des demandes"',
     '"Annexe B — Map de routage des e-mails des demandes"', 1),
    ('"Annexe C — Map de routage des e-mails (suite)"',
     '"Annexe B — Map de routage des e-mails (suite)"', 1),
):
    n = texte.count(ancien)
    print("%-55s : %d (attendu %d)" % (ancien[:55], n, attendu))
    assert n == attendu
    texte = texte.replace(ancien, nouveau)

print("=== résidus « Annexe C » restants ===")
for k, l in enumerate(texte.splitlines(), 1):
    if "Annexe C" in l:
        print("%4d: %s" % (k, l.strip()[:120]))
