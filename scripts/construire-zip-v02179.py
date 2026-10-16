#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Construit les ZIP de livraison v0.2.179 (Auto-RH) — RÉPONSE AUTOMATIQUE PDF
DÉSACTIVÉE pour les attestations (travail / salaire) et le parrainage :

  - COMPLET : auto-rh-scripts-site-web-v0.2.179.zip
  - LEGER   : auto-rh-scripts-site-web-v0.2.179-leger.zip

Base : ZIP v0.2.178 (livraison vérifiée fonctionnelle, MD5 6802e5ac11f43d1adcd2ec2cf6aaed64).
Changements :
  1) scripts/portail-server.js — v0.2.179 (DEMANDE UTILISATEUR) : après la
     décision par e-mail (acceptée OU refusée) d'une demande d'ATTESTATION DE
     TRAVAIL, d'ATTESTATION DE SALAIRE ou de PARRAINAGE : AUCUNE réponse
     automatique envoyée à l'employé et AUCUN PDF signé généré (garde-fou
     sansReponseAutoPdf) — la décision reste détectée et enregistrée
     automatiquement (statuts portail + administration + historique, trace
     journal reponseAutoPdf="desactivee") ; le service RH répond lui-même.
     CONGÉ / AUTORISATION : inchangés (réponse automatique + PDF signé +
     transfert des pièces jointes v0.2.171) ;
  2) README : ÉDITION ESSENTIELLE v0.2.179 (9 pages — désactivation
     documentée, durée 179 versions conservée) ;
  3) tests v0.2.179 embarqués : test_v02179_reponse_auto_pdf.js
     (23 contrôles — 23 OK / 0 FAIL) + construire-zip-v02179.py ;
  4) CHIFFRER-FICHES-SILENCIEUX-WINDOWS.vbs RETIRÉ de l'archive (demande
     utilisateur antérieure — le fichier avait été supprimé du projet, il
     restait embarqué dans la livraison v0.2.178) ;
  5) VERSION = 0.2.179, MANIFEST-LIVRAISON.txt régénéré.

