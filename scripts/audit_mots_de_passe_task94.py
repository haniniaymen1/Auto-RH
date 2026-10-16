#!/usr/bin/env python3
"""Audit : tous les littéraux newPassword / nouveau mot de passe des scripts
de test sont-ils conformes à la politique Task 94 ?"""
import re
import glob

MOTIF = re.compile(r"""newPassword["']?\s*[:,]\s*["']([^"']+)["']""")
variables = {
    "NOUVEAU": "NouveauSolide64!", "NOUVEAU1": "MonNouveauMot64!",
    "NOUVEAU2": "EncorePlusSolide64!", "NOUVEAU1B": "NouveauMot66!",
    "NOUVEAU2B": "EncorePlusSolide66!",
}

def conforme(m):
    return (
        len(m) >= 8 and re.search(r"[a-z]", m) and re.search(r"[A-Z]")
        and re.search(r"[0-9]", m) and re.search(r"[^A-Za-z0-9]", m)
    ) if False else (
        len(m) >= 8
        and re.search(r"[a-z]", m) is not None
        and re.search(r"[A-Z]", m) is not None
        and re.search(r"[0-9]", m) is not None
        and re.search(r"[^A-Za-z0-9]", m) is not None
    )

problemes = []
for f in glob.glob("/home/z/my-project/scripts/test*.py") + glob.glob("/home/z/my-project/scripts/test*.js"):
    if "__pycache__" in f:
        continue
    texte = open(f, encoding="utf-8", errors="replace").read()
    for m in MOTIF.finditer(texte):
        val = m.group(1)
        ligne = texte[: m.start()].count("\n") + 1
        if val in ("NOUVEAU", "NOUVEAU1", "NOUVEAU2") or not re.match(r"^[A-Za-z0-9!@#$%^&*()_+=\-.?]+$", val):
            continue  # variable ou valeur non littérale simple
        if not conforme(val):
            problemes.append((f.split("/")[-1], ligne, val))

if problemes:
    print("NON CONFORMES :")
    for f, l, v in problemes:
        print(f"  {f}:{l}  {v!r}")
else:
    print("TOUS les littéraux newPassword sont conformes (8+ car., 4 classes).")
