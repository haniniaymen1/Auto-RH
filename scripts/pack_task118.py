# -*- coding: utf-8 -*-
"""Packaging 0.2.40 — base = ZIP 0.2.39 verbatim
+ package.json / package-lock.json (version 0.2.40, 2 occurrences racines du lock)
+ auto-rh-readme-technique.pdf (REMPLACEMENT, édition v0.2.40 : signature & QR)
+ LIRE-MOI-README-TECHNIQUE.txt (REMPLACEMENT, note signature & QR)
+ 4 fichiers de code REMPLACÉS :
    prisma/schema.prisma (SignatureConfig), scripts/portail-server.js (jumelle),
    src/app/page.tsx (rubrique dans Importation),
    src/app/api/payslips/[id]/file/route.ts (tampon au servage)
+ 3 fichiers AJOUTÉS (module tampon) :
    src/lib/stamp.ts, src/app/api/signature-config/route.ts,
    src/components/payslip/signature-panel.tsx
+ 2 fichiers AJOUTÉS (harnais de validation) :
    scripts/task118/test-tampon.js, scripts/task118/decode_qr.py
"""
import json
import os
import re
import zipfile

BASE = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.39.zip"
OUT = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.40.zip"
PUBLIC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
PRISTINE = "/tmp/my-project/task99_smtp/pristine"
ROOT = "/home/z/my-project"
PDF = ROOT + "/download/auto-rh-readme-technique-v0.2.40.pdf"
LIRE_MOI = ROOT + "/scripts/task118/LIRE-MOI-README-TECHNIQUE.txt"

REMPLACEMENTS = {
    "auto-rh-readme-technique.pdf": PDF,
    "prisma/schema.prisma": ROOT + "/prisma/schema.prisma",
    "scripts/portail-server.js": ROOT + "/scripts/portail-server.js",
    "src/app/page.tsx": ROOT + "/src/app/page.tsx",
    "src/app/api/payslips/[id]/file/route.ts": ROOT + "/src/app/api/payslips/[id]/file/route.ts",
}

AJOUTS = {
    "src/lib/stamp.ts": ROOT + "/src/lib/stamp.ts",
    "src/app/api/signature-config/route.ts": ROOT + "/src/app/api/signature-config/route.ts",
    "src/components/payslip/signature-panel.tsx": ROOT + "/src/components/payslip/signature-panel.tsx",
    "scripts/task118/test-tampon.js": ROOT + "/scripts/task118/test-tampon.js",
    "scripts/task118/decode_qr.py": ROOT + "/scripts/task118/decode_qr.py",
}

# Marqueurs attendus dans chaque fichier remplacé/ajouté (garde-fou contenu)
MARQUEURS = {
    "prisma/schema.prisma": "model SignatureConfig",
    "scripts/portail-server.js": "tamponnerFicheTampon",
    "src/app/page.tsx": "SignaturePanel",
    "src/app/api/payslips/[id]/file/route.ts": "tamponnerFichePdf",
    "src/lib/stamp.ts": "empreinteFiche",
    "src/app/api/signature-config/route.ts": "signatureConfig",
    "src/components/payslip/signature-panel.tsx": "Signature électronique",
    "scripts/task118/test-tampon.js": "TOUS LES CONTRÔLES PASS",
    "scripts/task118/decode_qr.py": "pyzbar",
}

INCHANGES_A_VERIFIER = {
    # modules des livraisons précédentes, intacts
    "src/lib/demandes.ts": "TYPES_DEMANDE",
    "src/components/payslip/demandes-tab.tsx": "Demandes administratives",
    "src/app/api/demandes/journal/route.ts": "journal-emails.log",
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
            data = bump_version(data, "0.2.40")
            assert data == open(PRISTINE + "/package.json", "rb").read(), "package.json ≠ pristine"
            replaced.append(name)
        elif name == "package-lock.json":
            data = bump_version(data, "0.2.40")
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
    # Ajouts (module tampon signature/QR + harnais)
    for name, path in AJOUTS.items():
        assert name not in names, "déjà présent: %s" % name
        data = open(path, "rb").read()
        if name in MARQUEURS:
            assert MARQUEURS[name].encode("utf-8") in data, "marqueur absent: %s" % name
        ni = zipfile.ZipInfo(name, date_time=(2026, 9, 21, 20, 0, 0))
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
    assert ver == "0.2.40", ver
    lock = json.loads(z.read("package-lock.json"))
    assert lock["version"] == "0.2.40", lock["version"]
    pdf_in = z.read("auto-rh-readme-technique.pdf")
    assert pdf_in[:5] == b"%PDF-" and pdf_in == pdf_bytes, "PDF mismatch"
    lmr = z.read("LIRE-MOI-README-TECHNIQUE.txt").decode("utf-8")
    assert "SIGNATURE ELECTRONIQUE" in lmr and "0.2.40" in lmr
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
    # modules demandes (0.2.39) intacts
    for name, marqueur in INCHANGES_A_VERIFIER.items():
        assert marqueur.encode("utf-8") in z.read(name), "module antérieur altéré: %s" % name
    for name, path in AJOUTS.items():
        assert z.read(name) == open(path, "rb").read(), "ajout ≠ source: %s" % name
    print("ENTREES:", len(names), "| REMPLACES:", len(replaced), replaced, "| AJOUTS:", added)
    print("OK", OUT, os.path.getsize(OUT), "octets")


if __name__ == "__main__":
    main()
