# -*- coding: utf-8 -*-
"""Packaging 0.2.44 — base = ZIP 0.2.43 verbatim
+ package.json / package-lock.json REMPLACÉS PAR LES FICHIERS DU PROJET
  (version 0.2.44 + NOUVELLES DÉPENDANCES imapflow & mailparser — le bump
  de version seul ne suffit plus, la lock intègre 2 nouveaux paquets)
+ auto-rh-readme-technique.pdf (REMPLACEMENT, édition v0.2.44 : réception)
+ LIRE-MOI-README-TECHNIQUE.txt (REMPLACEMENT, note réception documents RH)
+ 12 fichiers de code REMPLACÉS :
    prisma/schema.prisma (MailConfig IMAP + messageIdEnvoi + DocumentDemande),
    scripts/lib-crypto-bd.js + src/lib/db-crypto.ts (carte MailConfig imap*),
    src/lib/mailer.ts (ConfigMailLue IMAP),
    src/lib/storage-dir.ts (documents-demandes : dossier/candidats/resolve),
    src/app/api/mail-config/route.ts (champs IMAP GET/PUT),
    src/components/payslip/mail-panel.tsx (rubrique IMAP),
    src/components/payslip/demandes-tab.tsx (badge + bloc documents),
    src/app/api/demandes/route.ts + [id]/route.ts (documents),
    src/app/api/demandes/[id]/documents/[docId]/route.ts (AJOUT),
    scripts/portail-server.js (moteur de réception + servage + UI portail)
+ 5 fichiers AJOUTÉS (harnais campagne 0.2.44) :
    scripts/task122/test-reception-documents.js, serveur-imap-factice.js,
    puits-complet.js, test-harnais-imap.js, demarre-sandbox-qa.js
"""
import json
import os
import re
import zipfile

BASE = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.43.zip"
OUT = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.44.zip"
PRISTINE = "/tmp/my-project/task99_smtp/pristine"
ROOT = "/home/z/my-project"
PDF = ROOT + "/download/auto-rh-readme-technique-v0.2.44.pdf"
LIRE_MOI = ROOT + "/scripts/task122/LIRE-MOI-README-TECHNIQUE.txt"
VERSION = "0.2.44"

REMPLACEMENTS = {
    "auto-rh-readme-technique.pdf": PDF,
    # NOUVEAU Task 122 : les fichiers de dépendances viennent DU PROJET
    # (nouvelles deps imapflow + mailparser dans package.json ET la lock)
    "package.json": ROOT + "/package.json",
    "package-lock.json": ROOT + "/package-lock.json",
    "prisma/schema.prisma": ROOT + "/prisma/schema.prisma",
    "scripts/lib-crypto-bd.js": ROOT + "/scripts/lib-crypto-bd.js",
    "src/lib/db-crypto.ts": ROOT + "/src/lib/db-crypto.ts",
    "src/lib/mailer.ts": ROOT + "/src/lib/mailer.ts",
    "src/lib/storage-dir.ts": ROOT + "/src/lib/storage-dir.ts",
    "src/app/api/mail-config/route.ts": ROOT + "/src/app/api/mail-config/route.ts",
    "src/components/payslip/mail-panel.tsx": ROOT + "/src/components/payslip/mail-panel.tsx",
    "src/components/payslip/demandes-tab.tsx": ROOT + "/src/components/payslip/demandes-tab.tsx",
    "src/app/api/demandes/route.ts": ROOT + "/src/app/api/demandes/route.ts",
    "src/app/api/demandes/[id]/route.ts": ROOT + "/src/app/api/demandes/[id]/route.ts",
    "scripts/portail-server.js": ROOT + "/scripts/portail-server.js",
}

AJOUTS = {
    "src/app/api/demandes/[id]/documents/[docId]/route.ts":
        ROOT + "/src/app/api/demandes/[id]/documents/[docId]/route.ts",
    "scripts/task122/test-reception-documents.js": ROOT + "/scripts/task122/test-reception-documents.js",
    "scripts/task122/serveur-imap-factice.js": ROOT + "/scripts/task122/serveur-imap-factice.js",
    "scripts/task122/puits-complet.js": ROOT + "/scripts/task122/puits-complet.js",
    "scripts/task122/test-harnais-imap.js": ROOT + "/scripts/task122/test-harnais-imap.js",
    "scripts/task122/demarre-sandbox-qa.js": ROOT + "/scripts/task122/demarre-sandbox-qa.js",
}

