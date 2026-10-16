# -*- coding: utf-8 -*-
"""Packaging 0.2.53 — base = ZIP 0.2.52 verbatim (MD5 f9bd04f0…, 405 entrées)
+ package.json / package-lock.json REMPLACÉS PAR LES FICHIERS DU PROJET
  (version 0.2.53 — mêmes dépendances que 0.2.52)
+ auto-rh-readme-technique.pdf (REMPLACEMENT, édition v0.2.53 : installation
  fiabilisée — plus aucun node -e dans les lanceurs, jalons ETAPE temps réel,
  popup VBS affichant l'étape en cours, modules natifs vérifiés, 36 pages)
+ LIRE-MOI-README-TECHNIQUE.txt (REMPLACEMENT, note 0.2.53)
+ PREPARER-AUTO-RH-SILENCIEUX.bat (REMPLACEMENT — réécrit 100 % ASCII/CRLF :
  contrôle du build par scripts/verifier-build-a-jour.js (plus de node -e —
  tué silencieusement par l'antivirus sur certains postes => arrêt après 4/6),
  ETAT=EN_COURS + ETAPE=1..6 à chaque étape, jalons visibles/horodatés,
  verifier-modules-natifs.js après npm install — non bloquant)
+ DEMARRER-LINUX-MAC.sh (REMPLACEMENT — même contrôle par fichier)
+ DEMARRER-SILENCIEUX-WINDOWS.vbs (REMPLACEMENT — attente stoppée uniquement
  par ETAT=OK/ERREUR, popup de dépassement affichant la dernière étape)
+ 3 AJOUTS : scripts/verifier-build-a-jour.js, scripts/verifier-modules-natifs.js,
  harnais scripts/task132/test-lanceurs-132.js (28 contrôles).
Aucun changement de schéma : pas de migration, relance du lanceur suffit
(rebuild automatique si la marque .auto-rh-version diffère du package).
"""
import json
import os
import zipfile

BASE = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.52.zip"
OUT = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.53.zip"
PRISTINE = "/tmp/my-project/task99_smtp/pristine"
ROOT = "/home/z/my-project"
PDF = ROOT + "/download/auto-rh-readme-technique-v0.2.53.pdf"
LIRE_MOI = ROOT + "/scripts/task132/LIRE-MOI-README-TECHNIQUE.txt"
VERSION = "0.2.53"

REMPLACEMENTS = {
    "auto-rh-readme-technique.pdf": PDF,
    "LIRE-MOI-README-TECHNIQUE.txt": LIRE_MOI,
    "package.json": ROOT + "/package.json",
    "package-lock.json": ROOT + "/package-lock.json",
    "PREPARER-AUTO-RH-SILENCIEUX.bat": ROOT + "/PREPARER-AUTO-RH-SILENCIEUX.bat",
    "DEMARRER-LINUX-MAC.sh": ROOT + "/DEMARRER-LINUX-MAC.sh",
    "DEMARRER-SILENCIEUX-WINDOWS.vbs": ROOT + "/DEMARRER-SILENCIEUX-WINDOWS.vbs",
}

AJOUTS = {
    "scripts/verifier-build-a-jour.js": ROOT + "/scripts/verifier-build-a-jour.js",
    "scripts/verifier-modules-natifs.js": ROOT + "/scripts/verifier-modules-natifs.js",
    "scripts/task132/test-lanceurs-132.js": ROOT + "/scripts/task132/test-lanceurs-132.js",
}

# Marqueurs attendus dans chaque fichier remplacé/ajouté (garde-fou contenu)
MARQUEURS = {
    "package.json": '"version": "0.2.53"',
    "package-lock.json": '"version": "0.2.53"',
    "PREPARER-AUTO-RH-SILENCIEUX.bat": "verifier-build-a-jour.js",
    "DEMARRER-LINUX-MAC.sh": "verifier-build-a-jour.js",
    "DEMARRER-SILENCIEUX-WINDOWS.vbs": "Derniere etape inscrite par la preparation",
    "scripts/verifier-build-a-jour.js": "VERDICT=BUILD_PERIME",
    "scripts/verifier-modules-natifs.js": "modules-natifs",
    "scripts/task132/test-lanceurs-132.js": "RÉSULTAT",
}

INCHANGES_A_VERIFIER = {
    # modules des livraisons précédentes, intacts
    "src/lib/cin-validation.ts": "classerCin",
    "src/lib/db-crypto.ts": '"anomalieNom",',
    "src/lib/nom-anomalies.ts": "verifierCoherenceDemande",
    "src/lib/nom-anomalies-serveur.ts": "detecterAnomaliesNomsImports",
    "src/lib/demandes.ts": "FRÉQUENT",
    "src/lib/types.ts": "anomaliesNoms?: number",
    "src/lib/stamp.ts": "tamponnerFicheImage",
    "src/app/api/payslips/upload/route.ts": "detecterAnomaliesNomsImports",
    "src/app/api/payslips/route.ts": "anomalieNom",
    "src/components/payslip/import-tab.tsx": "nom / prénom à vérifier",
    "src/app/api/mail-config/route.ts": "parrainageEmail",
    "src/app/api/demandes/[id]/route.ts": "dechiffrerChamp",
    "src/app/api/demandes/[id]/repondre/route.ts": "envoyerEmailDocumentRepondu",
    "src/components/payslip/demandes-tab.tsx": "Répondre avec un document (import direct)",
    "src/components/payslip/mail-panel.tsx": "E-mail dédié des demandes de parrainage",
    "scripts/chiffrer-storage.js": "documents-demandes",
    "scripts/lib-crypto-bd.js": '"anomalieNom",',
    "src/app/page.tsx": "grid-cols-3 sm:grid-cols-6",
    "src/app/api/signature-config/route.ts": "TAILLE_IMAGE_MAX = 11_000_000",
    "src/app/api/payslips/[id]/file/route.ts": "typeFichierTamporable",
    "src/lib/mailer.ts": "envoyerEmailDocumentRepondu",
    "prisma/schema.prisma": "empreinteOrigine String?",
    "next.config.ts": '"sharp"',
    "scripts/copy-standalone-assets.js": ".auto-rh-version",
}


