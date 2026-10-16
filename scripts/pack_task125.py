# -*- coding: utf-8 -*-
"""Packaging 0.2.47 — base = ZIP 0.2.46 verbatim (MD5 d418834c…, 396 entrées)
+ package.json / package-lock.json REMPLACÉS PAR LES FICHIERS DU PROJET
  (version 0.2.47 — mêmes dépendances que 0.2.46)
+ auto-rh-readme-technique.pdf (REMPLACEMENT, édition v0.2.47 : tampon
  amélioré + diagnostic IMAP, 28 pages)
+ LIRE-MOI-README-TECHNIQUE.txt (REMPLACEMENT, note tampon/IMAP)
+ prisma/schema.prisma (REMPLACEMENT — SignatureConfig : qrImage + 4 décalages)
+ src/lib/stamp.ts (REMPLACEMENT — mode QR IMAGE, ratio, décalages bornés,
  aperçu sur fiche réelle)
+ src/app/api/signature-config/route.ts (REMPLACEMENT — mode IMAGE, qrImage,
  limite 4 Mo, aperçu X-Apercu-Fiche)
+ src/app/api/mail-config/route.ts (REMPLACEMENT — action test-imap :
  étapes + réponse serveur + indice actionnable)
+ src/components/payslip/signature-panel.tsx (REMPLACEMENT — import QR,
  curseurs de décalage, limites 4 Mo, aperçu fiche réelle)
+ src/components/payslip/mail-panel.tsx (REMPLACEMENT — bouton Tester la
  connexion IMAP)
+ scripts/portail-server.js (REMPLACEMENT — jumelle tampon IMAGE/décalages +
  journal IMAP enrichi)
+ 1 ajout : harnais E2E scripts/task125/test-tampon-imap.js (16 contrôles).
Migration : npx prisma db push (5 colonnes ajoutées, sans perte).
"""
import json
import os
import zipfile

BASE = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.46.zip"
OUT = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.47.zip"
PRISTINE = "/tmp/my-project/task99_smtp/pristine"
ROOT = "/home/z/my-project"
PDF = ROOT + "/download/auto-rh-readme-technique-v0.2.47.pdf"
LIRE_MOI = ROOT + "/scripts/task125/LIRE-MOI-README-TECHNIQUE.txt"
VERSION = "0.2.47"

REMPLACEMENTS = {
    "auto-rh-readme-technique.pdf": PDF,
    "package.json": ROOT + "/package.json",
    "package-lock.json": ROOT + "/package-lock.json",
    "prisma/schema.prisma": ROOT + "/prisma/schema.prisma",
    "src/lib/stamp.ts": ROOT + "/src/lib/stamp.ts",
    "src/lib/mailer.ts": ROOT + "/src/lib/mailer.ts",
    "src/app/api/signature-config/route.ts": ROOT + "/src/app/api/signature-config/route.ts",
    "src/app/api/mail-config/route.ts": ROOT + "/src/app/api/mail-config/route.ts",
    "src/components/payslip/signature-panel.tsx": ROOT + "/src/components/payslip/signature-panel.tsx",
    "src/components/payslip/mail-panel.tsx": ROOT + "/src/components/payslip/mail-panel.tsx",
    "scripts/portail-server.js": ROOT + "/scripts/portail-server.js",
}

AJOUTS = {
    "scripts/task125/test-tampon-imap.js": ROOT + "/scripts/task125/test-tampon-imap.js",
}

