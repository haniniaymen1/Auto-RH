#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Construit les ZIP de livraison v0.2.183 (Auto-RH) — EXPRESSIONS DE DÉCISION
DANS LE README PDF (demande utilisateur du 11/10/2026 : « Ajouter ceci dans
readme pdf ») :

  - COMPLET : auto-rh-scripts-site-web-v0.2.183.zip
  - LEGER   : auto-rh-scripts-site-web-v0.2.183-leger.zip

Base : ZIP v0.2.182 (contenu vérifié : VERSION 0.2.182, README V0.2.182
10 pages, portail formulations v0.2.182 présentes, testzip OK).
Changements :
  1) AUCUN changement de code : portail-server.js et classification-
     reponses.js ré-embarqués À L'IDENTIQUE (le moteur des expressions est
     inchangé — preuve v0.2.181 : 144 contrôles, 0 échec) ;
  2) README : ÉDITION ESSENTIELLE v0.2.183 (11 pages) — la liste complète
     des expressions de décision reconnues par réponse e-mail figure dans
     un TABLEAU DÉDIÉ de la section 2 (Tableau 2.1) : acceptation
     « J'accepte votre demande » / « J'accepte », « OK », « D'accord »,
     « Je valide », « J'approuve », « Je vous accorde », mots seuls
     « Acceptée », « Validée », « Approuvée », « Accordée », « Délivrée » ;
     refus « Je refuse », « Refus », « Non », « Désaccord », « Pas
     d'accord », « Hors de question », mot seul « Refusée » ; négations
     naturelles « Je ne valide pas », « Je n'accepte pas », « Je ne peux
     pas accepter » → REFUS. Historique récent complété (179 → 183) ;
  3) générateur README v0.2.183 + constructeur ZIP v0.2.183 embarqués ;
  4) VERSION = 0.2.183, MANIFEST-LIVRAISON.txt régénéré.