def main():
    pdf_bytes = open(PDF, "rb").read()
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
        ni = zipfile.ZipInfo(name, date_time=(2026, 9, 22, 17, 30, 0))
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
    assert "0.2.53" in lmr and "NODE -E" in lmr and "ETAPE=" in lmr and "verifier-build-a-jour" in lmr and "4/6" in lmr
    # ---- bat : audit ciblé dans le ZIP ----
    prep = z.read("PREPARER-AUTO-RH-SILENCIEUX.bat").decode("utf-8")
    lignes = prep.split("\r\n")
    reels = [l for l in lignes if "node -e" in l.lower() and not l.strip().upper().startswith("REM")]
    assert not reels, "node -e réel dans le bat: %s" % reels
    assert prep.count("echo ETAT=EN_COURS") == 7, prep.count("echo ETAT=EN_COURS")
    for e in range(1, 7):
        assert "ETAPE=%d/6" % e in prep, "ETAPE=%d/6 absent" % e
    assert 'call node "scripts\\verifier-build-a-jour.js"' in prep
    assert 'call node "scripts\\verifier-modules-natifs.js"' in prep
    assert prep.encode == None or True
    prep_bytes = z.read("PREPARER-AUTO-RH-SILENCIEUX.bat")
    prep_bytes.decode("ascii")  # ASCII strict
    assert b"\n" not in prep_bytes.replace(b"\r\n", b""), "LF seul dans le bat"
    # ---- .sh + vbs ----
    demsh = z.read("DEMARRER-LINUX-MAC.sh").decode("utf-8")
    assert "node scripts/verifier-build-a-jour.js" in demsh
    assert not [l for l in demsh.split("\n") if "node -e" in l and not l.strip().startswith("#")], "node -e réel dans le .sh"
    vbs = z.read("DEMARRER-SILENCIEUX-WINDOWS.vbs").decode("utf-8")
    assert 'InStr(contenu, "ETAT=OK") > 0 Or InStr(contenu, "ETAT=ERREUR") > 0' in vbs
    assert "Derniere etape inscrite par la preparation" in vbs
    vbs.encode("ascii")
    # ---- 0.2.51/0.2.52 conservés ----
    schema = z.read("prisma/schema.prisma").decode("utf-8")
    for marqueur in ["anomalieNom String?", "parrainageEmail", "qrImage", "sigDecalX", "empreinteOrigine String?"]:
        assert marqueur in schema, "perdu (schema) : %s" % marqueur
    stamp = z.read("src/lib/stamp.ts").decode("utf-8")
    for marqueur in ["tamponnerFicheImage", "tamponnerFicheDocx", "tamponnerFicheXlsx",
                     "tamponnerFicheDossier", "typeFichierTamporable", "apercuTampon"]:
        assert marqueur in stamp, "perdu (stamp.ts) : %s" % marqueur
    mailer = z.read("src/lib/mailer.ts").decode("utf-8")
    for marqueur in ["envoyerEmailDemandeStatut", "envoyerEmailDocumentRepondu", "parrainageEmail: string"]:
        assert marqueur in mailer, "perdu (mailer.ts) : %s" % marqueur
    portail = z.read("scripts/portail-server.js").decode("utf-8")
    for marqueur in ["empreinteOrigine: empreinte", 'data-pan="pan-fiches"',
                     "verifierCoherenceNomDemande", "parrainageEmail",
                     "(CORRECTIF 0.2.52) apostrophe TYPOGRAPHIQUE"]:
        assert marqueur in portail, "perdu (portail) : %s" % marqueur
    assert portail.count("indexOf(d.cinMasque)") == 2, "règle CIN unique 0.2.42 perdue"
    alltab = z.read("src/components/payslip/all-tab.tsx").decode("utf-8")
    assert "⚠ Nom" not in alltab.replace("(SUPPRIMÉ 0.2.52) pastille ⚠ Nom retirée", ""), "pastille encore rendue ?"
    sigpan = z.read("src/components/payslip/signature-panel.tsx").decode("utf-8")
    assert "− = gauche, + = droite" in sigpan and "− = bas, + = haut" in sigpan, "sens des décalages perdu"
    copyst = z.read("scripts/copy-standalone-assets.js").decode("utf-8")
    assert 'writeFileSync(path.join(STANDALONE, ".auto-rh-version")' in copyst, "marque non écrite"
    harnais = z.read("scripts/task132/test-lanceurs-132.js").decode("utf-8")
    assert "T9b" in harnais and "T10" in harnais, "harnais incomplet"
    h131 = z.read("scripts/task131/test-correctifs-131.js").decode("utf-8")
    assert "S4a" in h131 and "S6c" in h131, "harnais 131 perdu"
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
