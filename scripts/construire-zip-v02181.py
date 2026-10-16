#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Construit les ZIP de livraison v0.2.181 (Auto-RH) — EXPRESSIONS RECONNUES
POUR LES ATTESTATIONS ET LE PARRAINAGE (demande utilisateur du 11/10/2026) :

  - COMPLET : auto-rh-scripts-site-web-v0.2.181.zip
  - LEGER   : auto-rh-scripts-site-web-v0.2.181-leger.zip

Base : ZIP v0.2.180 (MD5 e3a664d7e8a68eef596bc0e0bb4b5350).
Changements :
  1) AUCUN changement de code — constaté et PROUVÉ : la classification
     automatique des réponses e-mail s'applique déjà aux demandes
     d'ATTESTATION DE TRAVAIL, d'ATTESTATION DE SALAIRE et de PARRAINAGE
     (TYPES_CLASSIFICATION_AUTO, v0.2.162 + v0.2.178) et reconnaît TOUTES
     les expressions demandées :
       acceptation : « J'accepte votre demande » / « J'accepte », « OK »,
         « D'accord », « Je valide », « J'approuve », « Je vous accorde »,
         mots seuls « Acceptée », « Validée », « Approuvée », « Accordée »,
         « Délivrée » ;
       refus : « Je refuse », « Refus », « Non », « Désaccord »,
         « Pas d'accord », « Hors de question », mot seul « Refusée »,
         négations « Je ne valide pas », « Je n'accepte pas »,
         « Je ne peux pas accepter ».
     Preuve : scripts/test_v02181_expressions_attestations_parrainage.js —
     144 OK / 0 FAIL (22 expressions × 3 types, objet seul, citation Gmail
     réelle, tolérances, gardes anti-faux positifs) ;
  2) README : ÉDITION ESSENTIELLE v0.2.181 (10 pages — puce « Expressions
     reconnues pour les attestations et le parrainage (v0.2.181) », durée
     181 versions) ;
  3) tests v0.2.181 embarqués : test_v02181_expressions_attestations_
     parrainage.js (144 contrôles) + construire-zip-v02181.py ;
  4) VERSION = 0.2.181, MANIFEST-LIVRAISON.txt régénéré.

