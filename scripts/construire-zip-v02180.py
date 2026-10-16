#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Construit les ZIP de livraison v0.2.180 (Auto-RH) — PIÈCES JOINTES DU RH
TRANSMISES À L'EMPLOYÉ AVEC LA DÉCISION (attestations salaire / travail +
parrainage) :

  - COMPLET : auto-rh-scripts-site-web-v0.2.180.zip
  - LEGER   : auto-rh-scripts-site-web-v0.2.180-leger.zip

Base : ZIP v0.2.179 (MD5 f6833cf04c83b9d0ad40215b2b56b35a).
Changements :
  1) scripts/portail-server.js — v0.2.180 (DEMANDE UTILISATEUR) : le service
     RH PEUT joindre des documents à sa décision (réponse e-mail d'une
     attestation de travail / de salaire ou d'un parrainage) : dès qu'une
     décision (acceptée OU refusée) est reconnue et que la réponse contient
     des pièces jointes (courantes ou antérieures), l'employé reçoit UN SEUL
     e-mail « Votre demande : … — Acceptée/Refusée — documents joints » avec
     la décision ET les documents du RH (envoyerEmailDecisionDocumentsRh —
     en-tête système Garde 2, bannière verte/rouge, trace journal
     documentsRhTransmis). SANS pièce jointe : aucun e-mail (v0.2.179
     inchangé). AUCUN PDF auto-généré dans cet envoi (règle v0.2.179).
     Congé / autorisation : flux inchangé (PDF signé + PJs v0.2.171) ;
  2) README : ÉDITION ESSENTIELLE v0.2.180 (9 pages — transmission des
     pièces jointes documentée, durée 180 versions) ;
  3) tests v0.2.180 embarqués : test_v02180_pj_decision_rh.js
     (21 contrôles — 21 OK / 0 FAIL) + construire-zip-v02180.py ;
  4) test 179 mis à jour (fenêtre du contrôle de branche élargie au code
     v0.2.180 ajouté — 23 OK / 0 FAIL revalidé) ;
  5) VERSION = 0.2.180, MANIFEST-LIVRAISON.txt régénéré.

