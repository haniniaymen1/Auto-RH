#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Construit les ZIP de livraison v0.2.184 (Auto-RH) — PIÈCES JOINTES DU
MANAGER ET DES RH AVEC LES RÉPONSES CONGÉ / AUTORISATION DE SORTIE (demande
utilisateur du 11/10/2026) :

  - COMPLET : auto-rh-scripts-site-web-v0.2.184.zip
  - LEGER   : auto-rh-scripts-site-web-v0.2.184-leger.zip

Base : ZIP v0.2.183 (MD5 f461ed92fb1e42234c2dc3c7bf6c2346).
Changements :
  1) portail-server.js (v0.2.184) :
     a) PORTAIL EMPLOYÉ — le bloc decisionMasquee (API /api/mes-demandes) ne
        vide PLUS documentsVu : TOUTES les pièces jointes existantes
        (origine + reçues des décideurs) restent VISIBLES et CONSULTABLES à
        chaque étape ; la règle v0.2.177 reste appliquée à la DÉCISION seule ;
     b) ÉTAPE INTERMÉDIAIRE — bloc (NOUVEAU v0.2.184) dans traiterMessageRecu :
        décision reconnue + matrice non achevée (EN_ATTENTE) + pièces jointes
        → notification neutre « document disponible » à l'employé avec les
        documents EN PIÈCES JOINTES (formulation sans acteur ni décision,
        contexte « etape-intermediaire », trace notificationEtapeIntermediaire) ;
     c) DÉCISION FINALE inchangée (v0.2.171 : toutes les PJs + PDF signé) ;
     d) attestations + parrainage inchangés (v0.2.179/180/182).
     Preuve : scripts/test_v02184_pj_conge_autorisation.js — 61 OK / 0 FAIL
     (dont simulations exécutées) + non-régression 133+23+21+144+63
     — 445 contrôles, 0 échec ;
  2) README : ÉDITION ESSENTIELLE v0.2.184 (11 pages — puce « Pièces jointes
     du manager et des RH à toutes les étapes (v0.2.184) », puce
     confidentialité v0.2.177 complétée, durée 184 versions) ;
  3) test v0.2.184 + générateur README v0.2.184 + constructeur ZIP v0.2.184
     embarqués ; test v0.2.182 mis à jour (ternaire transmetteur à 3
     branches — 63 contrôles) ;
  4) VERSION = 0.2.184, MANIFEST-LIVRAISON.txt régénéré.

