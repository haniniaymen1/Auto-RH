#!/usr/bin/env python3
"""Task 19 — Vérité terrain : normalizedContent des PDF + simulation exacte de la recherche portail."""
import sqlite3, re, sys

DB = "/home/z/my-project/db/custom.db"
con = sqlite3.connect(DB)
cur = con.cursor()

rows = cur.execute("""
  SELECT id, fileName, cin, content, normalizedContent FROM Payslip
  WHERE fileName LIKE 'bulletin_900001%' OR fileName LIKE 'bulletin_900002%'
  ORDER BY uploadedAt DESC LIMIT 2""").fetchall()

def normalize_text(t):  # copie exacte de normalizeText du portail
    return re.sub(r"[\s.\/\-]", "", str(t or "").upper())

def is_exact_cin_in_content(content, q):
    """Copie simplifiée : le CIN apparaît comme numéro complet (pas sous-séquence).
    Version portail réelle : voir portail-server.js — on teste contains simple + frontières."""
    if not content or not q:
        return False
    c = normalize_text(content)   # le portail normalise-t-il le contenu ? à vérifier
    # version naive: contains sur contenu brut et normalisé
    return q in content or q in c

for rid, fn, cin, content, ncont in rows:
    print("=", fn, "| cin =", cin)
    print("  content len:", len(content or ""), "| normalizedContent len:", len(ncont or ""))
    for needle in ["900001", "SPEC-0001", "SPEC0001", "SPECIMEN-001"]:
        in_content = needle in (content or "")
        in_ncont = needle in (ncont or "")
        print(f"   contains {needle!r:16} -> content: {in_content!s:5} | normalizedContent: {in_ncont}")
    # extrait autour de SPEC dans normalizedContent
    i = (ncont or "").find("SPEC")
    print("   extrait ncont autour de SPEC:", repr((ncont or "")[max(0,i-40):i+60]) if i >= 0 else "ABSENT")
    i2 = (ncont or "").find("900001")
    print("   extrait ncont autour de 900001:", repr((ncont or "")[max(0,i2-40):i2+60]) if i2 >= 0 else "ABSENT")

# Simulation recherche portail pour les 3 formes, sur TOUTE la base
print()
for q in ["900001", "SPEC-0001", "SPEC0001"]:
    cands = cur.execute("SELECT fileName, cin, content, normalizedContent FROM Payslip WHERE normalizedContent LIKE ?",
                        ("%"+q+"%",)).fetchall()
    matched = [fn for fn, cin, content, ncont in cands
               if normalize_text(cin or "") == normalize_text(q) or (q in (content or "")) or (q in normalize_text(content or ""))]
    print(f"RECHERCHE portail q={q!r}: pre-filtre={len(cands)} -> match exact={len(matched)}")
    for fn in matched[:6]:
        print("    *", fn)
con.close()
