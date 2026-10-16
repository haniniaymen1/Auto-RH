# -*- coding: utf-8 -*-
"""Packaging 0.2.45 — base = ZIP 0.2.44 verbatim
+ package.json / package-lock.json REMPLACÉS PAR LES FICHIERS DU PROJET
  (version 0.2.45 — mêmes dépendances que 0.2.44)
+ auto-rh-readme-technique.pdf (REMPLACEMENT, édition v0.2.45 : responsive)
+ LIRE-MOI-README-TECHNIQUE.txt (REMPLACEMENT, note responsive mobile)
+ 2 fichiers de code REMPLACÉS (100 % présentation, aucune API) :
    src/app/page.tsx (barre d'onglets 3×2 sur mobile + en-tête resserré),
    src/components/payslip/demandes-tab.tsx (tableaux à défilement
    horizontal sur écran étroit — liste + journal d'envoi)
AUCUN ajout, AUCUNE migration de base : la mise à jour est 100 %
présentation. Le portail employé (déjà responsive) est inchangé.
"""
import json
import os
import zipfile

BASE = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.44.zip"
OUT = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.45.zip"
PRISTINE = "/tmp/my-project/task99_smtp/pristine"
ROOT = "/home/z/my-project"
PDF = ROOT + "/download/auto-rh-readme-technique-v0.2.45.pdf"
LIRE_MOI = ROOT + "/scripts/task123/LIRE-MOI-README-TECHNIQUE.txt"
VERSION = "0.2.45"

REMPLACEMENTS = {
    "auto-rh-readme-technique.pdf": PDF,
    "package.json": ROOT + "/package.json",
    "package-lock.json": ROOT + "/package-lock.json",
    "src/app/page.tsx": ROOT + "/src/app/page.tsx",
    "src/components/payslip/demandes-tab.tsx": ROOT + "/src/components/payslip/demandes-tab.tsx",
}

AJOUTS = {}

# Marqueurs attendus dans chaque fichier remplacé (garde-fou contenu)
MARQUEURS = {
    "package.json": '"imapflow"',
    "package-lock.json": '"mailparser"',
    "src/app/page.tsx": "grid-cols-3 sm:grid-cols-6",
    "src/components/payslip/demandes-tab.tsx": "overflow-x-auto",
}

