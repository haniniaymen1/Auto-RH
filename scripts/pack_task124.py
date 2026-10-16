# -*- coding: utf-8 -*-
"""Packaging 0.2.46 — base = ZIP 0.2.45 verbatim
+ package.json / package-lock.json REMPLACÉS PAR LES FICHIERS DU PROJET
  (version 0.2.46 — mêmes dépendances que 0.2.45)
+ auto-rh-readme-technique.pdf (REMPLACEMENT, édition v0.2.46 :
  e-mail de l'employé dans les attestations)
+ LIRE-MOI-README-TECHNIQUE.txt (REMPLACEMENT, note e-mail attestations)
+ scripts/portail-server.js (REMPLACEMENT — SEUL code modifié) :
    mini-formulaires d'attestation avec adresse e-mail OBLIGATOIRE
    (pré-remplie si le compte en a une), validation serveur 400,
    ligne « E-mail employé » dans l'e-mail RH (texte + HTML),
    enrichissement best effort du compte portail sans adresse.
+ 1 ajout : harnais E2E scripts/task124/test-email-attestation.js
  (24 contrôles — puits SMTP à capture intégrale).
AUCUNE migration de base : l'adresse réutilise la colonne employeEmail
déjà chiffrée. Réponse du RH / détection IMAP 0.2.44 inchangées.
"""
import json
import os
import zipfile

BASE = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.45.zip"
OUT = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.46.zip"
PRISTINE = "/tmp/my-project/task99_smtp/pristine"
ROOT = "/home/z/my-project"
PDF = ROOT + "/download/auto-rh-readme-technique-v0.2.46.pdf"
LIRE_MOI = ROOT + "/scripts/task124/LIRE-MOI-README-TECHNIQUE.txt"
VERSION = "0.2.46"

REMPLACEMENTS = {
    "auto-rh-readme-technique.pdf": PDF,
    "package.json": ROOT + "/package.json",
    "package-lock.json": ROOT + "/package-lock.json",
    "scripts/portail-server.js": ROOT + "/scripts/portail-server.js",
}

AJOUTS = {
    "scripts/task124/test-email-attestation.js": ROOT + "/scripts/task124/test-email-attestation.js",
}

# Marqueurs attendus dans chaque fichier remplacé/ajouté (garde-fou contenu)
MARQUEURS = {
    "package.json": '"imapflow"',
    "package-lock.json": '"mailparser"',
    "scripts/portail-server.js": 'id="form-att-travail"',
    "scripts/task124/test-email-attestation.js": "E-mail employé",
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
        ni = zipfile.ZipInfo(name, date_time=(2026, 9, 22, 1, 10, 0))
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
    assert "0.2.46" in lmr and "E-MAIL" in lmr and "ATTESTATION" in lmr
    # ---- 0.2.46 : le portail contient la nouvelle fonctionnalité ----
    portail = z.read("scripts/portail-server.js").decode("utf-8")
    for marqueur in ['id="form-att-travail"', 'id="form-att-salaire"',
                     'id="att-travail-email"', 'id="att-salaire-email"',
                     "emailDemandeSaisi", "emailNotification",
                     "Votre adresse e-mail est obligatoire (valide)",
                     "E-mail employé"]:
        assert marqueur in portail, "0.2.46 perdu (portail) : %s" % marqueur
    assert portail.count("E-mail employé") >= 4, "lignes e-mail employé incomplètes : %d" % portail.count("E-mail employé")
    # ligne texte alignée (colonne du deux-points identique aux autres)
    assert "  E-mail employé             : \" + d.emailEmploye" in portail, "ligne texte désalignée"
    # ligne HTML via ligne("E-mail employé", …)
    assert 'ligne("E-mail employé", d.emailEmploye)' in portail, "ligne HTML absente"
    # enrichissement best effort du compte
    assert "prisma.portalAccess" in portail and ".catch(function () {});" in portail, "enrichissement compte absent"
    # ---- modules antérieurs du portail, intacts (verbatim) ----
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
