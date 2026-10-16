# -*- coding: utf-8 -*-
"""Packaging 0.2.43 — base = ZIP 0.2.42 verbatim
+ package.json / package-lock.json (version 0.2.43, 2 occurrences racines du lock)
+ auto-rh-readme-technique.pdf (REMPLACEMENT, édition v0.2.43 : nom employé)
+ LIRE-MOI-README-TECHNIQUE.txt (REMPLACEMENT, note nom et prénom)
+ 3 fichiers de code REMPLACÉS :
    src/lib/demandes.ts (nomEmployeDepuisFiches, jumelle TS),
    src/app/api/demandes/[id]/route.ts (notification de statut : nom résolu),
    scripts/portail-server.js (création : nom résolu + jumelle JS)
+ 2 fichiers AJOUTÉS (harnais campagne 0.2.43) :
    scripts/task121/test-nom-emails.js, scripts/task121/puits-complet.js
"""
import json
import os
import re
import zipfile

BASE = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.42.zip"
OUT = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.43.zip"
PRISTINE = "/tmp/my-project/task99_smtp/pristine"
ROOT = "/home/z/my-project"
PDF = ROOT + "/download/auto-rh-readme-technique-v0.2.43.pdf"
LIRE_MOI = ROOT + "/scripts/task121/LIRE-MOI-README-TECHNIQUE.txt"

REMPLACEMENTS = {
    "auto-rh-readme-technique.pdf": PDF,
    "src/lib/demandes.ts": ROOT + "/src/lib/demandes.ts",
    "src/app/api/demandes/[id]/route.ts": ROOT + "/src/app/api/demandes/[id]/route.ts",
    "scripts/portail-server.js": ROOT + "/scripts/portail-server.js",
}

AJOUTS = {
    "scripts/task121/test-nom-emails.js": ROOT + "/scripts/task121/test-nom-emails.js",
    "scripts/task121/puits-complet.js": ROOT + "/scripts/task121/puits-complet.js",
}

# Marqueurs attendus dans chaque fichier remplacé/ajouté (garde-fou contenu)
MARQUEURS = {
    "src/lib/demandes.ts": "nomEmployeDepuisFiches",
    "src/app/api/demandes/[id]/route.ts": "nomEmployeDepuisFiches",
    "scripts/portail-server.js": "MODIFIÉ v0.2.43",
    "scripts/task121/test-nom-emails.js": "TOUS LES CONTRÔLES SONT PASSÉS",
    "scripts/task121/puits-complet.js": "dés-emballage du point",
}

INCHANGES_A_VERIFIER = {
    # modules des livraisons précédentes, intacts
    "src/lib/stamp.ts": "autorh-signature-v1",
    "src/app/api/signature-config/route.ts": 'session.role !== "RH"',
    "src/app/page.tsx": "SignaturePanel",
    "src/lib/mailer.ts": "employeAffiche",
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
            data = bump_version(data, "0.2.43")
            assert data == open(PRISTINE + "/package.json", "rb").read(), "package.json ≠ pristine"
            replaced.append(name)
        elif name == "package-lock.json":
            data = bump_version(data, "0.2.43")
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
    # Ajouts (harnais campagne 0.2.43)
    for name, path in AJOUTS.items():
        assert name not in names, "déjà présent: %s" % name
        data = open(path, "rb").read()
        if name in MARQUEURS:
            assert MARQUEURS[name].encode("utf-8") in data, "marqueur absent: %s" % name
        ni = zipfile.ZipInfo(name, date_time=(2026, 9, 21, 22, 30, 0))
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
    assert ver == "0.2.43", ver
    lock = json.loads(z.read("package-lock.json"))
    assert lock["version"] == "0.2.43", lock["version"]
    pdf_in = z.read("auto-rh-readme-technique.pdf")
    assert pdf_in[:5] == b"%PDF-" and pdf_in == pdf_bytes, "PDF mismatch"
    lmr = z.read("LIRE-MOI-README-TECHNIQUE.txt").decode("utf-8")
    assert "0.2.43" in lmr and "NOM ET PRÉNOM" in lmr and "puits" in lmr
    demandes = z.read("src/lib/demandes.ts").decode("utf-8")
    assert "nomEmployeDepuisFiches" in demandes and "pairesInfosDemande" in demandes
    route = z.read("src/app/api/demandes/[id]/route.ts").decode("utf-8")
    assert "nomEmployeDepuisFiches" in route and "envoyerEmailDemandeStatut" in route
    portail = z.read("scripts/portail-server.js").decode("utf-8")
    assert "LOGO_TRAILMIX_PNG" in portail, "logo Trailmix perdu"
    assert "tamponnerFicheTampon" in portail, "tampon 0.2.40 perdu"
    assert portail.count("nomEmployeDepuisFiches") >= 2, "jumelle JS nom absente"
    assert portail.count("indexOf(d.cinMasque)") == 2, "règle CIN unique 0.2.42 perdue"
    mailer = z.read("src/lib/mailer.ts").decode("utf-8")
    assert "employeAffiche" in mailer, "règle 0.2.42 mailer perdue"
    schema = z.read("prisma/schema.prisma").decode("utf-8")
    assert "model SignatureConfig" in schema and "model DemandeAdministrative" in schema
    assert "cinIndex" in schema and "model PayslipCinToken" in schema
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
