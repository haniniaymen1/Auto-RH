# -*- coding: utf-8 -*-
"""Packaging 0.2.32 — base = ZIP 0.2.31 verbatim
+ package.json / package-lock.json (version 0.2.32 uniquement)
+ auto-rh-readme-technique.pdf (édition v0.2.31, AJOUT)
+ LIRE-MOI-README-TECHNIQUE.txt (AJOUT)
Aucun autre changement : le code est STRICTEMENT celui de la 0.2.31.
"""
import io
import json
import re
import zipfile

BASE = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.31.zip"
OUT = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.32.zip"
PUBLIC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
PDF = "/home/z/my-project/download/auto-rh-readme-technique-v0.2.31.pdf"
LIRE_MOI = """============================================================================
 SERVICE RH - VERSION 0.2.32 - README TECHNIQUE MIS A JOUR (edition v0.2.31)
============================================================================

OBJET
-----
Cette livraison N'APPORTE AUCUN changement de code par rapport a la 0.2.31.
Elle ajoute uniquement a l'archive le document :

    auto-rh-readme-technique.pdf   (edition v0.2.31, 21 septembre 2026)

Le README technique est le document de reference du projet : architecture
(ports 4000/4001), fonctionnalites, installation, securite, tests, capacite
(240 000 fiches sur 20 ans, dimensionnement materiel, recommandations),
exploitation, depannage et historique complet des livraisons (section 10).

NOUVEAUTES DE CETTE EDITION (par rapport a l'edition v0.2.26)
-------------------------------------------------------------
- Pagination serveur (100 fiches/page) et recherche CIN cote serveur sur
  TOUTES les fiches via l'index deterministe chiffre (v0.2.27) ;
- Performances MESUREES a 240 250 fiches (page ~30 ms, recherche profonde
  ~50 ms apres indexation, indexation initiale en quelques minutes) ;
- Recommandations materielles (Recommended Requirements) actualisees et
  analyse de capacite sur 20 ans (stockage, serveur, evolutivite) ;
- Compteur du portail exact (v0.2.28), gros fichiers 500 Mo et decoupage
  des copies (v0.2.29), securite SMTP deduite du port (v0.2.30),
  decoupage des specimens a CIN unique (v0.2.31), visionneuse (v0.2.26) ;
- Nouvelle section 10 : historique des livraisons, tenu a jour a chaque
  version (recommandation R21) - le document est MAINTENU a jour au fil
  des livraisons et ne conserve aucune information obsolète.

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
            data = bump_version(data, "0.2.32"); replaced.append(name)
        elif name == "package-lock.json":
            data = bump_version(data, "0.2.32"); replaced.append(name)
        ni = zipfile.ZipInfo(name, date_time=info.date_time)
        ni.compress_type = info.compress_type
        ni.external_attr = info.external_attr
        out.writestr(ni, data)
    # AJOUT : README technique (nom stable, mis à jour à chaque livraison)
    assert "auto-rh-readme-technique.pdf" not in names
    ni = zipfile.ZipInfo("auto-rh-readme-technique.pdf", date_time=(2026, 9, 21, 0, 0, 0))
    ni.compress_type = zipfile.ZIP_DEFLATED
    ni.external_attr = 0o644 << 16
    out.writestr(ni, pdf_bytes); added.append("auto-rh-readme-technique.pdf")
    ni = zipfile.ZipInfo("LIRE-MOI-README-TECHNIQUE.txt", date_time=(2026, 9, 21, 0, 0, 0))
    ni.compress_type = zipfile.ZIP_DEFLATED
    ni.external_attr = 0o644 << 16
    out.writestr(ni, LIRE_MOI.encode("utf-8")); added.append("LIRE-MOI-README-TECHNIQUE.txt")
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
    assert ver == "0.2.32", ver
    assert z.read("auto-rh-readme-technique.pdf")[:5] == b"%PDF-", "PDF header"
    print("ENTREES:", len(names), "| REMPLACES:", replaced, "| AJOUTS:", added)
    print("OK", OUT)

if __name__ == "__main__":
    main()
