#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fusion couverture + corps -> PDF final (normalisation A4)."""
from pypdf import PdfReader, PdfWriter

A4_W, A4_H = 595.28, 841.89
COVER = "/tmp/cover_securite.pdf"
BODY = "/home/z/my-project/download/rapport-securite-auto-rh-0.2.24.pdf"
OUT = "/home/z/my-project/download/rapport-securite-auto-rh-0.2.24-final.pdf"


def normalize(page):
    w, h = float(page.mediabox.width), float(page.mediabox.height)
    if abs(w - A4_W) > 0.1 or abs(h - A4_H) > 0.1:
        page.scale_to(A4_W, A4_H)
        page.mediabox.lower_left = (0, 0)
        page.mediabox.upper_right = (A4_W, A4_H)
    return page


writer = PdfWriter()
writer.add_page(normalize(PdfReader(COVER).pages[0]))
for p in PdfReader(BODY).pages:
    writer.add_page(normalize(p))
writer.add_metadata({
    "/Title": "Audit de sécurité Auto-RH 0.2.24",
    "/Author": "AutoRH",
    "/Creator": "AutoRH",
    "/Subject": "Audit de sécurité de l'application Auto-RH version 0.2.24",
})
with open(OUT, "wb") as f:
    writer.write(f)
print("Fusion OK :", OUT, "—", len(writer.pages), "pages")
