# -*- coding: utf-8 -*-
"""Packaging 0.2.33 — base = ZIP 0.2.32 verbatim
+ package.json / package-lock.json (version 0.2.33 uniquement)
+ auto-rh-readme-technique.pdf (ÉDITION SIMPLIFIÉE v0.2.33, REMPLACEMENT)
+ LIRE-MOI-README-TECHNIQUE.txt (REMPLACEMENT, note édition simplifiée)
Aucun autre changement : le code est STRICTEMENT celui de la 0.2.31.
"""
import io
import json
import re
import zipfile

BASE = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.32.zip"
OUT = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.33.zip"
PUBLIC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
PDF = "/home/z/my-project/download/auto-rh-readme-technique-v0.2.33.pdf"
LIRE_MOI = """============================================================================
 SERVICE RH - VERSION 0.2.33 - README TECHNIQUE SIMPLIFIE (edition v0.2.33)
============================================================================

OBJET
-----
Cette livraison N'APPORTE AUCUN changement de code par rapport a la 0.2.31.
Elle remplace dans l'archive le document de reference :

    auto-rh-readme-technique.pdf   (EDITION SIMPLIFIEE v0.2.33, 21 septembre 2026)

NOUVEAUTES DE CETTE EDITION (demande : simplifier le contenu et supprimer
les sections inutiles)
--------------------------------------------------------------------
- De 10 a 8 sections et de 32 a 16 pages : le document est resserre sur
  l'essentiel operationnel (architecture, fonctionnalites, installation,
  securite, capacite 240 000 fiches / 20 ans, exploitation, depannage,
  historique) ;
- Sections supprimees : « Tests et validation » (inventaire exhaustif des
  campagnes) et « Methodologie et sources » - les informations vitales
  (harnais disponibles, tests restant a executer) sont conservees en
  quelques lignes dans la section 6 et en recommandation R1 ;
- Tableaux allegees : depannage ramene aux incidents les plus frequents,
  recommandations condensees, historique en 3 colonnes ;
- Aucune information essentielle n'a ete perdue : ports 4000/4001,
  pagination serveur et recherche CIN indexee (v0.2.27), compteur portail
  (0.2.28), gros fichiers 500 Mo et decoupage des copies (0.2.29),
  securite SMTP deduite du port (0.2.30), decoupage des specimens
  (0.2.31), mesures a 240 250 fiches, dimensionnement materiel et
  analyse de capacite sur 20 ans.

INSTALLATION
------------
Identique a la 0.2.31 : remplacer les fichiers de l'application par ceux
de cette archive (npm install, npx prisma generate, npx prisma db push,
npm run build, redemarrage). AUCUNE migration, AUCUNE reindexation
supplementaire par rapport a la 0.2.31.
============================================================================
"""

def bump_version(data: bytes, version: str) -> bytes:
    txt = data.decode("utf-8")
    pat = re.compile(r'"version":\s*"0\.2\.\d+"')
    if txt.lstrip().startswith("{") and '"lockfileVersion"' in txt:
        # lock : les DEUX PREMIERES occurrences sont racines (lignes 3 et 9),
        # toutes les suivantes (ligne 744+) sont des dépendances — intouchées.
        txt, n = pat.subn('"version": "%s"' % version, txt, count=2)
        assert n == 2, "package-lock: expected 2 root occurrences, got %d" % n
    else:
        txt, n = pat.subn('"version": "%s"' % version, txt, count=1)
        assert n == 1, "package.json: expected 1 version occurrence, got %d" % n
    json.loads(txt)  # validité JSON
    return txt.encode("utf-8")

def main():
    src = zipfile.ZipFile(BASE, "r")
    out = zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED)
    names = set()
    replaced, added = [], []
    pdf_bytes = open(PDF, "rb").read()
    for info in src.infolist():
        name = info.filename
        assert name not in names, "duplicate: %s" % name
        names.add(name)
        data = src.read(name)
        if name == "package.json":
            data = bump_version(data, "0.2.33"); replaced.append(name)
        elif name == "package-lock.json":
            data = bump_version(data, "0.2.33"); replaced.append(name)
        elif name == "auto-rh-readme-technique.pdf":
            data = pdf_bytes; replaced.append(name)  # REMPLACEMENT par l'édition simplifiée
        elif name == "LIRE-MOI-README-TECHNIQUE.txt":
            data = LIRE_MOI.encode("utf-8"); replaced.append(name)
        ni = zipfile.ZipInfo(name, date_time=info.date_time)
        ni.compress_type = info.compress_type
        ni.external_attr = info.external_attr
        out.writestr(ni, data)
    out.close(); src.close()

    # Vérifications
    z = zipfile.ZipFile(OUT)
    bad = z.testzip()
    assert bad is None, "CRC error: %s" % bad
    names = z.namelist()
    assert len(names) == len(set(names)), "duplicates!"
    forbidden = [n for n in names if n == ".env" or n.startswith(("db/", "node_modules/", ".next/", "storage/", "logs/", "backups/"))]
    assert not forbidden, "forbidden artifacts: %s" % forbidden
    ver = json.loads(z.read("package.json"))["version"]
    assert ver == "0.2.33", ver
    pdf_in = z.read("auto-rh-readme-technique.pdf")
    assert pdf_in[:5] == b"%PDF-", "PDF header"
    assert pdf_in == pdf_bytes, "PDF bytes mismatch"
    lm = z.read("LIRE-MOI-README-TECHNIQUE.txt").decode("utf-8")
    assert "SIMPLIFIE" in lm and "0.2.33" in lm
    print("ENTREES:", len(names), "| REMPLACES:", replaced, "| AJOUTS:", added)
    print("OK", OUT)

if __name__ == "__main__":
    main()
