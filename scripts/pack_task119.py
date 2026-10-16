# -*- coding: utf-8 -*-
"""Packaging 0.2.41 — base = ZIP 0.2.40 verbatim
+ package.json / package-lock.json (version 0.2.41, 2 occurrences racines du lock)
+ auto-rh-readme-technique.pdf (REMPLACEMENT, édition v0.2.41 : accès RH)
+ LIRE-MOI-README-TECHNIQUE.txt (REMPLACEMENT, note accès RH)
+ 3 fichiers de code REMPLACÉS :
    src/app/page.tsx (SignaturePanel rendu pour RH/IT/SUPERADMIN),
    src/app/api/signature-config/route.ts (accès RH GET/PUT/POST),
    src/components/payslip/signature-panel.tsx (commentaire d'accès)
+ 2 fichiers AJOUTÉS (harnais de validation) :
    scripts/task119/test-rh-acces.js, scripts/task119/demarre-sandbox-qa.js
"""
import json
import os
import re
import zipfile

BASE = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.40.zip"
OUT = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.41.zip"
PUBLIC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
PRISTINE = "/tmp/my-project/task99_smtp/pristine"
ROOT = "/home/z/my-project"
PDF = ROOT + "/download/auto-rh-readme-technique-v0.2.41.pdf"
LIRE_MOI = ROOT + "/scripts/task119/LIRE-MOI-README-TECHNIQUE.txt"

REMPLACEMENTS = {
    "auto-rh-readme-technique.pdf": PDF,
    "src/app/page.tsx": ROOT + "/src/app/page.tsx",
    "src/app/api/signature-config/route.ts": ROOT + "/src/app/api/signature-config/route.ts",
    "src/components/payslip/signature-panel.tsx": ROOT + "/src/components/payslip/signature-panel.tsx",
}

AJOUTS = {
    "scripts/task119/test-rh-acces.js": ROOT + "/scripts/task119/test-rh-acces.js",
    "scripts/task119/demarre-sandbox-qa.js": ROOT + "/scripts/task119/demarre-sandbox-qa.js",
}

# Marqueurs attendus dans chaque fichier remplacé/ajouté (garde-fou contenu)
MARQUEURS = {
    "src/app/page.tsx": '|| me?.role === "RH") && (',
    "src/app/api/signature-config/route.ts": 'session.role !== "IT" && session.role !== "RH"',
    "src/components/payslip/signature-panel.tsx": "MODIFIÉ v0.2.41",
    "scripts/task119/test-rh-acces.js": "TOUS LES SCÉNARIOS PASSent",
    "scripts/task119/demarre-sandbox-qa.js": "rh-test119@entreprise.tn",
}

INCHANGES_A_VERIFIER = {
    # modules des livraisons précédentes, intacts
    "src/lib/stamp.ts": "autorh-signature-v1",
    "src/app/api/payslips/[id]/file/route.ts": "tamponnerFichePdf",
    "scripts/portail-server.js": "tamponnerFicheTampon",
    "src/lib/demandes.ts": "TYPES_DEMANDE",
    "src/components/payslip/demandes-tab.tsx": "Demandes administratives",
    "src/lib/cin-validation.ts": "classerCin",
}


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
    lire_moi_bytes = open(LIRE_MOI, "rb").read()
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
            data = bump_version(data, "0.2.41")
            assert data == open(PRISTINE + "/package.json", "rb").read(), "package.json ≠ pristine"
            replaced.append(name)
        elif name == "package-lock.json":
            data = bump_version(data, "0.2.41")
            assert data == open(PRISTINE + "/package-lock.json", "rb").read(), "lock ≠ pristine"
            replaced.append(name)
        elif name == "LIRE-MOI-README-TECHNIQUE.txt":
            data = lire_moi_bytes; replaced.append(name)
        elif name in REMPLACEMENTS:
            data = open(REMPLACEMENTS[name], "rb").read()
            if name in MARQUEURS:
                assert MARQUEURS[name].encode("utf-8") in data, "marqueur absent: %s" % name
            replaced.append(name)
        ni = zipfile.ZipInfo(name, date_time=info.date_time)
        ni.compress_type = info.compress_type
        ni.external_attr = info.external_attr
        out.writestr(ni, data)
    # Ajouts (harnais de validation Task 119)
    for name, path in AJOUTS.items():
        assert name not in names, "déjà présent: %s" % name
        data = open(path, "rb").read()
        if name in MARQUEURS:
            assert MARQUEURS[name].encode("utf-8") in data, "marqueur absent: %s" % name
        ni = zipfile.ZipInfo(name, date_time=(2026, 9, 21, 21, 0, 0))
        ni.compress_type = zipfile.ZIP_DEFLATED
        ni.external_attr = 0o644 << 16
        out.writestr(ni, data)
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
    assert ver == "0.2.41", ver
    lock = json.loads(z.read("package-lock.json"))
    assert lock["version"] == "0.2.41", lock["version"]
    pdf_in = z.read("auto-rh-readme-technique.pdf")
    assert pdf_in[:5] == b"%PDF-" and pdf_in == pdf_bytes, "PDF mismatch"
    lmr = z.read("LIRE-MOI-README-TECHNIQUE.txt").decode("utf-8")
    assert "0.2.41" in lmr and "RH" in lmr and "scripts/task119/test-rh-acces.js" in lmr
    page = z.read("src/app/page.tsx").decode("utf-8")
    assert '|| me?.role === "RH") && (' in page and "SignaturePanel" in page
    route = z.read("src/app/api/signature-config/route.ts").decode("utf-8")
    assert route.count('session.role !== "RH"') == 3, "route : %d occurrences RH" % route.count('session.role !== "RH"')
    schema = z.read("prisma/schema.prisma").decode("utf-8")
    assert "model SignatureConfig" in schema and "model DemandeAdministrative" in schema
    portail = z.read("scripts/portail-server.js").decode("utf-8")
    assert "LOGO_TRAILMIX_PNG" in portail, "logo Trailmix perdu"
    assert "tamponnerFicheTampon" in portail and "empreinteFicheTampon" in portail
    assert portail.encode("utf-8") == open(ROOT + "/scripts/portail-server.js", "rb").read(), "portail ≠ source"
    stamp = z.read("src/lib/stamp.ts").decode("utf-8")
    assert "autorh-signature-v1" in stamp, "sel empreinte absent"
    cv = z.read("src/lib/cin-validation.ts").decode("utf-8")
    assert "classerCin" in cv and "resumeFiabilite" in cv, "cin-validation.ts inattendu"
    # modules des livraisons précédentes, intacts
    for name, marqueur in INCHANGES_A_VERIFIER.items():
        assert marqueur.encode("utf-8") in z.read(name), "module antérieur altéré: %s" % name
    for name, path in REMPLACEMENTS.items():
        if name != "auto-rh-readme-technique.pdf":
            assert z.read(name) == open(path, "rb").read(), "remplacé ≠ source: %s" % name
    for name, path in AJOUTS.items():
        assert z.read(name) == open(path, "rb").read(), "ajout ≠ source: %s" % name
    print("ENTREES:", len(names), "| REMPLACES:", len(replaced), replaced, "| AJOUTS:", added)
    print("OK", OUT, os.path.getsize(OUT), "octets")


if __name__ == "__main__":
    main()
