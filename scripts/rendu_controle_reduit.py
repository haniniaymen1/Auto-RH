#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 253 — rendu PNG de contrôle visuel du README réduit."""
import pypdfium2 as pdfium

PDF = "/home/z/my-project/download/servicerh-readme-technique-reduit-v0.2.134.pdf"
SORTIE = "/home/z/my-project/download/verif-readme-reduit"
import os
os.makedirs(SORTIE, exist_ok=True)
doc = pdfium.PdfDocument(PDF)
print("pages:", len(doc))
# couverture, résumé technique, démarrage/checklist, capacité, dépannage, matrice, dernière page
pages = [0, 1, 5, 7, 8, 10, 12]
for i in pages:
    page = doc[i]
    bmp = page.render(scale=1.6)
    img = bmp.to_pil()
    out = "%s/page-%02d.png" % (SORTIE, i + 1)
    img.save(out)
    print(out)