# Marqueurs attendus dans chaque fichier remplacé/ajouté (garde-fou contenu)
MARQUEURS = {
    "package.json": '"imapflow"',
    "package-lock.json": '"mailparser"',
    "prisma/schema.prisma": "model DocumentDemande",
    "scripts/lib-crypto-bd.js": "imapUser",
    "src/lib/db-crypto.ts": "imapUser",
    "src/lib/mailer.ts": "hasImapPassword",
    "src/lib/storage-dir.ts": "resolveStoredDocument",
    "src/app/api/mail-config/route.ts": "imapActif",
    "src/components/payslip/mail-panel.tsx": "mail-imap-host",
    "src/components/payslip/demandes-tab.tsx": "tailleLisible",
    "src/app/api/demandes/route.ts": "tailleLisibleDocument",
    "src/app/api/demandes/[id]/route.ts": "documents:",
    "src/app/api/demandes/[id]/documents/[docId]/route.ts": "resolveStoredDocument",
    "scripts/portail-server.js": "traiterMessageRecu",
    "scripts/task122/test-reception-documents.js": "TOUS LES CONTRÔLES SONT PASSÉS",
    "scripts/task122/serveur-imap-factice.js": "UID STORE",
    "scripts/task122/puits-complet.js": "dés-emballage du point",
    "scripts/task122/test-harnais-imap.js": "TEST HARNAIS TERMINE",
    "scripts/task122/demarre-sandbox-qa.js": "SANDBOX QA 122 PRÊTE",
}

INCHANGES_A_VERIFIER = {
    # modules des livraisons précédentes, intacts
    "src/lib/stamp.ts": "autorh-signature-v1",
    "src/app/api/signature-config/route.ts": 'session.role !== "RH"',
    "src/app/page.tsx": "SignaturePanel",
    "src/lib/demandes.ts": "nomEmployeDepuisFiches",
    "src/lib/cin-validation.ts": "classerCin",
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
    # Ajouts (route documents + harnais campagne 0.2.44)
    for name, path in AJOUTS.items():
        assert name not in names, "déjà présent: %s" % name
        data = open(path, "rb").read()
        if name in MARQUEURS:
            assert MARQUEURS[name].encode("utf-8") in data, "marqueur absent: %s" % name
        ni = zipfile.ZipInfo(name, date_time=(2026, 9, 21, 22, 45, 0))
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
    # versions + dépendances
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
    assert "0.2.44" in lmr and "RÉCEPTION AUTOMATIQUE" in lmr and "ImapFlow" in lmr
    # schéma : nouveaux éléments Task 122 + anciens intacts
    schema = z.read("prisma/schema.prisma").decode("utf-8")
    assert "model DocumentDemande" in schema and "messageIdEnvoi" in schema and "imapActif" in schema
    assert "model SignatureConfig" in schema and "model DemandeAdministrative" in schema
    assert "cinIndex" in schema and "model PayslipCinToken" in schema
    # portail : moteur Task 122 + modules antérieurs
    portail = z.read("scripts/portail-server.js").decode("utf-8")
    assert "LOGO_TRAILMIX_PNG" in portail, "logo Trailmix perdu"
    assert "tamponnerFicheTampon" in portail, "tampon 0.2.40 perdu"
    assert portail.count("nomEmployeDepuisFiches") >= 2, "jumelle JS nom 0.2.43 perdue"
    assert portail.count("indexOf(d.cinMasque)") == 2, "règle CIN unique 0.2.42 perdue"
    for marqueur in ["traiterMessageRecu", "verifierBoiteDemandes", "demarrerReceptionEmails",
                     "envoyerEmailDocumentDisponible", "encryptForStorage", "trouverDocumentStocke",
                     "/api/mes-demandes/documents/", "messageIdEnvoi", "demande-document"]:
        assert marqueur in portail, "moteur 0.2.44 incomplet (portail) : %s" % marqueur
    # mailer : règles 0.2.42 + IMAP 0.2.44
    mailer = z.read("src/lib/mailer.ts").decode("utf-8")
    assert "employeAffiche" in mailer, "règle 0.2.42 mailer perdue"
    assert "hasImapPassword" in mailer and "imapActif" in mailer
    # demandes.ts 0.2.43 intact
    dem = z.read("src/lib/demandes.ts").decode("utf-8")
    assert "nomEmployeDepuisFiches" in dem and "pairesInfosDemande" in dem
    # nouvelle route admin + UI
    docroute = z.read("src/app/api/demandes/[id]/documents/[docId]/route.ts").decode("utf-8")
    assert "resolveStoredDocument" in docroute and "decryptFromStorage" in docroute
    dtab = z.read("src/components/payslip/demandes-tab.tsx").decode("utf-8")
    assert "tailleLisible" in dtab and "Télécharger" in dtab
    panel = z.read("src/components/payslip/mail-panel.tsx").decode("utf-8")
    assert "mail-imap-host" in panel and "Switch" in panel
    mc = z.read("src/app/api/mail-config/route.ts").decode("utf-8")
    assert "imapPassword" in mc and "imapActif" in mc
    # cryptos jumelles alignées
    assert "imapUser" in z.read("src/lib/db-crypto.ts").decode("utf-8")
    assert "imapUser" in z.read("scripts/lib-crypto-bd.js").decode("utf-8")
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
