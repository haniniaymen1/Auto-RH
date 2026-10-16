# -*- coding: utf-8 -*-
"""Packaging 0.2.52 — base = ZIP 0.2.51 verbatim (MD5 9409477a…, 404 entrées)
+ package.json / package-lock.json REMPLACÉS PAR LES FICHIERS DU PROJET
  (version 0.2.52 — mêmes dépendances que 0.2.51)
+ auto-rh-readme-technique.pdf (REMPLACEMENT, édition v0.2.52 : correctifs
  « points à corriger » — positionnement QR/signature mesuré sur tous les
  formats, blocage du portail levé, rebuild automatique des lanceurs,
  pastille ⚠ Nom retirée, 34 pages)
+ LIRE-MOI-README-TECHNIQUE.txt (REMPLACEMENT, note 0.2.52)
+ src/components/payslip/all-tab.tsx (REMPLACEMENT — pastille ⚠ Nom retirée
  du tableau « Toutes les fiches », détection conservée)
+ src/components/payslip/signature-panel.tsx (REMPLACEMENT — sens des
  curseurs de décalage affiché : − = gauche/bas, + = droite/haut)
+ scripts/portail-server.js (REMPLACEMENT — apostrophe typographique dans le
  gabarit de la page des demandes : la SyntaxError rendait TOUT le script du
  portail inerte — cause racine du blocage des champs et boutons)
+ scripts/copy-standalone-assets.js (REMPLACEMENT — écrit la marque
  .next/standalone/.auto-rh-version à chaque build)
+ PREPARER-AUTO-RH-SILENCIEUX.bat (REMPLACEMENT — rebuild si la marque de
  build diffère de package.json ; cause racine des « QR/signature absents
  sur PNG/DOCX/XLSX » sur installation mise à jour)
+ DEMARRER-LINUX-MAC.sh (REMPLACEMENT — même rebuild, logique || corrigée)
+ 1 ajout : harnais scripts/task131/test-correctifs-131.js (21 contrôles).
Aucun changement de schéma : pas de migration, redémarrage des deux services
suffit (et rebuild automatique après extraction d'une nouvelle version).
"""
import json
import os
import zipfile

BASE = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.51.zip"
OUT = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.52.zip"
PRISTINE = "/tmp/my-project/task99_smtp/pristine"
ROOT = "/home/z/my-project"
PDF = ROOT + "/download/auto-rh-readme-technique-v0.2.52.pdf"
LIRE_MOI = ROOT + "/scripts/task131/LIRE-MOI-README-TECHNIQUE.txt"
VERSION = "0.2.52"

REMPLACEMENTS = {
    "auto-rh-readme-technique.pdf": PDF,
    "LIRE-MOI-README-TECHNIQUE.txt": LIRE_MOI,
    "package.json": ROOT + "/package.json",
    "package-lock.json": ROOT + "/package-lock.json",
    "src/components/payslip/all-tab.tsx": ROOT + "/src/components/payslip/all-tab.tsx",
    "src/components/payslip/signature-panel.tsx": ROOT + "/src/components/payslip/signature-panel.tsx",
    "scripts/portail-server.js": ROOT + "/scripts/portail-server.js",
    "scripts/copy-standalone-assets.js": ROOT + "/scripts/copy-standalone-assets.js",
    "PREPARER-AUTO-RH-SILENCIEUX.bat": ROOT + "/PREPARER-AUTO-RH-SILENCIEUX.bat",
    "DEMARRER-LINUX-MAC.sh": ROOT + "/DEMARRER-LINUX-MAC.sh",
}

AJOUTS = {
    "scripts/task131/test-correctifs-131.js": ROOT + "/scripts/task131/test-correctifs-131.js",
}

