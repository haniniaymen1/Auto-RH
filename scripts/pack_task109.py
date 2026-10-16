# -*- coding: utf-8 -*-
"""Packaging 0.2.35 — base = ZIP 0.2.34 verbatim
+ package.json / package-lock.json (version 0.2.35 uniquement, 2 occurrences racines du lock)
+ src/lib/cin-validation.ts (AJOUT — vérification d'authenticité des CIN)
+ src/lib/types.ts, src/app/api/payslips/upload/route.ts,
  src/components/payslip/import-tab.tsx (REMPLACEMENTS — Task 109)
+ LIRE-MOI-CORRECTIF-FIABILITE-CIN.txt (AJOUT)
+ auto-rh-readme-technique.pdf (REMPLACEMENT, édition v0.2.35)
+ LIRE-MOI-README-TECHNIQUE.txt (REMPLACEMENT, note fiabilité CIN)
"""
import json
import os
import re
import zipfile

BASE = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.34.zip"
OUT = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.35.zip"
PUBLIC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
PRISTINE = "/home/z/my-project/task99_smtp/pristine"
PDF = "/home/z/my-project/download/auto-rh-readme-technique-v0.2.35.pdf"

REMPLACEMENTS = {
    "src/lib/types.ts": PRISTINE + "/src/lib/types.ts",
    "src/app/api/payslips/upload/route.ts": PRISTINE + "/src/app/api/payslips/upload/route.ts",
    "src/components/payslip/import-tab.tsx": PRISTINE + "/src/components/payslip/import-tab.tsx",
    "auto-rh-readme-technique.pdf": PDF,
}
AJOUTS = {
    "src/lib/cin-validation.ts": PRISTINE + "/src/lib/cin-validation.ts",
    "LIRE-MOI-CORRECTIF-FIABILITE-CIN.txt": PRISTINE + "/LIRE-MOI-CORRECTIF-FIABILITE-CIN.txt",
}

LIRE_MOI_README = """============================================================================
 SERVICE RH - VERSION 0.2.35 - README TECHNIQUE (edition v0.2.35)
 TAUX DE FIABILITE ET TAUX D'ERREUR DES CIN APRES IMPORT
============================================================================

OBJET
-----
Cette livraison ajoute la verification d'authenticite des CIN apres
l'importation, avec calcul automatique des deux taux demandes :

    taux de fiabilite = CIN vrais  / fiches importees
    taux d'erreur     = CIN faux   / fiches importees

La sous-section 5.5 du README technique (edition v0.2.35) decrit la
classification (vrai / faux / non detecte), les formules, les emplacements
d'affichage (panneau d'import, badges vert/rouge, ImportLog, API) et la
portee de la verification (authenticite de FORMAT). L'historique 8.1
comporte desormais la ligne 0.2.35.

INSTALLATION
------------
Identique aux versions precedentes : remplacer les fichiers de l'application
par ceux de cette archive (npm install, npx prisma generate, npx prisma db
push, npm run build, redemarrage). AUCUNE migration, AUCUNE reindexation ;
la verification s'applique des le prochain import.
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
            data = bump_version(data, "0.2.35")
            # le résultat doit être IDENTIQUE au fichier pristine testé
            assert data == open(PRISTINE + "/package.json", "rb").read(), "package.json ≠ pristine"
            replaced.append(name)
        elif name == "package-lock.json":
            data = bump_version(data, "0.2.35")
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
    for name, path in AJOUTS.items():
        assert name not in names, "déjà présent: %s" % name
        names.add(name)
        ni = zipfile.ZipInfo(name, date_time=(2026, 9, 21, 7, 0, 0))
        ni.compress_type = zipfile.ZIP_DEFLATED
        ni.external_attr = 0o644 << 16
        out.writestr(ni, open(path, "rb").read())
        added.append(name)
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
    assert ver == "0.2.35", ver
    cv = z.read("src/lib/cin-validation.ts").decode("utf-8")
    assert "classerCin" in cv and "resumeFiabilite" in cv and "Task 109" in cv, "cin-validation.ts incomplet"
    rt = z.read("src/app/api/payslips/upload/route.ts").decode("utf-8")
    assert "resumeFiabilite" in rt and "ligneFiabilite" in rt, "route sans fiabilité"
    it = z.read("src/components/payslip/import-tab.tsx").decode("utf-8")
    assert "FiabilitePanel" in it and "classerCin" in it, "UI sans panneau fiabilité"
    pdf_in = z.read("auto-rh-readme-technique.pdf")
    assert pdf_in[:5] == b"%PDF-" and pdf_in == pdf_bytes, "PDF mismatch"
    lm = z.read("LIRE-MOI-CORRECTIF-FIABILITE-CIN.txt").decode("utf-8")
    assert "FIABILIT" in lm.upper() and "0.2.35" in lm
    lmr = z.read("LIRE-MOI-README-TECHNIQUE.txt").decode("utf-8")
    assert "FIABILITE" in lmr and "0.2.35" in lmr
    print("ENTREES:", len(names), "| REMPLACES:", replaced, "| AJOUTS:", added)
    print("OK", OUT)


if __name__ == "__main__":
    main()
