# -*- coding: utf-8 -*-
"""Packaging 0.2.49 — base = ZIP 0.2.48 verbatim (MD5 55f9d1df…, 398 entrées)
+ package.json / package-lock.json REMPLACÉS PAR LES FICHIERS DU PROJET
  (version 0.2.49 — mêmes dépendances que 0.2.48)
+ auto-rh-readme-technique.pdf (REMPLACEMENT, édition v0.2.49 : documents
  des demandes illisibles + parrainage dédié + attestations Nom/Prénom,
  31 pages)
+ LIRE-MOI-README-TECHNIQUE.txt (REMPLACEMENT, note 0.2.49)
+ prisma/schema.prisma (REMPLACEMENT — MailConfig.parrainageEmail)
+ src/lib/mailer.ts (REMPLACEMENT — ConfigMailLue.parrainageEmail)
+ src/lib/demandes.ts (REMPLACEMENT — pairesInfosDemande attestations
  Nom/Prénom conditionnels)
+ src/app/api/mail-config/route.ts (REMPLACEMENT — enregistrement et
  validation de parrainageEmail)
+ src/app/api/demandes/[id]/route.ts (REMPLACEMENT — nom « Prénom NOM » +
  destinataire/employeEmail déchiffrés)
+ src/components/payslip/mail-panel.tsx (REMPLACEMENT — champ « E-mail
  dédié des demandes de parrainage »)
+ scripts/portail-server.js (REMPLACEMENT — routage parrainage dédié,
  attestations Nom/Prénom, notification avec Employé, balayage de
  chiffrement au démarrage)
+ scripts/chiffrer-storage.js (REMPLACEMENT — couvre fiches ET documents)
+ 1 ajout : harnais E2E scripts/task127/test-demandes-128.js (31 contrôles).
Migration : npx prisma db push (colonne MailConfig.parrainageEmail) puis
redémarrage des deux services.
"""
import json
import os
import zipfile

BASE = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.48.zip"
OUT = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.49.zip"
PRISTINE = "/tmp/my-project/task99_smtp/pristine"
ROOT = "/home/z/my-project"
PDF = ROOT + "/download/auto-rh-readme-technique-v0.2.49.pdf"
LIRE_MOI = ROOT + "/scripts/task127/LIRE-MOI-README-TECHNIQUE.txt"
VERSION = "0.2.49"

REMPLACEMENTS = {
    "auto-rh-readme-technique.pdf": PDF,
    "LIRE-MOI-README-TECHNIQUE.txt": LIRE_MOI,
    "package.json": ROOT + "/package.json",
    "package-lock.json": ROOT + "/package-lock.json",
    "prisma/schema.prisma": ROOT + "/prisma/schema.prisma",
    "src/lib/mailer.ts": ROOT + "/src/lib/mailer.ts",
    "src/lib/demandes.ts": ROOT + "/src/lib/demandes.ts",
    "src/app/api/mail-config/route.ts": ROOT + "/src/app/api/mail-config/route.ts",
    "src/app/api/demandes/[id]/route.ts": ROOT + "/src/app/api/demandes/[id]/route.ts",
    "src/components/payslip/mail-panel.tsx": ROOT + "/src/components/payslip/mail-panel.tsx",
    "scripts/portail-server.js": ROOT + "/scripts/portail-server.js",
    "scripts/chiffrer-storage.js": ROOT + "/scripts/chiffrer-storage.js",
}

AJOUTS = {
    "scripts/task127/test-demandes-128.js": ROOT + "/scripts/task127/test-demandes-128.js",
}

# Marqueurs attendus dans chaque fichier remplacé/ajouté (garde-fou contenu)
MARQUEURS = {
    "package.json": '"version": "0.2.49"',
    "package-lock.json": '"version": "0.2.49"',
    "prisma/schema.prisma": "parrainageEmail",
    "src/lib/mailer.ts": "parrainageEmail: string",
    "src/lib/demandes.ts": 's("nom") ? [["Nom", s("nom")]]',
    "src/app/api/mail-config/route.ts": "parrainageEmail",
    "src/app/api/demandes/[id]/route.ts": "dechiffrerChamp",
    "src/components/payslip/mail-panel.tsx": "E-mail dédié des demandes de parrainage",
    "scripts/portail-server.js": "chiffrerDocumentsDemandesEnClair",
    "scripts/chiffrer-storage.js": "documents-demandes",
    "scripts/task127/test-demandes-128.js": "TOUS LES CONTRÔLES SONT PASSÉS",
}

