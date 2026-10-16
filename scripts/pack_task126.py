# -*- coding: utf-8 -*-
"""Packaging 0.2.48 — base = ZIP 0.2.47 verbatim (MD5 8acb7d71…, 397 entrées)
+ package.json / package-lock.json REMPLACÉS PAR LES FICHIERS DU PROJET
  (version 0.2.48 — mêmes dépendances que 0.2.47)
+ auto-rh-readme-technique.pdf (REMPLACEMENT, édition v0.2.48 : tampon tous
  formats + limite 8 Mo, 28 pages)
+ LIRE-MOI-README-TECHNIQUE.txt (REMPLACEMENT, note formats/8 Mo)
+ src/lib/stamp.ts (REMPLACEMENT — moteurs image/docx/xlsx + répartiteur +
  aperçu étendu)
+ src/app/api/signature-config/route.ts (REMPLACEMENT — limites 8 Mo,
  aperçu PDF prioritaire puis fiche image)
+ src/app/api/payslips/[id]/file/route.ts (REMPLACEMENT — répartiteur par
  type de contenu)
+ src/components/payslip/signature-panel.tsx (REMPLACEMENT — limite client
  8 Mo)
+ next.config.ts (REMPLACEMENT — sharp + jszip externes)
+ scripts/portail-server.js (REMPLACEMENT — jumelle JS des moteurs
  image/docx/xlsx + répartiteur)
+ 1 ajout : harnais E2E scripts/task126/test-formats-tampon.js (19 contrôles).
Migration : AUCUNE (aucun changement de schéma) — redémarrage des services.
"""
import json
import os
import zipfile

BASE = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.47.zip"
OUT = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.48.zip"
PRISTINE = "/tmp/my-project/task99_smtp/pristine"
ROOT = "/home/z/my-project"
PDF = ROOT + "/download/auto-rh-readme-technique-v0.2.48.pdf"
LIRE_MOI = ROOT + "/scripts/task126/LIRE-MOI-README-TECHNIQUE.txt"
VERSION = "0.2.48"

REMPLACEMENTS = {
    "auto-rh-readme-technique.pdf": PDF,
    "package.json": ROOT + "/package.json",
    "package-lock.json": ROOT + "/package-lock.json",
    "src/lib/stamp.ts": ROOT + "/src/lib/stamp.ts",
    "src/app/api/signature-config/route.ts": ROOT + "/src/app/api/signature-config/route.ts",
    "src/app/api/payslips/[id]/file/route.ts": ROOT + "/src/app/api/payslips/[id]/file/route.ts",
    "src/components/payslip/signature-panel.tsx": ROOT + "/src/components/payslip/signature-panel.tsx",
    "next.config.ts": ROOT + "/next.config.ts",
    "scripts/portail-server.js": ROOT + "/scripts/portail-server.js",
}

AJOUTS = {
    "scripts/task126/test-formats-tampon.js": ROOT + "/scripts/task126/test-formats-tampon.js",
}

# Marqueurs attendus dans chaque fichier remplacé/ajouté (garde-fou contenu)
MARQUEURS = {
    "package.json": '"imapflow"',
    "package-lock.json": '"mailparser"',
    "src/lib/stamp.ts": "tamponnerFicheDossier",
    "src/app/api/signature-config/route.ts": "TAILLE_IMAGE_MAX = 11_000_000",
    "src/app/api/payslips/[id]/file/route.ts": "typeFichierTamporable",
    "src/components/payslip/signature-panel.tsx": "TAILLE_FICHIER_MAX = 8_000_000",
    "next.config.ts": '"sharp"',
    "scripts/portail-server.js": "tamponnerFicheDossierTampon",
    "scripts/task126/test-formats-tampon.js": "TOUT OK",
}

