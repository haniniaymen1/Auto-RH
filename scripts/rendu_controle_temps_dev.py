#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 254 — Contrôle visuel : rendu des pages contenant la sous-section
« Temps de développement et de test » dans les deux éditions du README."""
import os
from pypdf import PdfReader
import pypdfium2 as pdfium

RACINE = "/home/z/my-project"
SORTIE = os.path.join(RACINE, "download", "verif-readme-temps-dev")
os.makedirs(SORTIE, exist_ok=True)

CIBLES = [
    ("complet", os.path.join(RACINE, "servicerh-readme-technique.pdf")),
    ("reduit", os.path.join(RACINE, "servicerh-readme-technique-reduit.pdf")),
]

MOTIFS = ["Temps de développement et de test", "jours-homme"]

for etiquette, chemin in CIBLES:
    lecteur = PdfReader(chemin)
    pages = []
    for i, page in enumerate(lecteur.pages):
        texte = page.extract_text() or ""
        compact = "".join(texte.split())
        if any("".join(m.split()) in compact for m in MOTIFS):
            pages.append(i)
    print("%s : %d pages — sections trouvées aux pages %s (1-based: %s)"
          % (etiquette, len(lecteur.pages),
             [p + 1 for p in pages], [p + 1 for p in pages]))
    doc_pdfium = pdfium.PdfDocument(chemin)
    for p in pages:
        bmp = doc_pdfium[p].render(scale=2.0)
        img = bmp.to_pil()
        nom = "verif-temps-dev-%s-p%02d.png" % (etiquette, p + 1)
        img.save(os.path.join(SORTIE, nom))
        print("  rendu ->", nom)
    doc_pdfium.close()
print("Contrôle visuel terminé :", SORTIE)
