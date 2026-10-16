# -*- coding: utf-8 -*-
"""Packaging 0.2.39 — base = ZIP 0.2.38 verbatim
+ package.json / package-lock.json (version 0.2.39, 2 occurrences racines du lock)
+ auto-rh-readme-technique.pdf (REMPLACEMENT, édition v0.2.39 : demandes administratives)
+ LIRE-MOI-README-TECHNIQUE.txt (REMPLACEMENT, note demandes administratives)
+ 7 fichiers de code REMPLACÉS :
    prisma/schema.prisma, scripts/portail-server.js, src/app/page.tsx,
    src/app/api/mail-config/route.ts, src/components/payslip/mail-panel.tsx,
    src/lib/db-crypto.ts, src/lib/mailer.ts
+ 5 fichiers AJOUTÉS (module demandes) :
    src/lib/demandes.ts, src/app/api/demandes/route.ts,
    src/app/api/demandes/[id]/route.ts, src/app/api/demandes/journal/route.ts,
    src/components/payslip/demandes-tab.tsx
"""
import json
import os
import re
import zipfile

BASE = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.38.zip"
OUT = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.39.zip"
PUBLIC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
PRISTINE = "/tmp/my-project/task99_smtp/pristine"
ROOT = "/home/z/my-project"
PDF = ROOT + "/download/auto-rh-readme-technique-v0.2.39.pdf"
LIRE_MOI = ROOT + "/scripts/task116/LIRE-MOI-README-TECHNIQUE.txt"

REMPLACEMENTS = {
    "auto-rh-readme-technique.pdf": PDF,
    "prisma/schema.prisma": ROOT + "/prisma/schema.prisma",
    "scripts/portail-server.js": ROOT + "/scripts/portail-server.js",
    "src/app/page.tsx": ROOT + "/src/app/page.tsx",
    "src/app/api/mail-config/route.ts": ROOT + "/src/app/api/mail-config/route.ts",
    "src/components/payslip/mail-panel.tsx": ROOT + "/src/components/payslip/mail-panel.tsx",
    "src/lib/db-crypto.ts": ROOT + "/src/lib/db-crypto.ts",
    "src/lib/mailer.ts": ROOT + "/src/lib/mailer.ts",
}

AJOUTS = {
    "src/lib/demandes.ts": ROOT + "/src/lib/demandes.ts",
    "src/app/api/demandes/route.ts": ROOT + "/src/app/api/demandes/route.ts",
    "src/app/api/demandes/[id]/route.ts": ROOT + "/src/app/api/demandes/[id]/route.ts",
    "src/app/api/demandes/journal/route.ts": ROOT + "/src/app/api/demandes/journal/route.ts",
    "src/components/payslip/demandes-tab.tsx": ROOT + "/src/components/payslip/demandes-tab.tsx",
}

# Marqueurs attendus dans chaque fichier remplacé/ajouté (garde-fou contenu)
MARQUEURS = {
    "prisma/schema.prisma": "model DemandeAdministrative",
    "scripts/portail-server.js": "DEMANDES_HTML",
    "src/app/page.tsx": "DemandesTab",
    "src/app/api/mail-config/route.ts": "responsablesMap",
    "src/components/payslip/mail-panel.tsx": "rhEmail",
    "src/lib/db-crypto.ts": "DemandeAdministrative",
    "src/lib/mailer.ts": "envoyerEmailDemandeStatut",
    "src/lib/demandes.ts": "TYPES_DEMANDE",
    "src/app/api/demandes/route.ts": "demandeAdministrative",
    "src/app/api/demandes/[id]/route.ts": "STATUTS_TRAITABLES",
    "src/app/api/demandes/journal/route.ts": "journal-emails.log",
    "src/components/payslip/demandes-tab.tsx": "Demandes administratives",
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
            data = bump_version(data, "0.2.39")
            assert data == open(PRISTINE + "/package.json", "rb").read(), "package.json ≠ pristine"
            replaced.append(name)
        elif name == "package-lock.json":
            data = bump_version(data, "0.2.39")
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
    # Ajouts (module demandes administratives)
    for name, path in AJOUTS.items():
        assert name not in names, "déjà présent: %s" % name
        data = open(path, "rb").read()
        if name in MARQUEURS:
            assert MARQUEURS[name].encode("utf-8") in data, "marqueur absent: %s" % name
        ni = zipfile.ZipInfo(name, date_time=(2026, 9, 21, 18, 0, 0))
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
    assert ver == "0.2.39", ver
    lock = json.loads(z.read("package-lock.json"))
    assert lock["version"] == "0.2.39", lock["version"]
    pdf_in = z.read("auto-rh-readme-technique.pdf")
    assert pdf_in[:5] == b"%PDF-" and pdf_in == pdf_bytes, "PDF mismatch"
    lmr = z.read("LIRE-MOI-README-TECHNIQUE.txt").decode("utf-8")
    assert "DEMANDES ADMINISTRATIVES" in lmr and "0.2.39" in lmr
    cv = z.read("src/lib/cin-validation.ts").decode("utf-8")
    assert "classerCin" in cv and "resumeFiabilite" in cv, "cin-validation.ts inattendu"
    portail = z.read("scripts/portail-server.js").decode("utf-8")
    assert "LOGO_TRAILMIX_PNG" in portail, "logo Trailmix perdu"
    assert portail.encode("utf-8") == open(ROOT + "/scripts/portail-server.js", "rb").read(), "portail ≠ source"
    schema = z.read("prisma/schema.prisma").decode("utf-8")
    assert "model DemandeAdministrative" in schema and "PortalAccess" in schema
    for name, path in AJOUTS.items():
        assert z.read(name) == open(path, "rb").read(), "ajout ≠ source: %s" % name
    print("ENTREES:", len(names), "| REMPLACES:", len(replaced), replaced, "| AJOUTS:", added)
    print("OK", OUT, os.path.getsize(OUT), "octets")


if __name__ == "__main__":
    main()