# Marqueurs attendus dans chaque fichier remplacé/ajouté (garde-fou contenu)
MARQUEURS = {
    "package.json": '"version": "0.2.52"',
    "package-lock.json": '"version": "0.2.52"',
    "src/components/payslip/all-tab.tsx": "(SUPPRIMÉ 0.2.52) pastille ⚠ Nom retirée",
    "src/components/payslip/signature-panel.tsx": "(CLARIFIÉ 0.2.52) sens explicite",
    "scripts/portail-server.js": "(CORRECTIF 0.2.52) apostrophe TYPOGRAPHIQUE",
    "scripts/copy-standalone-assets.js": ".auto-rh-version",
    "PREPARER-AUTO-RH-SILENCIEUX.bat": "auto-rh-version",
    "DEMARRER-LINUX-MAC.sh": "auto-rh-version",
    "scripts/task131/test-correctifs-131.js": "RÉSULTAT",
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
        ni = zipfile.ZipInfo(name, date_time=(2026, 9, 22, 6, 0, 0))
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
    assert "0.2.52" in lmr and "BLOCAGE DU PORTAIL" in lmr and "FICHES DE PAIE" in lmr and "auto-rh-version" in lmr
    # ---- 0.2.51 et antérieurs conservés ----
    schema = z.read("prisma/schema.prisma").decode("utf-8")
    for marqueur in ["anomalieNom String?", "parrainageEmail", "qrImage", "sigDecalX", "empreinteOrigine String?"]:
        assert marqueur in schema, "perdu (schema) : %s" % marqueur
    stamp = z.read("src/lib/stamp.ts").decode("utf-8")
    for marqueur in ["tamponnerFicheImage", "tamponnerFicheDocx", "tamponnerFicheXlsx",
                     "tamponnerFicheDossier", "typeFichierTamporable", "apercuTampon",
                     "titre?: string", "objet?: string", "Auto-RH — Fiche de paie"]:
        assert marqueur in stamp, "perdu (stamp.ts) : %s" % marqueur
    mailer = z.read("src/lib/mailer.ts").decode("utf-8")
    for marqueur in ["envoyerEmailDemandeStatut", "envoyerEmailDocumentRepondu",
                     "votre document est disponible", '"demande-document"', "employeAffiche",
                     "parrainageEmail: string"]:
        assert marqueur in mailer, "perdu (mailer) : %s" % marqueur
    repondre = z.read("src/app/api/demandes/[id]/repondre/route.ts").decode("utf-8")
    for marqueur in ["mode === \"apercu\"", "tamponnerFicheDossier", "empreinteOrigine",
                     "SERVICE RH", "documents-demandes", "ACCEPTEE", "409",
                     "X-Document-Apercu-Tampon", "Import direct — ", "TAILLE_MAX = 15 * 1024 * 1024"]:
        assert marqueur in repondre, "perdu (repondre) : %s" % marqueur
    dtab = z.read("src/components/payslip/demandes-tab.tsx").decode("utf-8")
    for marqueur in ["Répondre avec un document (import direct)", "envoyerReponse",
                     "apercuUrl", "modeTampon", "Valider et envoyer", "donnees?.anomalieNom",
                     "X-Document-Apercu-Avertissements"]:
        assert marqueur in dtab, "perdu (demandes-tab) : %s" % marqueur
    portail = z.read("scripts/portail-server.js").decode("utf-8")
    for marqueur in ["empreinteOrigine: empreinte", "data-pan=\"pan-fiches\"",
                     "verifierCoherenceNomDemande", "chiffrerDocumentsDemandesEnClair",
                     "parrainageEmail", "LOGO_TRAILMIX_PNG",
                     "(CORRECTIF 0.2.52) apostrophe TYPOGRAPHIQUE"]:
        assert marqueur in portail, "perdu (portail) : %s" % marqueur
    assert portail.count("indexOf(d.cinMasque)") == 2, "règle CIN unique 0.2.42 perdue"
    # ---- 0.2.52 : vérifications ciblées ----
    alltab = z.read("src/components/payslip/all-tab.tsx").decode("utf-8")
    assert "⚠ Nom" not in alltab.replace("(SUPPRIMÉ 0.2.52) pastille ⚠ Nom retirée", ""), "pastille encore rendue ?"
    assert "p.anomalieNom" not in alltab, "badge p.anomalieNom encore présent"
    sigpan = z.read("src/components/payslip/signature-panel.tsx").decode("utf-8")
    for marqueur in ["− = gauche, + = droite", "− = bas, + = haut"]:
        assert marqueur in sigpan, "perdu (signature-panel) : %s" % marqueur
    copyst = z.read("scripts/copy-standalone-assets.js").decode("utf-8")
    assert "writeFileSync(path.join(STANDALONE, \".auto-rh-version\")" in copyst, "marque non écrite par copy-standalone-assets"
    prep = z.read("PREPARER-AUTO-RH-SILENCIEUX.bat").decode("utf-8")
    assert prep.count("auto-rh-version") >= 2 and "if errorlevel 1" in prep, "rebuild .bat absent"
    demsh = z.read("DEMARRER-LINUX-MAC.sh").decode("utf-8")
    assert "|| ! node -e" in demsh and "auto-rh-version" in demsh, "rebuild .sh absent ou logique && fautive"
    harnais = z.read("scripts/task131/test-correctifs-131.js").decode("utf-8")
    assert "S4a" in harnais and "S6c" in harnais, "harnais incomplet"
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