INCHANGES_A_VERIFIER = {
    # modules des livraisons précédentes, intacts
    "src/lib/cin-validation.ts": "classerCin",
    "src/lib/db-crypto.ts": "imapUser",
    "scripts/lib-crypto-bd.js": "imapUser",
    "src/app/api/demandes/route.ts": "tailleLisibleDocument",
    "src/app/page.tsx": "grid-cols-3 sm:grid-cols-6",
    "src/components/payslip/demandes-tab.tsx": "overflow-x-auto",
    "src/app/api/signature-config/route.ts": "TAILLE_IMAGE_MAX = 11_000_000",
    "src/app/api/payslips/[id]/file/route.ts": "typeFichierTamporable",
    "src/components/payslip/signature-panel.tsx": "TAILLE_FICHIER_MAX = 8_000_000",
    "next.config.ts": '"sharp"',
    "src/lib/stamp.ts": "tamponnerFicheDossier",
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
        if name in REMPLACEMENTS:
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
        ni = zipfile.ZipInfo(name, date_time=(2026, 9, 22, 4, 0, 0))
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
    assert "0.2.49" in lmr and "PARRAINAGE" in lmr and "NOM" in lmr and "ILLISIBLES" in lmr
    # ---- 0.2.47/0.2.48 : modules conservés ----
    schema = z.read("prisma/schema.prisma").decode("utf-8")
    for marqueur in ["qrImage", "sigDecalX", "sigDecalY", "qrDecalX", "qrDecalY", "parrainageEmail"]:
        assert marqueur in schema, "perdu (schema) : %s" % marqueur
    stamp = z.read("src/lib/stamp.ts").decode("utf-8")
    for marqueur in ["tamponnerFicheImage", "tamponnerFicheDocx", "tamponnerFicheXlsx",
                     "tamponnerFicheDossier", "typeFichierTamporable", "apercuTampon"]:
        assert marqueur in stamp, "0.2.48 perdu (stamp.ts) : %s" % marqueur
    # ---- 0.2.49 : parrainage + attestations + chiffrement ----
    mailer = z.read("src/lib/mailer.ts").decode("utf-8")
    assert "employeAffiche" in mailer, "règle 0.2.42 mailer perdue"
    assert "hasImapPassword" in mailer, "IMAP 0.2.44 mailer perdu"
    assert "parrainageEmail" in mailer, "parrainageEmail perdu (mailer)"
    demandes = z.read("src/lib/demandes.ts").decode("utf-8")
    assert "nomEmployeDepuisFiches" in demandes, "0.2.43 perdu (demandes.ts)"
    assert 'case "ATTESTATION_TRAVAIL":' in demandes and "Prénom" in demandes, "attestations Nom/Prénom perdues (demandes.ts)"
    mc = z.read("src/app/api/mail-config/route.ts").decode("utf-8")
    for marqueur in ["test-imap", "parrainageEmail", "adresse e-mail dédiée des demandes de parrainage est invalide"]:
        assert marqueur in mc, "perdu (mail-config) : %s" % marqueur
    det = z.read("src/app/api/demandes/[id]/route.ts").decode("utf-8")
    for marqueur in ['donnees["prenom"], donnees["nom"]', "dechiffrerChamp", "envoyerEmailDemandeStatut"]:
        assert marqueur in det, "perdu (demandes/[id]) : %s" % marqueur
    panel = z.read("src/components/payslip/mail-panel.tsx").decode("utf-8")
    for marqueur in ["mail-parrainage", "Tester la connexion IMAP", "parrainageEmail"]:
        assert marqueur in panel, "perdu (mail-panel) : %s" % marqueur
    outil = z.read("scripts/chiffrer-storage.js").decode("utf-8")
    for marqueur in ["DIRS_FICHES", "DIRS_DOCUMENTS", "documents des demandes"]:
        assert marqueur in outil, "perdu (chiffrer-storage) : %s" % marqueur
    # ---- 0.2.49 : portail ----
    portail = z.read("scripts/portail-server.js").decode("utf-8")
    for marqueur in ["chiffrerDocumentsDemandesEnClair", "parrainageEmail",
                     "Adresse dédiée des demandes de parrainage",
                     "Votre nom est obligatoire.", "Votre prénom est obligatoire.",
                     "att-travail-nom", "att-salaire-prenom", "employeAfficheDoc",
                     'infos.push(["Nom", donnees.nom])', 'infos.push(["Prénom", donnees.prenom])',
                     "tamponnerFicheDossierTampon", "messageImapLisible"]:
        assert marqueur in portail, "0.2.49 perdu (portail) : %s" % marqueur
    # ---- modules 0.2.39-0.2.48 du portail, intacts ----
    assert "LOGO_TRAILMIX_PNG" in portail, "logo Trailmix perdu"
    assert portail.count("nomEmployeDepuisFiches") >= 3, "jumelle JS nom 0.2.43 perdue"
    assert portail.count("indexOf(d.cinMasque)") == 2, "règle CIN unique 0.2.42 perdue"
    for marqueur in ['id="form-att-travail"', "emailDemandeSaisi", "E-mail employé",
                     "traiterMessageRecu", "verifierBoiteDemandes", "demarrerReceptionEmails",
                     "envoyerEmailDocumentDisponible", "/api/mes-demandes/documents/",
                     "tamponnerFicheImageTampon", "tamponnerFicheDocxTampon", "tamponnerFicheXlsxTampon",
                     "typeFichierTamporableTampon"]:
        assert marqueur in portail, "module antérieur perdu (portail) : %s" % marqueur
    assert "async function tamponnerFicheTampon(" in portail, "moteur PDF perdu (JS)"
    # ---- modules des livraisons précédentes, intacts ----
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