Intégrité vérifiée (testzip) + contrôles + MD5 affichés.
"""
import os, zipfile, hashlib, shutil

REF_COMPLET = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.179.zip"
REF_LEGER   = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.179-leger.zip"
SORTIE      = "/home/z/my-project/download"
VERSION     = "v0.2.180"

README_NOUVEAU = "/home/z/my-project/download/servicerh-readme-technique-v0.2.180.pdf"
FICHIERS_REMPLACES = {
    "scripts/portail-server.js":            "/home/z/my-project/scripts/portail-server.js",
    "scripts/test_v02179_reponse_auto_pdf.js": "/home/z/my-project/scripts/test_v02179_reponse_auto_pdf.js",
}
NOUVEAUX = {
    "scripts/test_v02180_pj_decision_rh.js": "/home/z/my-project/scripts/test_v02180_pj_decision_rh.js",
    "scripts/creer_readme_essentiel_v02180.py": "/home/z/my-project/scripts/creer_readme_essentiel_v02180.py",
    "scripts/construire-zip-v02180.py":      "/home/z/my-project/scripts/construire-zip-v02180.py",
}


def md5(fichier):
    h = hashlib.md5()
    with open(fichier, "rb") as f:
        for bloc in iter(lambda: f.read(1 << 20), b""):
            h.update(bloc)
    return h.hexdigest()


def construire(ref_zip, nom_sortie, mode):
    chemin_sortie = os.path.join(SORTIE, nom_sortie)
    ref = zipfile.ZipFile(ref_zip)
    noms = [n for n in ref.namelist() if n != "MANIFEST-LIVRAISON.txt"]
    with zipfile.ZipFile(chemin_sortie, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as out:
        for n in noms:
            if n == "VERSION":
                continue  # remplacé plus bas
            if n in FICHIERS_REMPLACES:
                out.write(FICHIERS_REMPLACES[n], n)  # version v0.2.180 de l'arbre
                continue
            if n == "auto-rh-readme-technique.pdf":
                out.write(README_NOUVEAU, n)  # édition essentielle v0.2.180
                continue
            if n == "servicerh-readme-technique-reduit.pdf" and mode == "COMPLET":
                out.write(README_NOUVEAU, n)
                continue
            out.writestr(n, ref.read(n))
        for arc, src in NOUVEAUX.items():
            out.write(src, arc)
        out.writestr("VERSION", "0.2.180\n")
    ref.close()
    zf = zipfile.ZipFile(chemin_sortie)
    entrees = sorted(i.filename for i in zf.infolist() if i.filename != "MANIFEST-LIVRAISON.txt")
    taille = {i.filename: i.file_size for i in zf.infolist()}
    corps = [f"{taille[n]}\t{n}" for n in entrees]
    with zipfile.ZipFile(chemin_sortie, "a", zipfile.ZIP_DEFLATED) as out:
        out.writestr("MANIFEST-LIVRAISON.txt",
                     f"MODE={mode}\nVERSION={VERSION}\nFICHIERS={len(entrees)}\n" + "\n".join(corps) + "\n")
    zf.close()
    return chemin_sortie, len(entrees) + 1


def verifier(chemin, mode):
    zf = zipfile.ZipFile(chemin)
    bad = zf.testzip()
    noms = set(zf.namelist())
    from pypdf import PdfReader
    import io
    contenu_readme = zf.read("auto-rh-readme-technique.pdf")
    lecteur = PdfReader(io.BytesIO(contenu_readme))
    texte = " ".join((p.extract_text() or "") for p in lecteur.pages)
    sans_esp = "".join(texte.split())
    portail = zf.read("scripts/portail-server.js").decode("utf-8", "replace")
    verifs = {
        "testzip": bad is None,
        "VERSION 0.2.180": zf.read("VERSION").decode().strip() == "0.2.180",
        "README = édition essentielle (V0.2.180)": "V0.2.180" in sans_esp,
        "README = durée du projet (180 versions)": ("Duréeduprojet" in sans_esp and "30jours" in sans_esp
                                                    and "180versions" in sans_esp),
        "README = transmission PJs documentée": ("PiècesjointesduRH" in sans_esp and "documentsRhTransmis" in sans_esp),
        "README = désactivation 179 conservée": "RéponseautomatiquePDFdésactivée" in sans_esp,
        "README = 9 pages": len(lecteur.pages) == 9,
        # ---- NOUVEAU v0.2.180 : transmission des PJs du RH avec la décision ----
        "portail = fonction envoyerEmailDecisionDocumentsRh": "async function envoyerEmailDecisionDocumentsRh(" in portail,
        "portail = pièces attachées à l'e-mail de décision": "attachments: pieces" in portail,
        "portail = objet décision + documents joints": 'statutLabel + " — documents joints"' in portail,
        "portail = envoi uniquement si pièces": "if (piecesRh.length) {" in portail,
        "portail = Garde 2 (X-Auto-RH-Systeme) sur l'e-mail de transmission":
          '"X-Auto-RH-Systeme": "decision-documents-rh"' in portail,
        "portail = journal documentsRhTransmis": "documentsRhTransmis: notification && Array.isArray(notification.documents)" in portail,
        # ---- v0.2.179 conservé : aucun PDF auto-généré attestations/parrainage ----
        "portail = génération PDF protégée (!sansReponseAutoPdf)":
          "if (decisionApplicable && !sansReponseAutoPdf &&" in portail,
        "portail = 1 seul appel doc-acceptation (protégé)":
          portail.count("await traiterDocumentSigneAcceptation(") == 1,
        "portail = 1 seul appel doc-refus (protégé)":
          portail.count("await traiterDocumentRefusDecision(") == 1,
        "portail = trace reponseAutoPdf desactivee":
          "reponseAutoPdf: decisionApplicable && sansReponseAutoPdf" in portail,
        # ---- v0.2.178/177 conservés ----
        "portail = PARRAINAGE dans TYPES_CLASSIFICATION_AUTO": '"PARRAINAGE"' in portail.split("TYPES_CLASSIFICATION_AUTO = [")[1].split("]")[0],
        "portail = branche décision unique parrainage": "Service parrainage (réponse e-mail)" in portail,
        "portail = cadre vert masqué": 'class="d-etapes"' not in portail and ".d-etapes" not in portail,
        "portail = confidentialité décision (decisionMasquee)": "decisionMasquee" in portail,
        "portail = magic/sels intacts": ("PAIESAGE1" in portail and "autorh-signature-v1" in portail),
        "test PJ décision 180 embarqué": "scripts/test_v02180_pj_decision_rh.js" in noms,
        "test 179 conservé (mis à jour)": "scripts/test_v02179_reponse_auto_pdf.js" in noms,
        "test E2E 178 conservé": "scripts/test_v02178_parrainage_email.js" in noms,
        "route upload présente": "src/app/api/payslips/upload/route.ts" in noms,
        "test 405 embarqué": "scripts/test_correctif_405_upload.js" in noms,
        "reduit présent": "servicerh-readme-technique-reduit.pdf" in noms or mode == "LEGER",
        "VBS chiffrer-fiches-silencieux ABSENT": not any("CHIFFRER-FICHES-SILENCIEUX" in n for n in noms),
        "0 PDF v0.2.179 restant": not any("-v0.2.179.pdf" in n for n in noms),
        "0 lanceur supprimé": not any(x in noms for x in (
            "DEMARRER-WINDOWS.bat", "DEMARRER-TOUT-WINDOWS.bat",
            "DEMARRER-PORTAIL-WINDOWS.bat", "SCINDER-DOCX-WINDOWS.bat",
            "SCINDER-EXCEL-WINDOWS.bat", "SCINDER-FICHES-WINDOWS.bat",
            "SECURISER-DOSSIER-WINDOWS.bat", "SECURISER-DOSSIERS-WINDOWS.bat")),
    }
    zf.close()
    return verifs


def main():
    print("=== Construction v0.2.180 (PJs du RH transmises avec la décision) ===\n")
    for ref, nom, mode in [
        (REF_COMPLET, f"auto-rh-scripts-site-web-{VERSION}.zip", "COMPLET"),
        (REF_LEGER,   f"auto-rh-scripts-site-web-{VERSION}-leger.zip", "LEGER"),
    ]:
        chemin, n = construire(ref, nom, mode)
        taille = os.path.getsize(chemin)
        empreinte = md5(chemin)
        v = verifier(chemin, mode)
        print(f"--- {nom}")
        print(f"    entrées={n}  taille={taille:,} o  MD5={empreinte}")
        echecs = [k for k, okk in v.items() if not okk]
        for k, okk in v.items():
            print(f"    [{'OK' if okk else 'FAIL'}] {k}")
        print()
    for src, dst in [
        (f"auto-rh-scripts-site-web-{VERSION}.zip", "auto-rh-scripts-site-web.zip"),
        (f"auto-rh-scripts-site-web-{VERSION}-leger.zip", "auto-rh-scripts-site-web-leger.zip"),
    ]:
        shutil.copyfile(os.path.join(SORTIE, src), os.path.join(SORTIE, dst))
        m1 = md5(os.path.join(SORTIE, src)); m2 = md5(os.path.join(SORTIE, dst))
        print(f"copie générique {dst} : {'IDENTIQUE' if m1 == m2 else 'DIVERGENCE !!'} (MD5 {m1})")


if __name__ == "__main__":
    main()
