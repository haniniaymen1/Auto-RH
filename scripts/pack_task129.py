# -*- coding: utf-8 -*-
"""Packaging 0.2.50 — base = ZIP 0.2.49 verbatim (MD5 8a39fb8f…, 399 entrées)
+ package.json / package-lock.json REMPLACÉS PAR LES FICHIERS DU PROJET
  (version 0.2.50 — mêmes dépendances que 0.2.49)
+ auto-rh-readme-technique.pdf (REMPLACEMENT, édition v0.2.50 : bouton
  « Fiches de paie » dans le portail employé + détection automatique des
  erreurs / incohérences de nom et prénom, 32 pages)
+ LIRE-MOI-README-TECHNIQUE.txt (REMPLACEMENT, note 0.2.50)
+ prisma/schema.prisma (REMPLACEMENT — colonne Payslip.anomalieNom)
+ src/lib/db-crypto.ts (REMPLACEMENT — carte : anomalieNom chiffré)
+ scripts/lib-crypto-bd.js (REMPLACEMENT — jumelle carte : anomalieNom)
+ src/lib/demandes.ts (REMPLACEMENT — référence par FRÉQUENCE des noms)
+ src/lib/types.ts (REMPLACEMENT — anomalieNom / anomalies / anomaliesNoms)
+ src/app/api/payslips/route.ts (REMPLACEMENT — liste avec anomalieNom)
+ src/app/api/payslips/upload/route.ts (REMPLACEMENT — détection à l'import,
  réponse enrichie, journal complété)
+ src/components/payslip/all-tab.tsx (REMPLACEMENT — pastille ⚠ Nom)
+ src/components/payslip/import-tab.tsx (REMPLACEMENT — bandeau + alertes ambre)
+ src/components/payslip/demandes-tab.tsx (REMPLACEMENT — badge ⚠ + bannière)
+ scripts/portail-server.js (REMPLACEMENT — onglet « Fiches de paie »,
  vérification nom/prénom des demandes, e-mail RH, jumelle de détection)
+ 3 ajouts : src/lib/nom-anomalies.ts, src/lib/nom-anomalies-serveur.ts,
  harnais scripts/task129/test-anomalies-129.js (24 contrôles).
Migration : npx prisma db push (colonne Payslip.anomalieNom) puis
redémarrage des deux services.
"""
import json
import os
import zipfile

BASE = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.49.zip"
OUT = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.50.zip"
PRISTINE = "/tmp/my-project/task99_smtp/pristine"
ROOT = "/home/z/my-project"
PDF = ROOT + "/download/auto-rh-readme-technique-v0.2.50.pdf"
LIRE_MOI = ROOT + "/scripts/task129/LIRE-MOI-README-TECHNIQUE.txt"
VERSION = "0.2.50"

REMPLACEMENTS = {
    "auto-rh-readme-technique.pdf": PDF,
    "LIRE-MOI-README-TECHNIQUE.txt": LIRE_MOI,
    "package.json": ROOT + "/package.json",
    "package-lock.json": ROOT + "/package-lock.json",
    "prisma/schema.prisma": ROOT + "/prisma/schema.prisma",
    "src/lib/db-crypto.ts": ROOT + "/src/lib/db-crypto.ts",
    "scripts/lib-crypto-bd.js": ROOT + "/scripts/lib-crypto-bd.js",
    "src/lib/demandes.ts": ROOT + "/src/lib/demandes.ts",
    "src/lib/types.ts": ROOT + "/src/lib/types.ts",
    "src/app/api/payslips/route.ts": ROOT + "/src/app/api/payslips/route.ts",
    "src/app/api/payslips/upload/route.ts": ROOT + "/src/app/api/payslips/upload/route.ts",
    "src/components/payslip/all-tab.tsx": ROOT + "/src/components/payslip/all-tab.tsx",
    "src/components/payslip/import-tab.tsx": ROOT + "/src/components/payslip/import-tab.tsx",
    "src/components/payslip/demandes-tab.tsx": ROOT + "/src/components/payslip/demandes-tab.tsx",
    "scripts/portail-server.js": ROOT + "/scripts/portail-server.js",
}

AJOUTS = {
    "src/lib/nom-anomalies.ts": ROOT + "/src/lib/nom-anomalies.ts",
    "src/lib/nom-anomalies-serveur.ts": ROOT + "/src/lib/nom-anomalies-serveur.ts",
    "scripts/task129/test-anomalies-129.js": ROOT + "/scripts/task129/test-anomalies-129.js",
}

