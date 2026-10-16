#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 195 — QA visuelle du README mis à jour : rendu des pages 20-23 en PNG."""
import pypdfium2 as pdfium

PDF = "/home/z/my-project/auto-rh-readme-technique.pdf"
doc = pdfium.PdfDocument(PDF)
print("Pages totales :", len(doc))
for i in range(19, len(doc)):
    page = doc[i]
    bmp = page.render(scale=1.6)
    img = bmp.to_pil()
    out = "/home/z/my-project/scripts/qa-readme-p%d.png" % (i + 1)
    img.save(out)
    print("Rendu :", out, img.size)
doc.close()