Intégrité vérifiée (testzip) + contrôles + MD5 affichés.
"""
import os, zipfile, hashlib, shutil

REF_COMPLET = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.183.zip"
REF_LEGER   = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.183-leger.zip"
SORTIE      = "/home/z/my-project/download"
VERSION     = "v0.2.184"

README_NOUVEAU = "/home/z/my-project/download/servicerh-readme-technique-v0.2.184.pdf"
FICHIERS_REMPLACES = {
    "scripts/portail-server.js":            "/home/z/my-project/scripts/portail-server.js",
    "scripts/test_v02182_pj_parrainage.js": "/home/z/my-project/scripts/test_v02182_pj_parrainage.js",
}
NOUVEAUX = {
    "scripts/test_v02184_pj_conge_autorisation.js": "/home/z/my-project/scripts/test_v02184_pj_conge_autorisation.js",
    "scripts/creer_readme_essentiel_v02184.py": "/home/z/my-project/scripts/creer_readme_essentiel_v02184.py",
    "scripts/construire-zip-v02184.py":     "/home/z/my-project/scripts/construire-zip-v02184.py",
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
                out.write(README_NOUVEAU, n)  # édition essentielle v0.2.184
                continue
            if n == "servicerh-readme-technique-reduit.pdf" and mode == "COMPLET":
                out.write(README_NOUVEAU, n)
                continue
            out.writestr(n, ref.read(n))
        for arc, src in NOUVEAUX.items():
            out.write(src, arc)
        out.writestr("VERSION", "0.2.184\n")
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
    # bloc decisionMasquee de l'API employé (extraction comme dans le test 184)
    iB = portail.find("if (decisionMasquee) {")
    blocMasque = ""
    if iB >= 0:
        jB = portail.find("\n        }", iB)
        if jB > iB:
            blocMasque = portail[iB:jB]
    verifs = {
        "testzip": bad is None,
        "VERSION 0.2.184": zf.read("VERSION").decode().strip() == "0.2.184",
        # ---- NOUVEAU v0.2.184 : README ----
        "README = édition essentielle (V0.2.184)": "V0.2.184" in sans_esp,
        "README = durée du projet (184 versions)": ("Duréeduprojet" in sans_esp and "30jours" in sans_esp
                                                    and "184versions" in sans_esp),
        "README = puce « Pièces jointes du manager et des RH à toutes les étapes »":
          "PiècesjointesdumanageretdesRHàtouteslesétapes" in sans_esp,
        "README = notification intermédiaire (notificationEtapeIntermediaire)":
          "notificationEtapeIntermediaire" in sans_esp,
        "README = formulation neutre (« transmis avec la réponse à votre demande »)":
          "Document(s)transmisaveclaréponseàvotredemande" in sans_esp,
        "README = « Elle poursuit son circuit de validation habituel »":
          "Ellepoursuitsoncircuitdevalidationhabituel" in sans_esp,
        "README = 445 contrôles cités": "445contrôles" in sans_esp,
        "README = Tableau 2.1 expressions conservé (v0.2.183)":
          ("Tableau2.1" in sans_esp and "Expressionsdedécisionreconnuesparréponsee-mail" in sans_esp),
        "README = 11 pages": len(lecteur.pages) == 11,
        # ---- portail : v0.2.184 — étape intermédiaire ----
        "portail = bloc (NOUVEAU v0.2.184) ÉTAPE INTERMÉDIAIRE présent":
          "(NOUVEAU v0.2.184 — DEMANDE UTILISATEUR) ÉTAPE INTERMÉDIAIRE" in portail,
        "portail = condition d'envoi (PJs + statut non final + garde 179)":
          'if (!sansReponseAutoPdf && importes.length &&\n        statutApres !== "ACCEPTEE" && statutApres !== "REFUSEE") {' in portail,
        "portail = notification « document disponible » avec contexte étape-intermediaire":
          'cfgMail, "etape-intermediaire")' in portail,
        "portail = formulation neutre « transmis avec la réponse à votre demande »":
          '"Document(s) transmis avec la réponse à votre demande"' in portail,
        "portail = phrase neutre « poursuit son circuit de validation habituel »":
          "Elle poursuit son circuit de validation habituel." in portail,
        "portail = journal notificationEtapeIntermediaire":
          "notificationEtapeIntermediaire: notificationEtapeIntermediaire," in portail,
        # ---- portail : v0.2.184 — PJs visibles à toutes les étapes ----
        "portail = API employé : bloc decisionMasquee NE vide PLUS documentsVu":
          blocMasque != "" and "documentsVu = []" not in blocMasque,
        "portail = API employé : décision toujours masquée (statutVu EN_ATTENTE)":
          blocMasque != "" and 'statutVu = "EN_ATTENTE"' in blocMasque,
        "portail = garde v0.2.177 inchangée (deuxEtapesDem && EN_ATTENTE)":
          'const decisionMasquee = deuxEtapesDem && d.statut === "EN_ATTENTE";' in portail,
        # ---- portail : chemin final v0.2.171 inchangé ----
        "portail = agrégation PJs avant l'e-mail de décision (v0.2.171)":
          "piecesReponsesEmploye = await piecesJointesReponsesPourEmploye(demande, importes);" in portail,
        "portail = PJs antérieures (recuDe @) agrégées":
          'where: { demandeId: demande.id, recuDe: { contains: "@" } },' in portail,
        "portail = PDF signé joint à la réponse finale":
          "pieceJointe: docFinal && docFinal.pieceJointe ? docFinal.pieceJointe : null," in portail,
        "portail = génération PDF aux statuts FINAUX seulement":
          'if (decisionApplicable && !sansReponseAutoPdf && (statutApres === "ACCEPTEE" || statutApres === "REFUSEE")) {' in portail,
        # ---- v0.2.182 conservé : documents du responsable — parrainage ----
        "portail = auteur parrainage « Le responsable de votre demande »":
          '? "Le responsable de votre demande"' in portail,
        "portail = phrase parrainage « traitée par le responsable concerné »":
          "Votre demande de parrainage a été traitée par le responsable concerné" in portail,
        "portail = attestation : auteur conservé « Le service RH »":
          '? "Le responsable de votre demande"' in portail and ': "Le service RH";' in portail,
        "portail = parrainage doc-disponible conservé":
          '"Document(s) transmis par le responsable de votre demande"' in portail,
        "portail = document disponible : « service RH » conservé pour les autres cas":
          '"Document(s) transmis par le service RH"' in portail,
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
        "test PJ congé/autorisation 184 embarqué": "scripts/test_v02184_pj_conge_autorisation.js" in noms,
        "générateur README 184 embarqué": "scripts/creer_readme_essentiel_v02184.py" in noms,
        "constructeur ZIP 184 embarqué": "scripts/construire-zip-v02184.py" in noms,
        "test PJ parrainage 182 (MAJ 3 branches) embarqué": "scripts/test_v02182_pj_parrainage.js" in noms,
        "test expressions 181 embarqué": "scripts/test_v02181_expressions_attestations_parrainage.js" in noms,
        "test PJ décision 180 embarqué": "scripts/test_v02180_pj_decision_rh.js" in noms,
        "test 179 conservé": "scripts/test_v02179_reponse_auto_pdf.js" in noms,
        "test E2E 178 conservé": "scripts/test_v02178_parrainage_email.js" in noms,
        "route upload présente": "src/app/api/payslips/upload/route.ts" in noms,
        "test 405 embarqué": "scripts/test_correctif_405_upload.js" in noms,
        "reduit présent": "servicerh-readme-technique-reduit.pdf" in noms or mode == "LEGER",
        "VBS chiffrer-fiches-silencieux ABSENT": not any("CHIFFRER-FICHES-SILENCIEUX" in n for n in noms),
        "0 PDF v0.2.183 restant": not any("-v0.2.183.pdf" in n for n in noms),
        "0 lanceur supprimé": not any(x in noms for x in (
            "DEMARRER-WINDOWS.bat", "DEMARRER-TOUT-WINDOWS.bat",
            "DEMARRER-PORTAIL-WINDOWS.bat", "SCINDER-DOCX-WINDOWS.bat",
            "SCINDER-EXCEL-WINDOWS.bat", "SCINDER-FICHES-WINDOWS.bat",
            "SECURISER-DOSSIER-WINDOWS.bat", "SECURISER-DOSSIERS-WINDOWS.bat")),
    }
    zf.close()
    return verifs


def main():
    print("=== Construction v0.2.184 (PJs du manager et des RH — congé/autorisation) ===\n")
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
