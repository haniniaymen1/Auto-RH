# -*- coding: utf-8 -*-
"""Packaging 0.2.36 — base = ZIP 0.2.35 verbatim
+ package.json / package-lock.json (version 0.2.36 uniquement, 2 occurrences racines du lock)
+ auto-rh-readme-technique.pdf (REMPLACEMENT, édition v0.2.36 : résultats du test 240 000 fiches)
+ LIRE-MOI-README-TECHNIQUE.txt (REMPLACEMENT, note test de volume)
AUCUN autre changement : aucun fichier de code modifié (test de volume pur + documentation).
"""
import json
import os
import re
import zipfile

BASE = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.35.zip"
OUT = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.36.zip"
PUBLIC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
PRISTINE = "/home/z/my-project/task99_smtp/pristine"
PDF = "/home/z/my-project/download/auto-rh-readme-technique-v0.2.36.pdf"

REMPLACEMENTS = {
    "auto-rh-readme-technique.pdf": PDF,
}

LIRE_MOI_README = """============================================================================
 SERVICE RH - VERSION 0.2.36 - README TECHNIQUE (edition v0.2.36)
 TEST DE VOLUME 240 000 FICHES : RESULTATS MESURES
============================================================================

OBJET
-----
Cette livraison ne modifie AUCUN fichier de code. Elle documente dans le
README technique (edition v0.2.36, section 5, tableau 5.4) les resultats
de la campagne de volume menee a 240 000 fiches exactes sur la build
0.2.35 (harnais autonome, base dediee vierge, port 4310) :

  - insertion : 240 000 fiches chiffrees (AES-256-GCM, comme
    l'application) inserees en 1 min 3 s (environ 3 800 fiches/s),
    base 962,6 Mo ; CIN uniques 10000000 a 10239999 ;
  - indexation initiale de recherche : environ 15 min au total
    (210 a 320 fiches/s, lots de 100), sans arret de service,
    base 2,3 Go apres indexation ;
  - pagination HTTP authentifiee : comptage total 0,24-0,28 s
    (total = 240 000 exact et constant) ; page de 20 fiches :
    0,02 s (premiere), 0,22-0,27 s (offset 120 000), 0,42-0,73 s
    (offset 239 980) ; page de 100 fiches : 0,03 s (30 Ko) ;
    page de 1 000 (plafond API) : 0,42 s a froid / 0,15 s a chaud ;
  - recherche CIN exacte en fin de table (10239999) : 6,28 s au tout
    premier appel (cache disque a froid) puis 0,64 s ; milieu
    (10120000) 0,65 s ; CIN absent 0,63 s ; detail par id 0,01 s ;
  - memoire du serveur plate : 103 Mo au demarrage, 192 Mo apres
    tous les scenarios (325 Mo pendant l'indexation), aucune fuite ;
  - garde-fous reconfirmes : liste par defaut 100 fiches, plafond
    API 1 000, recherche refusee tant que plus de 20 000 fiches ne
    sont pas indexees, CIN de moins de 6 caracteres refuse.

Le harnais reutilisable est livre : scripts/test112_240k.js (phases
seed / indexation / mesures, re-entrantes). La base de test (2,3 Go)
a ete supprimee apres la campagne ; la base de production n'a jamais
ete utilisee.

INSTALLATION
------------
Identique aux versions precedentes : remplacer les fichiers de
l'application par ceux de cette archive (npm install, npx prisma
generate, npx prisma db push, npm run build, redemarrage). AUCUNE
migration, AUCUNE reindexation supplementaire.
============================================================================
"""


def bump_version(data: bytes, version: str) -> bytes:
    txt = data.decode("utf-8")
    pat = re.compile(r'"version":\s*"0\.2\.\d+"')
    if txt.lstrip().startswith("{") and '"lockfileVersion"' in txt:
        txt, n = pat.subn('"version": "%s"' % version, txt, count=2)
        assert n == 2, "package-lock: expected 2 root occurrences, got %d" % n
    else:
        txt, n = pat.subn('"version": "%s"' % version, txt, count=1)
        assert n == 1, "package.json: expected 1 version occurrence, got %d" % n
    json.loads(txt)  # validité JSON
    return txt.encode("utf-8")


def main():
    pdf_bytes = open(PDF, "rb").read()
    src = zipfile.ZipFile(BASE, "r")
    out = zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED)
    names = set()
    replaced, added = [], []
    for info in src.infolist():
        name = info.filename
        assert name not in names, "duplicate: %s" % name
        names.add(name)
        data = src.read(name)
        if name == "package.json":
            data = bump_version(data, "0.2.36")
            # le résultat doit être IDENTIQUE au fichier pristine bumpé
            assert data == open(PRISTINE + "/package.json", "rb").read(), "package.json ≠ pristine"
            replaced.append(name)
        elif name == "package-lock.json":
            data = bump_version(data, "0.2.36")
            assert data == open(PRISTINE + "/package-lock.json", "rb").read(), "lock ≠ pristine"
            replaced.append(name)
        elif name == "LIRE-MOI-README-TECHNIQUE.txt":
            data = LIRE_MOI_README.encode("utf-8"); replaced.append(name)
        elif name in REMPLACEMENTS:
            data = open(REMPLACEMENTS[name], "rb").read()
            replaced.append(name)
        ni = zipfile.ZipInfo(name, date_time=info.date_time)
        ni.compress_type = info.compress_type
        ni.external_attr = info.external_attr
        out.writestr(ni, data)
    out.close()
    src.close()

    # Vérifications
    z = zipfile.ZipFile(OUT)
    bad = z.testzip()
    assert bad is None, "CRC error: %s" % bad
    names = z.namelist()
    assert len(names) == len(set(names)), "duplicates!"
    forbidden = [n for n in names if n == ".env" or n.startswith(("db/", "node_modules/", ".next/", "storage/", "logs/", "backups/"))]
    assert not forbidden, "forbidden artifacts: %s" % forbidden
    ver = json.loads(z.read("package.json"))["version"]
    assert ver == "0.2.36", ver
    lock = json.loads(z.read("package-lock.json"))
    assert lock["version"] == "0.2.36", lock["version"]
    pdf_in = z.read("auto-rh-readme-technique.pdf")
    assert pdf_in[:5] == b"%PDF-" and pdf_in == pdf_bytes, "PDF mismatch"
    lmr = z.read("LIRE-MOI-README-TECHNIQUE.txt").decode("utf-8")
    assert "240 000 FICHES" in lmr and "0.2.36" in lmr and "test112_240k" in lmr
    # aucun fichier de code modifié : contrôle d'échantillon sur le code CIN
    cv = z.read("src/lib/cin-validation.ts").decode("utf-8")
    assert "classerCin" in cv and "resumeFiabilite" in cv, "cin-validation.ts inattendu"
    print("ENTREES:", len(names), "| REMPLACES:", replaced, "| AJOUTS:", added)
    print("OK", OUT, os.path.getsize(OUT), "octets")


if __name__ == "__main__":
    main()
