# -*- coding: utf-8 -*-
"""Packaging 0.2.37 — base = ZIP 0.2.36 verbatim
+ package.json / package-lock.json (version 0.2.37 uniquement, 2 occurrences racines du lock)
+ auto-rh-readme-technique.pdf (REMPLACEMENT, édition v0.2.37 : Figure 1 corrigée — diagramme de séquence)
+ LIRE-MOI-README-TECHNIQUE.txt (REMPLACEMENT, note correction figure)
AUCUN autre changement : aucun fichier de code modifié.
"""
import json
import os
import re
import zipfile

BASE = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.36.zip"
OUT = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.37.zip"
PUBLIC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
PRISTINE = "/home/z/my-project/task99_smtp/pristine"
PDF = "/home/z/my-project/download/auto-rh-readme-technique-v0.2.37.pdf"

REMPLACEMENTS = {
    "auto-rh-readme-technique.pdf": PDF,
}

LIRE_MOI_README = """============================================================================
 SERVICE RH - VERSION 0.2.37 - README TECHNIQUE (edition v0.2.37)
 FIGURE 1 CORRIGEE : DIAGRAMME DE SEQUENCE COMPLET
============================================================================

OBJET
-----
Cette livraison ne modifie AUCUN fichier de code. Elle corrige la Figure 1
du README technique (section 2) : le diagramme de la connexion au portail
(4001) ne comportait pas les lignes attendues. L'edition v0.2.37 le
remplace par un vrai diagramme de sequence :

  - lignes de vie verticales en pointilles sous les 4 participants
    (Employe, Portail 4001, Base SQLite, Stockage) ;
  - 8 fleches horizontales orientees entre participants, une par
    message, avec le libelle au-dessus de chaque fleche ;
  - les deux reponses (HTTP 423 apres 5 echecs, service du PDF)
    representees par des fleches en pointilles, retour a l'employe ;
  - messages numerotes de 1 a 8, meme contenu qu'avant (CIN + mot de
    passe, lecture du compte, OTP TOTP RFC 6238, session signee,
    demande de fiche avec reverification du CIN, dechiffrement
    AES-256-GCM en-tete PAIESAGE1).

L'edition v0.2.37 conserve integralement les resultats du test de volume
240 000 fiches ajoutes en 0.2.36 (section 5, tableau 5.4).

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
            data = bump_version(data, "0.2.37")
            assert data == open(PRISTINE + "/package.json", "rb").read(), "package.json ≠ pristine"
            replaced.append(name)
        elif name == "package-lock.json":
            data = bump_version(data, "0.2.37")
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
    assert ver == "0.2.37", ver
    lock = json.loads(z.read("package-lock.json"))
    assert lock["version"] == "0.2.37", lock["version"]
    pdf_in = z.read("auto-rh-readme-technique.pdf")
    assert pdf_in[:5] == b"%PDF-" and pdf_in == pdf_bytes, "PDF mismatch"
    lmr = z.read("LIRE-MOI-README-TECHNIQUE.txt").decode("utf-8")
    assert "DIAGRAMME DE SEQUENCE" in lmr and "0.2.37" in lmr
    cv = z.read("src/lib/cin-validation.ts").decode("utf-8")
    assert "classerCin" in cv and "resumeFiabilite" in cv, "cin-validation.ts inattendu"
    print("ENTREES:", len(names), "| REMPLACES:", replaced, "| AJOUTS:", added)
    print("OK", OUT, os.path.getsize(OUT), "octets")


if __name__ == "__main__":
    main()