# Marqueurs attendus dans chaque fichier remplacé/ajouté (garde-fou contenu)
MARQUEURS = {
    "package.json": '"version": "0.2.50"',
    "package-lock.json": '"version": "0.2.50"',
    "prisma/schema.prisma": "anomalieNom String?",
    "src/lib/db-crypto.ts": '"anomalieNom",',
    "scripts/lib-crypto-bd.js": '"anomalieNom",',
    "src/lib/demandes.ts": "formeLettres",
    "src/lib/types.ts": "anomaliesNoms?: number",
    "src/app/api/payslips/route.ts": "anomalieNom",
    "src/app/api/payslips/upload/route.ts": "detecterAnomaliesNomsImports",
    "src/components/payslip/all-tab.tsx": "p.anomalieNom",
    "src/components/payslip/import-tab.tsx": "AlertTriangle",
    "src/components/payslip/demandes-tab.tsx": "donnees?.anomalieNom",
    "scripts/portail-server.js": 'data-pan="pan-fiches"',
    "src/lib/nom-anomalies.ts": "verifierCoherenceDemande",
    "src/lib/nom-anomalies-serveur.ts": "detecterAnomaliesNomsImports",
    "scripts/task129/test-anomalies-129.js": "TOUS LES CONTRÔLES SONT PASSÉS",
}