Intégrité vérifiée (testzip) + contrôles + MD5 affichés.
"""
import os, zipfile, hashlib, shutil

REF_COMPLET = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.182.zip"
REF_LEGER   = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.182-leger.zip"
SORTIE      = "/home/z/my-project/download"
VERSION     = "v0.2.183"

README_NOUVEAU = "/home/z/my-project/download/servicerh-readme-technique-v0.2.183.pdf"
FICHIERS_REMPLACES = {
    "scripts/portail-server.js":            "/home/z/my-project/scripts/portail-server.js",
}
NOUVEAUX = {
    "scripts/creer_readme_essentiel_v02183.py": "/home/z/my-project/scripts/creer_readme_essentiel_v02183.py",
    "scripts/construire-zip-v02183.py":     "/home/z/my-project/scripts/construire-zip-v02183.py",
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
                out.write(README_NOUVEAU, n)  # édition essentielle v0.2.183
                continue
            if n == "servicerh-readme-technique-reduit.pdf" and mode == "COMPLET":
                out.write(README_NOUVEAU, n)
                continue
            out.writestr(n, ref.read(n))
        for arc, src in NOUVEAUX.items():
            out.write(src, arc)
        out.writestr("VERSION", "0.2.183\n")
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
        "VERSION 0.2.183": zf.read("VERSION").decode().strip() == "0.2.183",
        # ---- NOUVEAU v0.2.183 : README avec le Tableau 2.1 des expressions ----
        "README = édition essentielle (V0.2.183)": "V0.2.183" in sans_esp,
        "README = durée du projet (183 versions)": ("Duréeduprojet" in sans_esp and "30jours" in sans_esp
                                                    and "183versions" in sans_esp),
        "README = Tableau 2.1 « Expressions de décision reconnues par réponse e-mail »":
          ("Tableau2.1" in sans_esp and "Expressionsdedécisionreconnuesparréponsee-mail" in sans_esp),
        "README = acceptation : 7 formulations + 5 mots seuls":
          all(m in sans_esp for m in ("J'acceptevotredemande", "J'approuve", "Jevousaccorde",
                                      "Validée", "Approuvée", "Accordée", "Délivrée")),
        "README = refus : 6 formulations + mot seul « Refusée »":
          all(m in sans_esp for m in ("Jerefuse", "Désaccord", "Pasd'accord", "Horsdequestion", "Refusée")),
        "README = négations naturelles → refus (3)":
          all(m in sans_esp for m in ("Jenevalidepas", "Jen'acceptepas", "Jenepeuxpasaccepter",
                                      "négationsnaturellescomptantcommerefus")),
        "README = tolérances (casse/accents/ponctuation, objet seul, priorité au refus)":
          all(m in sans_esp for m in ("PRIORITÉaurefus", "OBJETseul")),
        "README = historique récent complété (179 → 183)":
          all(m in sans_esp for m in ("v0.2.179", "v0.2.180", "v0.2.181", "v0.2.182", "v0.2.183")),
        # ---- v0.2.182 conservé : documents du responsable — parrainage ----
        "README = puce « Documents du responsable avec la décision de parrainage (v0.2.182) »":
          "Documentsduresponsableavec ladécisiondeparrainage".replace(" ", "") in sans_esp.replace(" ", ""),
        "README = « Le responsable de votre demande »": "Leresponsabledevotredemande" in sans_esp,
        "README = « traitée par le responsable concerné »": "traitéeparleresponsableconcerné" in sans_esp,
        "README = 62 contrôles cités": "62contrôles" in sans_esp,
        "README = 144 contrôles cités (v0.2.181)": "144contrôles" in sans_esp,
        "README = transmission PJs 180 conservée": ("PiècesjointesduRH" in sans_esp and "documentsRhTransmis" in sans_esp),
        "README = désactivation 179 conservée": "RéponseautomatiquePDFdésactivée" in sans_esp,
        "README = 11 pages": len(lecteur.pages) == 11,
        # ---- portail : formulation parrainage v0.2.182 (code inchangé) ----
        "portail = auteur parrainage « Le responsable de votre demande »":
          '? "Le responsable de votre demande"' in portail,
        "portail = phrase parrainage « traitée par le responsable concerné »":
          "Votre demande de parrainage a été traitée par le responsable concerné" in portail,
        "portail = attestation : auteur conservé « Le service RH »":
          '? "Le responsable de votre demande"' in portail and ': "Le service RH";' in portail,
        "portail = document disponible : « transmis par le responsable de votre demande »":
          '? "Document(s) transmis par le responsable de votre demande"' in portail,
        "portail = document disponible : « service RH » conservé pour les autres types":
          ': "Document(s) transmis par le service RH";' in portail,
        # ---- v0.2.181 conservé : classification des expressions (moteur inchangé) ----
        "classification = acceptation « j accepte », « ok », « d accord », « je valide »":
          all(m in classif for m in ('"j accepte"', '"ok"', '"d accord"', '"je valide"')),
        "classification = refus « je refuse », « hors de question » + négations":
          all(m in classif for m in ('"je refuse"', '"hors de question"', "je ne peux pas accepter")),
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
        # ---- embarqués ----
        "générateur README 183 embarqué": "scripts/creer_readme_essentiel_v02183.py" in noms,
        "constructeur ZIP 183 embarqué": "scripts/construire-zip-v02183.py" in noms,
        "test PJ parrainage 182 embarqué": "scripts/test_v02182_pj_parrainage.js" in noms,
        "test expressions 181 embarqué": "scripts/test_v02181_expressions_attestations_parrainage.js" in noms,
        "test PJ décision 180 embarqué": "scripts/test_v02180_pj_decision_rh.js" in noms,
        "test 179 conservé": "scripts/test_v02179_reponse_auto_pdf.js" in noms,
        "test E2E 178 conservé": "scripts/test_v02178_parrainage_email.js" in noms,
        "route upload présente": "src/app/api/payslips/upload/route.ts" in noms,
        "test 405 embarqué": "scripts/test_correctif_405_upload.js" in noms,
        "reduit présent": "servicerh-readme-technique-reduit.pdf" in noms or mode == "LEGER",
        "VBS chiffrer-fiches-silencieux ABSENT": not any("CHIFFRER-FICHES-SILENCIEUX" in n for n in noms),
        "0 PDF v0.2.182 restant": not any("-v0.2.182.pdf" in n for n in noms),
        "0 lanceur supprimé": not any(x in noms for x in (
            "DEMARRER-WINDOWS.bat", "DEMARRER-TOUT-WINDOWS.bat",
            "DEMARRER-PORTAIL-WINDOWS.bat", "SCINDER-DOCX-WINDOWS.bat",
            "SCINDER-EXCEL-WINDOWS.bat", "SCINDER-FICHES-WINDOWS.bat",
            "SECURISER-DOSSIER-WINDOWS.bat", "SECURISER-DOSSIERS-WINDOWS.bat")),
    }
    zf.close()
    return verifs


def main():
    print("=== Construction v0.2.183 (expressions de décision dans le README PDF) ===\n")
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