Intégrité vérifiée (testzip) + contrôles + MD5 affichés.
"""
import os, zipfile, hashlib, shutil

REF_COMPLET = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.178.zip"
REF_LEGER   = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.178-leger.zip"
SORTIE      = "/home/z/my-project/download"
VERSION     = "v0.2.179"

README_NOUVEAU = "/home/z/my-project/download/servicerh-readme-technique-v0.2.179.pdf"
FICHIERS_REMPLACES = {
    "scripts/portail-server.js":            "/home/z/my-project/scripts/portail-server.js",
    "scripts/classification-reponses.js":   "/home/z/my-project/scripts/classification-reponses.js",
    "scripts/document-acceptation.js":      "/home/z/my-project/scripts/document-acceptation.js",
    "scripts/test_task178_classification.js": "/home/z/my-project/scripts/test_task178_classification.js",
}
NOUVEAUX = {
    "scripts/test_v02179_reponse_auto_pdf.js": "/home/z/my-project/scripts/test_v02179_reponse_auto_pdf.js",
    "scripts/construire-zip-v02179.py":        "/home/z/my-project/scripts/construire-zip-v02179.py",
}
SUPPRIMES = {
    "CHIFFRER-FICHES-SILENCIEUX-WINDOWS.vbs",  # demande utilisateur — jamais livré à partir de la 179
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
            if n in SUPPRIMES:
                continue  # VBS chiffrer-fiches-silencieux retiré (v0.2.179)
            if n in FICHIERS_REMPLACES:
                out.write(FICHIERS_REMPLACES[n], n)  # version v0.2.179 de l'arbre
                continue
            if n == "auto-rh-readme-technique.pdf":
                out.write(README_NOUVEAU, n)  # édition essentielle v0.2.179
                continue
            if n == "servicerh-readme-technique-reduit.pdf" and mode == "COMPLET":
                out.write(README_NOUVEAU, n)
                continue
            out.writestr(n, ref.read(n))
        for arc, src in NOUVEAUX.items():
            out.write(src, arc)
        out.writestr("VERSION", "0.2.179\n")
    ref.close()
    # MANIFEST régénéré
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
    classif = zf.read("scripts/classification-reponses.js").decode("utf-8", "replace")
    docacc = zf.read("scripts/document-acceptation.js").decode("utf-8", "replace")
    verifs = {
        "testzip": bad is None,
        "VERSION 0.2.179": zf.read("VERSION").decode().strip() == "0.2.179",
        "README = édition essentielle (V0.2.179)": "V0.2.179" in sans_esp,
        "README = durée du projet présente": ("Duréeduprojet" in sans_esp and "30jours" in sans_esp
                                              and "179versions" in sans_esp),
        "README = désactivation documentée": ("RéponseautomatiquePDFdésactivée" in sans_esp
                                              and "desactivee" in sans_esp),
        "README = parrainage par e-mail documenté": "Parrainagepare-mail" in sans_esp,
        "README = cadre vert masqué documenté": "cadrevert" in sans_esp or "Cadrevert" in sans_esp,
        "README = 9 pages": len(lecteur.pages) == 9,
        "README octets = fichier dev": contenu_readme == open(README_NOUVEAU, "rb").read(),
        # ---- NOUVEAU v0.2.179 : désactivation de la réponse automatique PDF ----
        "portail = garde-fou sansReponseAutoPdf": "const sansReponseAutoPdf" in portail
          and 'demande.type === "ATTESTATION_TRAVAIL"' in portail
          and 'demande.type === "ATTESTATION_SALAIRE"' in portail
          and 'demande.type === "PARRAINAGE"' in portail,
        "portail = génération PDF protégée (!sansReponseAutoPdf)":
          "if (decisionApplicable && !sansReponseAutoPdf &&" in portail,
        "portail = branche réponse DÉSACTIVÉE (trace)": "réponse automatique PDF DÉSACTIVÉE" in portail
          and 'reponseAutoPdf: decisionApplicable && sansReponseAutoPdf' in portail
          and '"desactivee"' in portail,
        "portail = 1 seul appel doc-acceptation (protégé)":
          portail.count("await traiterDocumentSigneAcceptation(") == 1,
        "portail = 1 seul appel doc-refus (protégé)":
          portail.count("await traiterDocumentRefusDecision(") == 1,
        # ---- v0.2.178 conservé : parrainage + cadre vert + confidentialité ----
        "portail = PARRAINAGE dans TYPES_CLASSIFICATION_AUTO": '"PARRAINAGE"' in portail.split("TYPES_CLASSIFICATION_AUTO = [")[1].split("]")[0],
        "portail = branche décision unique parrainage": "demande.type === \"PARRAINAGE\"" in portail
                                                         and "Service parrainage (réponse e-mail)" in portail,
        "portail = refuseePar PARRAINAGE": 'maj.refuseePar = "PARRAINAGE"' in portail,
        "portail = barre d'étapes SUPPRIMÉE (cadre vert)": 'class="d-etapes"' not in portail and ".d-etapes" not in portail,
        "portail = note + decisionMasquee conservés": "decisionMasquee" in portail
                                                       and "Décision finale communiquée après les réponses du manager et du service RH" in portail,
        "portail = routage parrainage DÉCHIFFRÉ (correctif)": "dechiffrerAdresse(cfg.parrainageEmail)" in portail,
        "portail = mention Auto-RH conservée": portail.count("Auto-RH") >= 25,
        "portail = magic/sels intacts": ("PAIESAGE1" in portail and "autorh-signature-v1" in portail),
        "classificateur = participes sujet + garde": "sujetPorteParticipe" in classif
                                                      and "REGEX_SUJET_TRANSMISSION" in classif,
        "document-acceptation = parrainage PDF": "'PARRAINAGE'" in docacc.split("TYPES_DOCUMENT_SIGNE =")[1].split(";")[0]
                                                  and "Acceptation_parrainage_" in docacc,
        "test désactivation 179 embarqué": "scripts/test_v02179_reponse_auto_pdf.js" in noms,
        "générateur readme 179 embarqué": "scripts/creer_readme_essentiel_v02178.py" in noms,
        "packaging 179 embarqué": "scripts/construire-zip-v02179.py" in noms,
        "test E2E 178 conservé": "scripts/test_v02178_parrainage_email.js" in noms,
        "test classificateur 178 conservé": "scripts/test_task178_classification.js" in noms,
        "test 177 conservé": "scripts/test_v02177_confidentialite_portail.js" in noms,
        "route upload présente": "src/app/api/payslips/upload/route.ts" in noms,
        "test 405 embarqué": "scripts/test_correctif_405_upload.js" in noms,
        "reduit présent": "servicerh-readme-technique-reduit.pdf" in noms or mode == "LEGER",
        "VBS chiffrer-fiches-silencieux RETIRÉ": not any("CHIFFRER-FICHES-SILENCIEUX" in n for n in noms),
        "0 lanceur supprimé": not any(x in noms for x in (
            "DEMARRER-WINDOWS.bat", "DEMARRER-TOUT-WINDOWS.bat",
            "DEMARRER-PORTAIL-WINDOWS.bat", "SCINDER-DOCX-WINDOWS.bat",
            "SCINDER-EXCEL-WINDOWS.bat", "SCINDER-FICHES-WINDOWS.bat",
            "SECURISER-DOSSIER-WINDOWS.bat", "SECURISER-DOSSIERS-WINDOWS.bat")),
        "0 artefact formation": not any("formation" in n for n in noms),
        "0 PDF v0.2.178 restant": not any("-v0.2.178.pdf" in n for n in noms),
    }
    zf.close()
    return verifs


def main():
    print("=== Construction v0.2.179 (réponse automatique PDF désactivée — attestations + parrainage) ===\n")
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