INCHANGES_A_VERIFIER = {
    # modules des livraisons précédentes, intacts
    "src/lib/cin-validation.ts": "classerCin",
    "src/lib/mailer.ts": "parrainageEmail: string",
    "src/app/api/mail-config/route.ts": "parrainageEmail",
    "src/app/api/demandes/[id]/route.ts": "dechiffrerChamp",
    "src/components/payslip/mail-panel.tsx": "E-mail dédié des demandes de parrainage",
    "scripts/chiffrer-storage.js": "documents-demandes",
    "src/app/page.tsx": "grid-cols-3 sm:grid-cols-6",
    "src/app/api/signature-config/route.ts": "TAILLE_IMAGE_MAX = 11_000_000",
    "src/app/api/payslips/[id]/file/route.ts": "typeFichierTamporable",
    "src/components/payslip/signature-panel.tsx": "TAILLE_FICHIER_MAX = 8_000_000",
    "next.config.ts": '"sharp"',
    "src/lib/stamp.ts": "tamponnerFicheDossier",
    "src/lib/db.ts": "injecterIndexPayslip",
    "src/lib/payslip-index.ts": "normaliserCin",
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
        ni = zipfile.ZipInfo(name, date_time=(2026, 9, 22, 5, 0, 0))
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
    assert "0.2.50" in lmr and "FICHES DE PAIE" in lmr and "INCOHÉRENCES" in lmr
    # ---- 0.2.47/0.2.48 : modules conservés ----
    schema = z.read("prisma/schema.prisma").decode("utf-8")
    for marqueur in ["qrImage", "sigDecalX", "sigDecalY", "qrDecalX", "qrDecalY", "parrainageEmail", "anomalieNom"]:
        assert marqueur in schema, "perdu (schema) : %s" % marqueur
    stamp = z.read("src/lib/stamp.ts").decode("utf-8")
    for marqueur in ["tamponnerFicheImage", "tamponnerFicheDocx", "tamponnerFicheXlsx",
                     "tamponnerFicheDossier", "typeFichierTamporable", "apercuTampon"]:
        assert marqueur in stamp, "0.2.48 perdu (stamp.ts) : %s" % marqueur
    # ---- 0.2.49 : parrainage + attestations + chiffrement conservés ----
    mailer = z.read("src/lib/mailer.ts").decode("utf-8")
    assert "employeAffiche" in mailer, "règle 0.2.42 mailer perdue"
    assert "parrainageEmail" in mailer, "parrainageEmail perdu (mailer)"
    mc = z.read("src/app/api/mail-config/route.ts").decode("utf-8")
    assert "adresse e-mail dédiée des demandes de parrainage est invalide" in mc, "perdu (mail-config)"
    det = z.read("src/app/api/demandes/[id]/route.ts").decode("utf-8")
    assert 'donnees["prenom"], donnees["nom"]' in det, "perdu (demandes/[id])"
    outil = z.read("scripts/chiffrer-storage.js").decode("utf-8")
    assert "DIRS_DOCUMENTS" in outil, "perdu (chiffrer-storage)"
    # ---- 0.2.50 : détection nom/prénom ----
    crypto = z.read("src/lib/db-crypto.ts").decode("utf-8")
    assert '"anomalieNom",' in crypto, "carte anomalieNom perdue (db-crypto)"
    crbd = z.read("scripts/lib-crypto-bd.js").decode("utf-8")
    assert '"anomalieNom",' in crbd, "carte anomalieNom perdue (lib-crypto-bd)"
    anom = z.read("src/lib/nom-anomalies.ts").decode("utf-8")
    for marqueur in ["distanceLevenshtein", "prochesParJetons", "comparerNoms",
                     "anomaliesFormatNom", "anomaliesNomFiche", "verifierCoherenceDemande"]:
        assert marqueur in anom, "perdu (nom-anomalies) : %s" % marqueur
    srv = z.read("src/lib/nom-anomalies-serveur.ts").decode("utf-8")
    for marqueur in ["ECHANTILLON_PAR_CIN", "referencePour", "anomalieNom: texte"]:
        assert marqueur in srv, "perdu (nom-anomalies-serveur) : %s" % marqueur
    upload = z.read("src/app/api/payslips/upload/route.ts").decode("utf-8")
    for marqueur in ["collecterIdsCrees", "rattacherAnomalies", "anomaliesNoms",
                     "Anomalie nom/prénom", "detecterAnomaliesNomsImports"]:
        assert marqueur in upload, "perdu (upload) : %s" % marqueur
    liste = z.read("src/app/api/payslips/route.ts").decode("utf-8")
    assert liste.count("anomalieNom: true") == 2, "selects anomalieNom perdus (liste)"
    demandes_lib = z.read("src/lib/demandes.ts").decode("utf-8")
    assert "formeLettres" in demandes_lib and "FRÉQUENT" in demandes_lib, "référence par fréquence perdue (demandes.ts)"
    assert "nomEmployeDepuisFiches" in demandes_lib, "0.2.43 perdu (demandes.ts)"
    types_ts = z.read("src/lib/types.ts").decode("utf-8")
    assert "anomalieNom: string | null" in types_ts and "anomalies?: string[]" in types_ts, "types perdus"
    # ---- 0.2.50 : UI ----
    alltab = z.read("src/components/payslip/all-tab.tsx").decode("utf-8")
    assert alltab.count("p.anomalieNom") == 4, "pastilles all-tab perdues (2×(condition+title) desktop+mobile)"
    importab = z.read("src/components/payslip/import-tab.tsx").decode("utf-8")
    for marqueur in ["anomaliesNoms", "AlertTriangle", "nom / prénom à vérifier"]:
        assert marqueur in importab, "perdu (import-tab) : %s" % marqueur
    dtab = z.read("src/components/payslip/demandes-tab.tsx").decode("utf-8")
    for marqueur in ["donnees?.anomalieNom", "Incohérence nom / prénom détectée automatiquement", "⚠ Nom"]:
        assert marqueur in dtab, "perdu (demandes-tab) : %s" % marqueur
    # ---- 0.2.50 : portail ----
    portail = z.read("scripts/portail-server.js").decode("utf-8")
    for marqueur in ['data-pan="pan-fiches"', 'id="pan-fiches"', "chargerMesFiches",
                     "/api/my-fiches", "msg.warn", "fiche-ouvrir", "fiche-telecharger",
                     "verifierCoherenceNomDemande", "prochesParJetonsNom", "formeLettresNom",
                     "anomalie: donnees.anomalieNom || null",
                     "Anomalie nom / prénom détectée", "const anomalieAttestation",
                     "const anomalieSortie", "FRÉQUENT"]:
        assert marqueur in portail, "0.2.50 perdu (portail) : %s" % marqueur
    # ---- modules 0.2.39-0.2.49 du portail, intacts ----
    assert "LOGO_TRAILMIX_PNG" in portail, "logo Trailmix perdu"
    assert portail.count("nomEmployeDepuisFiches") >= 3, "jumelle JS nom 0.2.43 perdue"
    assert "chiffrerDocumentsDemandesEnClair" in portail, "balayage 0.2.49 perdu"
    assert "parrainageEmail" in portail, "parrainage dédié 0.2.49 perdu"
    assert "Votre nom est obligatoire." in portail and "Votre prénom est obligatoire." in portail, "attestations 0.2.49 perdues"
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