INCHANGES_A_VERIFIER = {
    # modules des livraisons précédentes, intacts
    "src/lib/demandes.ts": "nomEmployeDepuisFiches",
    "src/lib/cin-validation.ts": "classerCin",
    "src/lib/db-crypto.ts": "imapUser",
    "scripts/lib-crypto-bd.js": "imapUser",
    "src/app/api/demandes/route.ts": "tailleLisibleDocument",
    "src/app/page.tsx": "grid-cols-3 sm:grid-cols-6",
    "src/components/payslip/demandes-tab.tsx": "overflow-x-auto",
    "src/app/api/mail-config/route.ts": "test-imap",
    "src/components/payslip/mail-panel.tsx": "Tester la connexion IMAP",
    "prisma/schema.prisma": "qrImage",
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
    # Ajouts
    for name, path in AJOUTS.items():
        assert name not in names, "déjà présent: %s" % name
        data = open(path, "rb").read()
        if name in MARQUEURS:
            assert MARQUEURS[name].encode("utf-8") in data, "marqueur absent: %s" % name
        ni = zipfile.ZipInfo(name, date_time=(2026, 9, 22, 3, 30, 0))
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
    assert "0.2.48" in lmr and "TAMPS" not in "___" and "FORMATS" in lmr and "8 MO" in lmr
    # ---- 0.2.47 : modules conservés ----
    schema = z.read("prisma/schema.prisma").decode("utf-8")
    for marqueur in ["qrImage", "sigDecalX", "sigDecalY", "qrDecalX", "qrDecalY"]:
        assert marqueur in schema, "0.2.47 perdu (schema) : %s" % marqueur
    # ---- 0.2.48 : moteur tampon TS ----
    stamp = z.read("src/lib/stamp.ts").decode("utf-8")
    for marqueur in ['cfg.qrMode === "IMAGE"', "tamponnerFicheImage", "tamponnerFicheDocx",
                     "tamponnerFicheXlsx", "tamponnerFicheDossier", "apercuTampon",
                     "typeFichierTamporable", 'relativeFrom="page"', "<oneCellAnchor>",
                     "ECHELLE_SURFACE = 3", "autorh-signature-v1", "tamponActif",
                     "Math.max(HAUT_MENTION, brut.y)"]:
        assert marqueur in stamp, "0.2.48 perdu (stamp.ts) : %s" % marqueur
    # ---- 0.2.48 : routes ----
    sigcfg = z.read("src/app/api/signature-config/route.ts").decode("utf-8")
    for marqueur in ["TAILLE_IMAGE_MAX = 11_000_000", "8 Mo maximum", "apercuTampon",
                     "type: \"image\"", "X-Apercu-Fiche", "validerStructureImage",
                     '"DONNEES", "URL", "TEXTE", "IMAGE"']:
        assert marqueur in sigcfg, "0.2.48 perdu (signature-config) : %s" % marqueur
    fileroute = z.read("src/app/api/payslips/[id]/file/route.ts").decode("utf-8")
    for marqueur in ["typeFichierTamporable", "tamponnerFicheDossier", "validerStructureImage", "decryptFromStorage"]:
        assert marqueur in fileroute, "0.2.48 perdu (file route) : %s" % marqueur
    panel = z.read("src/components/payslip/signature-panel.tsx").decode("utf-8")
    for marqueur in ["TAILLE_FICHIER_MAX = 8_000_000", "8 Mo", "tampon-qr-image",
                     "Aperçu sur la dernière fiche importée", "X-Apercu-Fiche"]:
        assert marqueur in panel, "0.2.48 perdu (signature-panel) : %s" % marqueur
    nxt = z.read("next.config.ts").decode("utf-8")
    for marqueur in ['"sharp"', '"jszip"', "proxyClientMaxBodySize"]:
        assert marqueur in nxt, "0.2.48 perdu (next.config) : %s" % marqueur
    # ---- 0.2.48 : portail (jumelles + répartiteur) ----
    portail = z.read("scripts/portail-server.js").decode("utf-8")
    for marqueur in ["tamponnerFicheImageTampon", "tamponnerFicheDocxTampon", "tamponnerFicheXlsxTampon",
                     "tamponnerFicheDossierTampon", "typeFichierTamporableTampon", "preparerSurfacesTampon",
                     'relativeFrom="page"', "<oneCellAnchor>", "messageImapLisible",
                     'cfg.qrMode === "IMAGE"']:
        assert marqueur in portail, "0.2.48 perdu (portail) : %s" % marqueur
    # ---- modules 0.2.39-0.2.47 du portail, intacts ----
    assert "LOGO_TRAILMIX_PNG" in portail, "logo Trailmix perdu"
    assert portail.count("nomEmployeDepuisFiches") >= 2, "jumelle JS nom 0.2.43 perdue"
    assert portail.count("indexOf(d.cinMasque)") == 2, "règle CIN unique 0.2.42 perdue"
    for marqueur in ['id="form-att-travail"', "emailDemandeSaisi", "E-mail employé",
                     "traiterMessageRecu", "verifierBoiteDemandes", "demarrerReceptionEmails",
                     "envoyerEmailDocumentDisponible", "/api/mes-demandes/documents/"]:
        assert marqueur in portail, "module antérieur perdu (portail) : %s" % marqueur
    # tampon PDF historique intact dans les deux jumelles
    assert "tamponnerFichePdf" in stamp, "moteur PDF perdu (TS)"
    assert "async function tamponnerFicheTampon(" in portail, "moteur PDF perdu (JS)"
    # ---- modules des livraisons précédentes, intacts ----
    for name, marqueur in INCHANGES_A_VERIFIER.items():
        assert marqueur.encode("utf-8") in z.read(name), "module antérieur altéré: %s" % name
    # mailer : règles 0.2.42 + IMAP 0.2.44
    mailer = z.read("src/lib/mailer.ts").decode("utf-8")
    assert "employeAffiche" in mailer, "règle 0.2.42 mailer perdue"
    assert "hasImapPassword" in mailer, "IMAP 0.2.44 mailer perdu"
    # égalité binaire des fichiers remplacés/ajoutés avec leurs sources
    for name, path in REMPLACEMENTS.items():
        if name != "auto-rh-readme-technique.pdf":
            assert z.read(name) == open(path, "rb").read(), "remplacé ≠ source: %s" % name
    for name, path in AJOUTS.items():
        assert z.read(name) == open(path, "rb").read(), "ajout ≠ source: %s" % name
    print("ENTREES:", len(names), "| REMPLACES:", len(replaced), replaced, "| AJOUTS:", added)
    print("OK", OUT, os.path.getsize(OUT), "octets")


if __name__ == "__main__":
    main()
