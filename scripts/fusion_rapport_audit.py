#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fusion couverture + corps -> PDF final unique."""
from pypdf import PdfReader, PdfWriter

A4_W, A4_H = 595.28, 841.89

COVER = "/home/z/my-project/audit_zip_task94/cover_audit.pdf"
BODY = "/home/z/my-project/audit_zip_task94/corps_rapport.pdf"
OUT = "/home/z/my-project/download/rapport-securite-zip-corrige-auto-rh.pdf"


def normalize(page):
    box = page.mediabox
    w, h = float(box.width), float(box.height)
    if abs(w - A4_W) > 0.1 or abs(h - A4_H) > 0.1:
        page.scale_to(A4_W, A4_H)
    return page


writer = PdfWriter()
writer.add_page(normalize(PdfReader(COVER).pages[0]))
for p in PdfReader(BODY).pages:
    writer.add_page(normalize(p))
writer.add_metadata({
    "/Title": "Rapport d'audit de sécurité — ZIP « CORRIGÉ » Auto-RH",
    "/Author": "AutoRH",
    "/Creator": "AutoRH",
    "/Subject": "Audit de sécurité de l'archive auto-rh-scripts-site-web-CORRIGE (1).zip",
})
with open(OUT, "wb") as f:
    writer.write(f)
print("PDF final :", OUT, "-", len(writer.pages), "pages")