# Marqueurs attendus dans chaque fichier remplacé/ajouté (garde-fou contenu)
MARQUEURS = {
    "package.json": '"imapflow"',
    "package-lock.json": '"mailparser"',
    "prisma/schema.prisma": "qrImage",
    "src/lib/stamp.ts": 'cfg.qrMode === "IMAGE"',
    "src/lib/mailer.ts": '"test-imap"',
    "src/app/api/signature-config/route.ts": "X-Apercu-Fiche",
    "src/app/api/mail-config/route.ts": "test-imap",
    "src/components/payslip/signature-panel.tsx": "tampon-qr-image",
    "src/components/payslip/mail-panel.tsx": "Tester la connexion IMAP",
    "scripts/portail-server.js": "messageImapLisible",
    "scripts/task125/test-tampon-imap.js": "TOUT OK",
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
        ni = zipfile.ZipInfo(name, date_time=(2026, 9, 22, 2, 20, 0))
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
    assert "0.2.47" in lmr and "TAMPON" in lmr and "IMAP" in lmr
    # ---- 0.2.47 : schéma ----
    schema = z.read("prisma/schema.prisma").decode("utf-8")
    for marqueur in ["qrImage", "sigDecalX", "sigDecalY", "qrDecalX", "qrDecalY"]:
        assert marqueur in schema, "0.2.47 perdu (schema) : %s" % marqueur
    # ---- 0.2.47 : moteur tampon TS ----
    stamp = z.read("src/lib/stamp.ts").decode("utf-8")
    for marqueur in ['cfg.qrMode === "IMAGE"', "qrL", "qrH", "sigDecalX", "qrDecalY",
                     "Math.max(HAUT_MENTION, brut.y)", "pdfApercu", "reel"]:
        assert marqueur in stamp, "0.2.47 perdu (stamp.ts) : %s" % marqueur
    # ---- 0.2.47 : route signature-config ----
    sigcfg = z.read("src/app/api/signature-config/route.ts").decode("utf-8")
    for marqueur in ['"DONNEES", "URL", "TEXTE", "IMAGE"', "TAILLE_IMAGE_MAX = 5_500_000",
                     "4 Mo maximum", "X-Apercu-Fiche", "resolveStoredFile", "decryptFromStorage"]:
        assert marqueur in sigcfg, "0.2.47 perdu (signature-config) : %s" % marqueur
    # ---- 0.2.47 : route mail-config (test-imap) ----
    mailcfg = z.read("src/app/api/mail-config/route.ts").decode("utf-8")
    for marqueur in ['action === "test-imap"', "indiceImapLisible", "detailErreurImap",
                     "AUTHENTICATIONFAILED", "getMailboxLock", "IMAP_CONNEXION"]:
        assert marqueur in mailcfg, "0.2.47 perdu (mail-config) : %s" % marqueur
    # ---- 0.2.47 : interfaces ----
    sigpanel = z.read("src/components/payslip/signature-panel.tsx").decode("utf-8")
    for marqueur in ["tampon-qr-image", "choisirQrImage", "Image fournie (QR importé)",
                     "Décalage horizontal", "TAILLE_FICHIER_MAX = 4_000_000",
                     "Aperçu sur la dernière fiche importée", "X-Apercu-Fiche"]:
        assert marqueur in sigpanel, "0.2.47 perdu (signature-panel) : %s" % marqueur
    mailpanel = z.read("src/components/payslip/mail-panel.tsx").decode("utf-8")
    for marqueur in ["Tester la connexion IMAP", "testerImap", "test-imap", "testImapEtapes"]:
        assert marqueur in mailpanel, "0.2.47 perdu (mail-panel) : %s" % marqueur
    # ---- 0.2.47 : portail (jumelle + IMAP) ----
    portail = z.read("scripts/portail-server.js").decode("utf-8")
    for marqueur in ['cfg.qrMode === "IMAGE"', "messageImapLisible", "etape: etape",
                     "responseText", "coinVersBoiteTampon(cfg.qrPosition, W, H, qrL, qrH"]:
        assert marqueur in portail, "0.2.47 perdu (portail) : %s" % marqueur
    # ---- modules 0.2.39-0.2.46 du portail, intacts (verbatim) ----
    assert "LOGO_TRAILMIX_PNG" in portail, "logo Trailmix perdu"
    assert portail.count("nomEmployeDepuisFiches") >= 2, "jumelle JS nom 0.2.43 perdue"
    assert portail.count("indexOf(d.cinMasque)") == 2, "règle CIN unique 0.2.42 perdue"
    for marqueur in ['id="form-att-travail"', "emailDemandeSaisi", "E-mail employé",
                     "traiterMessageRecu", "verifierBoiteDemandes", "demarrerReceptionEmails",
                     "envoyerEmailDocumentDisponible", "/api/mes-demandes/documents/"]:
        assert marqueur in portail, "module antérieur perdu (portail) : %s" % marqueur
    # tampon TS : modules antérieurs intacts
    assert "autorh-signature-v1" in stamp, "empreinte 0.2.40 perdue"
    assert "tamponActif" in stamp, "tamponActif perdu"
    # mailer : règles 0.2.42 + IMAP 0.2.44 + type 0.2.47
    mailer = z.read("src/lib/mailer.ts").decode("utf-8")
    assert "employeAffiche" in mailer, "règle 0.2.42 mailer perdue"
    assert "hasImapPassword" in mailer, "IMAP 0.2.44 mailer perdu"
    # modules des livraisons précédentes, intacts
    for name, marqueur in INCHANGES_A_VERIFIER.items():
        assert marqueur.encode("utf-8") in z.read(name), "module antérieur altéré: %s" % name
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