Intégrité vérifiée (testzip) + contrôles + MD5 affichés.
"""
import os, zipfile, hashlib, shutil

REF_COMPLET = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.180.zip"
REF_LEGER   = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.180-leger.zip"
SORTIE      = "/home/z/my-project/download"
VERSION     = "v0.2.181"

README_NOUVEAU = "/home/z/my-project/download/servicerh-readme-technique-v0.2.181.pdf"
FICHIERS_REMPLACES = {
    "scripts/portail-server.js":            "/home/z/my-project/scripts/portail-server.js",
    "scripts/test_v02179_reponse_auto_pdf.js": "/home/z/my-project/scripts/test_v02179_reponse_auto_pdf.js",
}
NOUVEAUX = {
    "scripts/test_v02181_expressions_attestations_parrainage.js":
        "/home/z/my-project/scripts/test_v02181_expressions_attestations_parrainage.js",
    "scripts/creer_readme_essentiel_v02181.py": "/home/z/my-project/scripts/creer_readme_essentiel_v02181.py",
    "scripts/construire-zip-v02181.py":      "/home/z/my-project/scripts/construire-zip-v02181.py",
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
                out.write(FICHIERS_REMPLACES[n], n)  # version de l'arbre
                continue
            if n == "auto-rh-readme-technique.pdf":
                out.write(README_NOUVEAU, n)  # édition essentielle v0.2.181
                continue
            if n == "servicerh-readme-technique-reduit.pdf" and mode == "COMPLET":
                out.write(README_NOUVEAU, n)
                continue
            out.writestr(n, ref.read(n))
        for arc, src in NOUVEAUX.items():
            out.write(src, arc)
        out.writestr("VERSION", "0.2.181\n")
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
    classif = zf.read("scripts/classification-reponses.js").decode("utf-8", "replace")
    verifs = {
        "testzip": bad is None,
        "VERSION 0.2.181": zf.read("VERSION").decode().strip() == "0.2.181",
        "README = édition essentielle (V0.2.181)": "V0.2.181" in sans_esp,
        "README = durée du projet (181 versions)": ("Duréeduprojet" in sans_esp and "30jours" in sans_esp
                                                    and "181versions" in sans_esp),
        "README = expressions attestations/parrainage documentées (v0.2.181)":
          "Expressionsreconnuespourlesattestationsetleparrainage" in sans_esp,
        "README = 144 contrôles cités": "144contrôles" in sans_esp,
        "README = transmission PJs 180 conservée": ("PiècesjointesduRH" in sans_esp and "documentsRhTransmis" in sans_esp),
        "README = désactivation 179 conservée": "RéponseautomatiquePDFdésactivée" in sans_esp,
        "README = 10 pages": len(lecteur.pages) == 10,
        # ---- NOUVEAU v0.2.181 : expressions reconnues pour les 3 types ----
        "classification = TYPES_CLASSIFICATION_AUTO (commentaire attestations + parrainage)":
          classif.count("Attestation de travail") >= 1 and "PARRAINAGE" in portail,
        "classification = acceptation « j accepte » (J'accepte / J'accepte votre demande)":
          '"j accepte"' in classif and '"accepte votre demande"' in classif,
        "classification = acceptation « ok », « d accord », « je valide », « j approuve », « je vous accorde »":
          all(m in classif for m in ('"ok"', '"d accord"', '"je valide"', '"j approuve"', '"je vous accorde"')),
        "classification = mots seuls acceptation (Acceptée/Validée/Approuvée/Accordée/Délivrée)":
          all(m in classif for m in ('"acceptee"', '"validee"', '"approuvee"', '"accordee"', '"delivree"')),
        "classification = refus « je refuse », « refus », « non », « desaccord », « pas d accord », « hors de question »":
          all(m in classif for m in ('"je refuse"', '"refus"', '"non"', '"desaccord"', '"pas d accord"', '"hors de question"')),
        "classification = mot seul refus « refusee »": '"refusee"' in classif,
        "classification = négations naturelles (Je ne valide pas / Je n'accepte pas / Je ne peux pas accepter)":
          all(m in classif for m in ("je ne valide pas", "je n accepte pas", "je ne peux pas accepter")),
        "portail = ATTESTATION_TRAVAIL/SALAIRE + PARRAINAGE dans TYPES_CLASSIFICATION_AUTO":
          all(t in portail.split("TYPES_CLASSIFICATION_AUTO = [")[1].split("]")[0]
              for t in ('"ATTESTATION_TRAVAIL"', '"ATTESTATION_SALAIRE"', '"PARRAINAGE"')),
        # ---- v0.2.180 conservé : transmission des PJs du RH avec la décision ----
        "portail = fonction envoyerEmailDecisionDocumentsRh": "async function envoyerEmailDecisionDocumentsRh(" in portail,
        "portail = pièces attachées à l'e-mail de décision": "attachments: pieces" in portail,
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
        "portail = branche décision unique parrainage": "Service parrainage (réponse e-mail)" in portail,
        "portail = cadre vert masqué": 'class="d-etapes"' not in portail and ".d-etapes" not in portail,
        "portail = confidentialité décision (decisionMasquee)": "decisionMasquee" in portail,
        "portail = magic/sels intacts": ("PAIESAGE1" in portail and "autorh-signature-v1" in portail),
        "test expressions 181 embarqué": "scripts/test_v02181_expressions_attestations_parrainage.js" in noms,
        "test PJ décision 180 embarqué": "scripts/test_v02180_pj_decision_rh.js" in noms,
        "test 179 conservé": "scripts/test_v02179_reponse_auto_pdf.js" in noms,
        "test E2E 178 conservé": "scripts/test_v02178_parrainage_email.js" in noms,
        "route upload présente": "src/app/api/payslips/upload/route.ts" in noms,
        "test 405 embarqué": "scripts/test_correctif_405_upload.js" in noms,
        "reduit présent": "servicerh-readme-technique-reduit.pdf" in noms or mode == "LEGER",
        "VBS chiffrer-fiches-silencieux ABSENT": not any("CHIFFRER-FICHES-SILENCIEUX" in n for n in noms),
        "0 PDF v0.2.180 restant": not any("-v0.2.180.pdf" in n for n in noms),
        "0 lanceur supprimé": not any(x in noms for x in (
            "DEMARRER-WINDOWS.bat", "DEMARRER-TOUT-WINDOWS.bat",
            "DEMARRER-PORTAIL-WINDOWS.bat", "SCINDER-DOCX-WINDOWS.bat",
            "SCINDER-EXCEL-WINDOWS.bat", "SCINDER-FICHES-WINDOWS.bat",
            "SECURISER-DOSSIER-WINDOWS.bat", "SECURISER-DOSSIERS-WINDOWS.bat")),
    }
    zf.close()
    return verifs


def main():
    print("=== Construction v0.2.181 (expressions attestations + parrainage) ===\n")
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