INCHANGES_A_VERIFIER = {
    # modules des livraisons précédentes, intacts
    "src/lib/stamp.ts": "autorh-signature-v1",
    "src/app/api/signature-config/route.ts": 'session.role !== "RH"',
    "src/lib/demandes.ts": "nomEmployeDepuisFiches",
    "src/lib/cin-validation.ts": "classerCin",
    "src/lib/mailer.ts": "hasImapPassword",
    "src/lib/db-crypto.ts": "imapUser",
    "scripts/lib-crypto-bd.js": "imapUser",
    "src/app/api/mail-config/route.ts": "imapActif",
    "src/components/payslip/mail-panel.tsx": "mail-imap-host",
    "src/app/api/demandes/route.ts": "tailleLisibleDocument",
    "scripts/portail-server.js": "traiterMessageRecu",
}


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
        if name == "LIRE-MOI-README-TECHNIQUE.txt":
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
    # Ajouts (aucun en 0.2.45 — mise à jour 100 % présentation)
    for name, path in AJOUTS.items():
        assert name not in names, "déjà présent: %s" % name
        data = open(path, "rb").read()
        if name in MARQUEURS:
            assert MARQUEURS[name].encode("utf-8") in data, "marqueur absent: %s" % name
        ni = zipfile.ZipInfo(name, date_time=(2026, 9, 21, 23, 5, 0))
        ni.compress_type = zipfile.ZIP_DEFLATED
        ni.external_attr = 0o644 << 16
        out.writestr(ni, data)
        added.append(name)
    out.close()
    src.close()

    # ---------------------- Vérifications ----------------------
    z = zipfile.ZipFile(OUT)
    bad = z.testzip()
    assert bad is None, "CRC error: %s" % bad
    names = z.namelist()
    assert len(names) == len(set(names)), "duplicates!"
    forbidden = [n for n in names if n == ".env" or n.startswith(("db/", "node_modules/", ".next/", "storage/", "logs/", "backups/"))]
    assert not forbidden, "forbidden artifacts: %s" % forbidden
    # versions + dépendances 0.2.44 toujours présentes
    pkg = json.loads(z.read("package.json"))
    assert pkg["version"] == VERSION, pkg["version"]
    assert "imapflow" in pkg["dependencies"] and "mailparser" in pkg["dependencies"], "deps absentes du package.json"
    lock = json.loads(z.read("package-lock.json"))
    assert lock["version"] == VERSION, lock["version"]
    assert "node_modules/imapflow" in lock["packages"] and "node_modules/mailparser" in lock["packages"], "deps absentes de la lock"
    # égalité avec le miroir pristine (package files)
    assert z.read("package.json") == open(PRISTINE + "/package.json", "rb").read(), "package.json ≠ pristine"
    assert z.read("package-lock.json") == open(PRISTINE + "/package-lock.json", "rb").read(), "lock ≠ pristine"
    # PDF + LIRE-MOI
    pdf_in = z.read("auto-rh-readme-technique.pdf")
    assert pdf_in[:5] == b"%PDF-" and pdf_in == pdf_bytes, "PDF mismatch"
    lmr = z.read("LIRE-MOI-README-TECHNIQUE.txt").decode("utf-8")
    assert "0.2.45" in lmr and "RESPONSIVE" in lmr and "3×2" in lmr
    # responsive : page.tsx (onglets 3×2 mobile + desktop intact) — Task 123
    page = z.read("src/app/page.tsx").decode("utf-8")
    assert "grid-cols-3 sm:grid-cols-6" in page, "grille mobile IT absente"
    assert "grid-cols-3 sm:grid-cols-5" in page, "grille mobile RH absente"
    assert "h-auto sm:h-11" in page, "hauteur auto mobile absente"
    assert "text-[11px] sm:text-sm" in page, "libellés onglets mobile absents"
    assert "max-w-[96px] sm:max-w-[140px]" in page, "en-tête resserré absent"
    assert "h-8 sm:h-10" in page, "logo responsive absent"
    assert "SignaturePanel" in page and 'value="demandes"' in page and 'value="users"' in page, "onglets antérieurs perdus"
    # demandes-tab : overflow 0.2.45 + documents 0.2.44 intacts
    dtab = z.read("src/components/payslip/demandes-tab.tsx").decode("utf-8")
    assert dtab.count('className="rounded-md border overflow-x-auto"') == 2, "overflow demandes/journal incomplet : %d" % dtab.count('className="rounded-md border overflow-x-auto"')
    assert "tailleLisible" in dtab and "Télécharger" in dtab, "documents 0.2.44 perdus"
    # portail : moteur 0.2.44 + modules antérieurs intacts (verbatim)
    portail = z.read("scripts/portail-server.js").decode("utf-8")
    assert "LOGO_TRAILMIX_PNG" in portail, "logo Trailmix perdu"
    assert "tamponnerFicheTampon" in portail, "tampon 0.2.40 perdu"
    assert portail.count("nomEmployeDepuisFiches") >= 2, "jumelle JS nom 0.2.43 perdue"
    assert portail.count("indexOf(d.cinMasque)") == 2, "règle CIN unique 0.2.42 perdue"
    for marqueur in ["traiterMessageRecu", "verifierBoiteDemandes", "demarrerReceptionEmails",
                     "envoyerEmailDocumentDisponible", "/api/mes-demandes/documents/"]:
        assert marqueur in portail, "moteur 0.2.44 perdu (portail) : %s" % marqueur
    # mailer : règles 0.2.42 + IMAP 0.2.44
    mailer = z.read("src/lib/mailer.ts").decode("utf-8")
    assert "employeAffiche" in mailer, "règle 0.2.42 mailer perdue"
    # demandes.ts 0.2.43 intact
    dem = z.read("src/lib/demandes.ts").decode("utf-8")
    assert "nomEmployeDepuisFiches" in dem and "pairesInfosDemande" in dem
    # modules des livraisons précédentes, intacts
    for name, marqueur in INCHANGES_A_VERIFIER.items():
        assert marqueur.encode("utf-8") in z.read(name), "module antérieur altéré: %s" % name
    # égalité binaire des fichiers remplacés avec leurs sources
    for name, path in REMPLACEMENTS.items():
        if name != "auto-rh-readme-technique.pdf":
            assert z.read(name) == open(path, "rb").read(), "remplacé ≠ source: %s" % name
    for name, path in AJOUTS.items():
        assert z.read(name) == open(path, "rb").read(), "ajout ≠ source: %s" % name
    print("ENTREES:", len(names), "| REMPLACES:", len(replaced), replaced, "| AJOUTS:", added)
    print("OK", OUT, os.path.getsize(OUT), "octets")


if __name__ == "__main__":
    main()
