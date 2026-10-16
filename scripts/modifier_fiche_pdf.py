#!/usr/bin/env python3
# Task 164 — Démonstration « même si on change le CIN et les noms » :
# modification des valeurs par CHIRURGIE DIRECTE du flux de contenu PDF
# (les objets texte restent identiques, seules les valeurs changent).
# Méthode validée : chaînes littérales WinAnsi/Helvetica -> remplacement
# d'octets in situ, sans redaction ni réinsertion (qui casserait l'ordre
# du flux de contenu et donc les lignes reconstituées par pdf-parse).
import fitz, sys

SRC = "/home/z/my-project/tmp-testgen/corpus_20_employes.pdf"
OUT = "/home/z/my-project/tmp-testgen/fiche_valeurs_modifiees.pdf"
REMPLACEMENTS = [
    (b"(TMAR AZIZ)", b"(BEN ALI MEHDI)"),   # nom et prénom
    (b"(80012134)", b"(09765432)"),          # CIN
    (b"(294452)", b"(118866)"),              # matricule
]

doc = fitz.open(SRC)
xref = doc[0].get_contents()[0]
data = doc.xref_stream(xref)
print("Flux contenu page 1 :", len(data), "octets (xref", xref, ")")

for old, new in REMPLACEMENTS:
    n = data.count(old)
    print(f"  {old.decode():16s} x{n} -> {new.decode()}")
    if n != 1:
        print("ATTENTION : occurrence(s) != 1, chirurgie annulée")
        sys.exit(2)
    data = data.replace(old, new)

doc.update_stream(xref, data)
doc.select([0])  # ne conserver QUE la page modifiée (PDF 1 page)
doc.save(OUT)
print("PDF modifié :", OUT)

# Contrôles : nouveaux présents, anciens absents (flux + texte extrait)
doc2 = fitz.open(OUT)
flux = doc2.xref_stream(doc2[0].get_contents()[0])
txt = doc2[0].get_text()
ok = True
for old, new in REMPLACEMENTS:
    p, a = new in flux, old not in flux
    pt, at = new.strip(b"()").decode() in txt, old.strip(b"()").decode() not in txt
    ok &= p and a and pt and at
    print(f"  flux: {new.decode():16s} présent={p}  ancien absent={a} | texte: présent={pt} ancien absent={at}")
sys.exit(0 if ok else 3)
