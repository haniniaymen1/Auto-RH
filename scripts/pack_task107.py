# -*- coding: utf-8 -*-
"""Packaging 0.2.34 — base = ZIP 0.2.33 verbatim
+ package.json / package-lock.json (version 0.2.34 uniquement)
+ auto-rh-readme-technique.pdf (édition v0.2.34, REMPLACEMENT)
+ LIRE-MOI-README-TECHNIQUE.txt (REMPLACEMENT, note section fiabilité)
Aucun autre changement : le code applicatif est STRICTEMENT celui de la 0.2.31.
"""
import json
import re
import zipfile

BASE = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.33.zip"
OUT = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.34.zip"
PUBLIC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
PDF = "/home/z/my-project/download/auto-rh-readme-technique-v0.2.34.pdf"
LIRE_MOI = """============================================================================
 SERVICE RH - VERSION 0.2.34 - README TECHNIQUE (edition v0.2.34)
============================================================================

OBJET
-----
Cette livraison N'APPORTE AUCUN changement de code par rapport a la 0.2.31.
Elle met a jour le document de reference :

    auto-rh-readme-technique.pdf   (EDITION SIMPLIFIEE v0.2.34, 21 septembre 2026)

NOUVEAUTES DE CETTE EDITION (demande : TAUX DE FIABILITE, TAUX D'ERREUR)
-----------------------------------------------------------------------
- Nouvelle sous-section 5.5 « Taux de fiabilite et taux d'erreur » :
  * fiabilite applicative MESUREE : 163 controles automatiques documentes
    sur les livraisons 0.2.27 a 0.2.31, tous PASS (tableau 5.4) ;
  * mesure des taux d'erreur en production : formules directes depuis
    ImportLog et logs/journal-emails.log, seuil d'alerte indicatif 2 % ;
  * integrite : aucune corruption silencieuse possible (AES-256-GCM,
    authentification de chaque champ et de chaque fichier) ;
  * fiabilite materielle estimee sur 20 ans : taux de defaillance annuels
    (SSD 0,5-1 %, HDD 1,5-2 %), risque cumule (10-18 % / 26-33 %) et
    parades RAID 1 + regle 3-2-1 (tableau 5.5) ; disponibilite cible
    superieure a 99,5 % ;
- Historique des versions complete (0.2.34) ;
- Aucun autre changement : le code est STRICTEMENT celui de la 0.2.31.

INSTALLATION
------------
Identique a la 0.2.31 : remplacer les fichiers de l'application par ceux
de cette archive (npm install, npx prisma generate, npx prisma db push,
npm run build, redemarrage). AUCUNE migration, AUCUNE reindexation.
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
            data = bump_version(data, "0.2.34"); replaced.append(name)
        elif name == "package-lock.json":
            data = bump_version(data, "0.2.34"); replaced.append(name)
        elif name == "auto-rh-readme-technique.pdf":
            data = pdf_bytes; replaced.append(name)  # REMPLACEMENT édition v0.2.34
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
    assert ver == "0.2.34", ver
    pdf_in = z.read("auto-rh-readme-technique.pdf")
    assert pdf_in[:5] == b"%PDF-", "PDF header"
    assert pdf_in == pdf_bytes, "PDF bytes mismatch"
    lm = z.read("LIRE-MOI-README-TECHNIQUE.txt").decode("utf-8")
    assert "FIABILITE" in lm and "0.2.34" in lm
    print("ENTREES:", len(names), "| REMPLACES:", replaced, "| AJOUTS:", added)
    print("OK", OUT)

if __name__ == "__main__":
    main()
