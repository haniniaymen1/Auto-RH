#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Construit les ZIP de livraison v0.2.194 (Auto-RH) — BLOC D'IMPORT DU
FICHIER DE CERTIFICAT MASQUÉ POUR LE RÔLE RH (demande utilisateur du 13/10/2026 :
« masquer ce bloc pour le role rh dans la section importer et demande ») :

  - COMPLET : auto-rh-scripts-site-web-v0.2.194.zip
  - LEGER   : auto-rh-scripts-site-web-v0.2.194-leger.zip

Base : ZIP v0.2.193.
Changements :
  0) src/components/payslip/signature-panel-reponses.tsx (v0.2.194) — onglet
     « Demandes » : NOUVELLE prop `masquerCertificat` (pattern ReponsePdfPanel
     v0.2.186) — le bloc d'IMPORT du fichier de certificat (« Fichier de
     certificat de CETTE section », mot de passe PKCS#12, clé privée associée,
     notes d'attente/de retrait, avertissements « Aucun certificat DÉDIÉ
     importé » et « configuration pas encore enregistrée ») est MASQUÉ pour le
     rôle RH ; une note informative renvoie au superadministrateur ;
     l'interrupteur, le positionnement et les métadonnées restent visibles ;
  1) src/components/payslip/signature-panel.tsx (v0.2.194) — onglet
     « Importer » : même prop — le bloc d'import (« Fichier de signature
     électronique », mot de passe, clé privée, notes) est masqué pour le RH,
     note informative à la place ;
  2) src/components/payslip/demandes-tab.tsx + src/app/page.tsx +
     src/lib/page.tsx (v0.2.194) — les deux panneaux sont montés avec
     masquerCertificat={role === "RH"} / {me?.role === "RH"} (commentaires
     v0.2.194) ; SUPERADMIN conserve les blocs complets ;
  3) Modification d'AFFICHAGE seule : AUCUN changement serveur ni API (les
     routes d'import restaient gardées par la session) ; preuve navigateur
     réelle : RH — blocs absents dans les deux onglets + note affichée ;
     SUPERADMIN — blocs entiers conservés ; captures task194-*.png ;
     build production OK ; suites v0.2.190→193 relancées 0 échec ;
  4) README : ÉDITION ESSENTIELLE v0.2.194 (16 pages — puce « Certificat :
     bloc d'import masqué pour le rôle RH (v0.2.194) », Tableau 5.1 + ligne
     v0.2.194, couverture, 194 versions / 31 jours, marqueurs verifier) ;
  5) test scénario manager-off (v0.2.193, 29/29) + générateur/constructeur
     v0.2.194 embarqués ; VERSION = 0.2.194, MANIFEST-LIVRAISON.txt régénéré.

Intégrité vérifiée (testzip) + contrôles + MD5 affichés.
"""
import os, zipfile, hashlib, shutil

REF_COMPLET = "/tmp/my-project/download/auto-rh-scripts-site-web-v0.2.193.zip"
REF_LEGER   = "/tmp/my-project/download/auto-rh-scripts-site-web-v0.2.193-leger.zip"
SORTIE      = "/home/z/my-project/download"
VERSION     = "v0.2.194"

README_NOUVEAU = "/home/z/my-project/download/servicerh-readme-technique-v0.2.194.pdf"
FICHIERS_REMPLACES = {
    # (v0.2.194) interface : masquage du bloc d'import du certificat pour le RH
    "src/components/payslip/signature-panel-reponses.tsx": "/home/z/my-project/src/components/payslip/signature-panel-reponses.tsx",
    "src/components/payslip/signature-panel.tsx": "/home/z/my-project/src/components/payslip/signature-panel.tsx",
    "src/components/payslip/demandes-tab.tsx": "/home/z/my-project/src/components/payslip/demandes-tab.tsx",
    "src/app/page.tsx": "/home/z/my-project/src/app/page.tsx",
    "src/lib/page.tsx": "/home/z/my-project/src/lib/page.tsx",
    # (v0.2.193) tests ADAPTÉS + NOUVEAU test scénario (relancés — 0 échec)
    "scripts/test_v02193_notifications_toujours.js": "/home/z/my-project/scripts/test_v02193_notifications_toujours.js",
}
NOUVEAUX = {
    "scripts/transformer_readme_v02194.py": "/home/z/my-project/scripts/transformer_readme_v02194.py",
    "scripts/creer_readme_essentiel_v02194.py": "/home/z/my-project/scripts/creer_readme_essentiel_v02194.py",
    "scripts/construire-zip-v02194.py":       "/home/z/my-project/scripts/construire-zip-v02194.py",
    "scripts/test_v02193_scenario_manager_off_pieces.js": "/home/z/my-project/scripts/test_v02193_scenario_manager_off_pieces.js",
    "scripts/creer-rh-test.js": "/home/z/my-project/scripts/creer-rh-test.js",
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
                out.write(README_NOUVEAU, n)  # édition essentielle v0.2.194
                continue
            if n == "servicerh-readme-technique-reduit.pdf" and mode == "COMPLET":
                out.write(README_NOUVEAU, n)
                continue
            out.writestr(n, ref.read(n))
        for arc, src in NOUVEAUX.items():
            out.write(src, arc)
        out.writestr("VERSION", "0.2.194\n")
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
    # (v0.2.194) fichiers d'interface MODIFIÉS, lus depuis l'archive
    sp_reponses = zf.read("src/components/payslip/signature-panel-reponses.tsx").decode("utf-8", "replace")
    sp_import = zf.read("src/components/payslip/signature-panel.tsx").decode("utf-8", "replace")
    demandes_tab = zf.read("src/components/payslip/demandes-tab.tsx").decode("utf-8", "replace")
    page_app = zf.read("src/app/page.tsx").decode("utf-8", "replace")
    page_lib = zf.read("src/lib/page.tsx").decode("utf-8", "replace")
    panel = zf.read("src/components/payslip/reponse-pdf-panel.tsx").decode("utf-8", "replace")
    users_tab = zf.read("src/components/payslip/users-tab.tsx").decode("utf-8", "replace")
    acceptation_src = zf.read("scripts/document-acceptation.js").decode("utf-8", "replace")
    verifs = {
        "testzip": bad is None,
        "VERSION 0.2.194": zf.read("VERSION").decode().strip() == "0.2.194",
        # ---- NOUVEAU v0.2.194 : SignaturePanelReponses (onglet Demandes) ----
        "réponses = prop masquerCertificat (défaut false)":
          "masquerCertificat = false," in sp_reponses and "masquerCertificat?: boolean;" in sp_reponses,
        "réponses = garde {!masquerCertificat && (":
          sp_reponses.count("{!masquerCertificat && (") == 1,
        "réponses = bloc import SOUS la garde (Fichier de certificat de CETTE section conservé dans le source)":
          sp_reponses.find("{!masquerCertificat && (") > -1 and
          sp_reponses.find("Fichier de certificat de CETTE section", sp_reponses.find("{!masquerCertificat && (")) > -1 and
          sp_reponses.count("Fichier de certificat de CETTE section") >= 2,  # doc-comment + bloc gardé
        "réponses = note RH à la place (réservé au superadministrateur)":
          "L&apos;import du fichier de certificat (et de sa clé privée) est réservé au" in sp_reponses,
        "réponses = note : interrupteur et positionnement restent utilisables":
          "L&apos;interrupteur et le positionnement ci-dessus restent utilisables" in sp_reponses,
        "réponses = sous la garde : mot de passe PKCS#12 + clé privée + 2 avertissements":
          -1 < sp_reponses.find("Mot de passe du fichier PKCS#12 (.p12/.pfx)", sp_reponses.find("{!masquerCertificat && ("))
          and -1 < sp_reponses.find("Clé privée associée (.pem, .key, .der) — facultative", sp_reponses.find("{!masquerCertificat && ("))
          and -1 < sp_reponses.find("Aucun certificat DÉDIÉ importé : les réponses n&apos;apposent aucun bloc", sp_reponses.find("{!masquerCertificat && ("))
          and -1 < sp_reponses.find("Configuration des réponses pas encore enregistrée", sp_reponses.find("{!masquerCertificat && (")),
        "réponses = interrupteur + positionnement + métadonnées HORS garde (toujours visibles)":
          sp_reponses.find("Utiliser le certificat de signature sur les réponses") < sp_reponses.find("{!masquerCertificat && (")
          and sp_reponses.find("Certificat actuellement appliqué") > sp_reponses.rfind("Configuration des réponses pas encore enregistrée"),
        "réponses = doc-comment v0.2.194":
          "(v0.2.194 — demande « masquer ce bloc pour le rôle RH dans la section" in sp_reponses,
        # ---- NOUVEAU v0.2.194 : SignaturePanel (onglet Importer) ----
        "importer = prop masquerCertificat (défaut false)":
          "masquerCertificat = false," in sp_import and "masquerCertificat?: boolean;" in sp_import,
        "importer = garde {!masquerCertificat && (":
          sp_import.count("{!masquerCertificat && (") == 1,
        "importer = bloc import SOUS la garde (Fichier de signature électronique conservé dans le source)":
          -1 < sp_import.find("{!masquerCertificat && (") < sp_import.find("Fichier de signature électronique (mot de passe PKCS#12 pris en charge)"),
        "importer = note RH à la place":
          "L&apos;import du fichier de signature (et de sa clé privée) est réservé au" in sp_import,
        "importer = sous la garde : PKCS#12 + clé privée + notes retrait/attente":
          sp_import.find("Mot de passe du fichier PKCS#12 (.p12/.pfx)") > sp_import.find("{!masquerCertificat && (")
          and sp_import.find("Nouveau fichier en attente") > sp_import.find("{!masquerCertificat && ("),
        "importer = interrupteur + métadonnées HORS garde":
          sp_import.find("Utiliser le certificat de signature") < sp_import.find("{!masquerCertificat && (")
          and sp_import.find("Titulaire :</b>") > sp_import.rfind("Nouveau fichier en attente"),
        "importer = doc-comment v0.2.194":
          "(v0.2.194 — demande « masquer ce bloc pour le rôle RH dans la section" in sp_import,
        # ---- NOUVEAU v0.2.194 : points de montage ----
        "demandes-tab = <SignaturePanelReponses masquerCertificat={role === \"RH\"} />":
          '<SignaturePanelReponses masquerCertificat={role === "RH"} />' in demandes_tab,
        "demandes-tab = AUCUNE instanciation sans props de SignaturePanelReponses":
          "<SignaturePanelReponses />" not in demandes_tab,
        "demandes-tab = commentaire v0.2.194 présent":
          "(v0.2.194) Rôle RH : le bloc d'IMPORT du fichier de certificat" in demandes_tab,
        "demandes-tab = ReponsePdfPanel masquerCertificat conservé (héritage 186)":
          '<ReponsePdfPanel masquerCertificat={role === "RH"} />' in demandes_tab,
        "page app = <SignaturePanel masquerCertificat={me?.role === \"RH\"} />":
          '<SignaturePanel masquerCertificat={me?.role === "RH"} />' in page_app,
        "page app = AUCUNE instanciation sans props de SignaturePanel":
          "<SignaturePanel />" not in page_app,
        "page app = garde visibilité SUPERADMIN/RH conservée":
          '(me?.role === "SUPERADMIN" || me?.role === "RH") && (' in page_app,
        "page lib = <SignaturePanel masquerCertificat={me?.role === \"RH\"} /> (jumelle)":
          '<SignaturePanel masquerCertificat={me?.role === "RH"} />' in page_lib,
        "page lib = AUCUNE instanciation sans props de SignaturePanel":
          "<SignaturePanel />" not in page_lib,
        # ---- héritage v0.2.193 : notifications toujours envoyées ----
        "portail = drapeaux EFFECTIFS avecPdfDecision (maître ET interrupteur)":
          "const avecPdfDecision = {" in portail and
          "manager: emailActifDecision && envoyerManagerDecision," in portail,
        "portail = trace « notification TOUJOURS envoyée »":
          "notification TOUJOURS envoyée" in portail,
        "portail = ENVOI_DESACTIVE SUPPRIMÉ":
          'code: "ENVOI_DESACTIVE"' not in portail,
        "portail = Cc RH HISTORIQUE (plus AUCUN filtrage)":
          "if (rhAdresse) liste.push(rhAdresse);" in portail,
        "portail = SANS PDF disponible → drapeaux SANS EFFET":
          "(!pieceJointe ? true : (vouluAvecPdf ? avecPdf[k] : !avecPdf[k]))" in portail,
        "module acc. = destinataires TOUJOURS complets":
          "manager: ctx.emailManager || ''," in acceptation_src,
        "panneau 186 = héritage intact (masquerCertificat)":
          "masquerCertificat = false," in panel and "sont TOUJOURS envoyés" in panel,
        # ---- héritage v0.2.192 : boutons de gestion collants ----
        "interface 192 = colonne Actions COLLANTE (héritage)":
          "sticky right-0 z-10 bg-card text-right border-l border-border/60" in users_tab,
        # ---- README v0.2.194 ----
        "README = édition essentielle (V0.2.194, plus V0.2.193)":
          "V0.2.194" in sans_esp and "V0.2.193" not in sans_esp,
        "README = puce « Certificat : bloc d'import masqué pour le rôle RH (v0.2.194) »":
          "Certificat:blocd'importmasquépourlerôleRH(v0.2.194)" in sans_esp,
        "README = Tableau 5.1 ligne v0.2.194 (CERTIFICAT : IMPORT MASQUÉ POUR LE RH)":
          "CERTIFICAT:IMPORTMASQUÉPOURLERH" in sans_esp,
        "README = « Fichier de certificat de CETTE section » cité":
          "FichierdecertificatdeCETTEsection" in sans_esp,
        "README = « réservé au superadministrateur » cité":
          "réservéausuperadministrateur" in sans_esp,
        "README = « masquerCertificat » cité": "masquerCertificat" in sans_esp,
        "README = durée du projet (194 versions / 31 jours)":
          ("Duréeduprojet" in sans_esp and "31jours" in sans_esp and "194versions" in sans_esp),
        "README = sources v0.2.194 citées": "Codesourcelivrév0.2.194" in sans_esp,
        "README = héritage 193 (v0.2.193 cité)": "v0.2.193" in sans_esp,
        "README = héritage 186 (masquerCertificat + 60 contrôles)":
          "CertificatdédiémasquépourlerôleRH" in sans_esp and "60contrôles" in sans_esp,
        "README = héritage 193 (53/53 + ENVOI_DESACTIVE retiré)":
          "53/53" in sans_esp and "ENVOI_DESACTIVEretiré" in sans_esp,
        "README = 16 pages": len(lecteur.pages) == 16,
        # ---- embarqués ----
        "générateur README 194 embarqué": "scripts/creer_readme_essentiel_v02194.py" in noms,
        "transformateur README 194 embarqué": "scripts/transformer_readme_v02194.py" in noms,
        "constructeur ZIP 194 embarqué": "scripts/construire-zip-v02194.py" in noms,
        "test scénario manager-off (v0.2.193) embarqué": "scripts/test_v02193_scenario_manager_off_pieces.js" in noms,
        "créateur compte RH de test embarqué": "scripts/creer-rh-test.js" in noms,
        "test notifications 193 embarqué": "scripts/test_v02193_notifications_toujours.js" in noms,
        "transformateur README 193 embarqué": "scripts/transformer_readme_v02193.py" in noms,
        "générateur README 193 embarqué": "scripts/creer_readme_essentiel_v02193.py" in noms,
        "constructeur ZIP 193 embarqué": "scripts/construire-zip-v02193.py" in noms,
        "test interrupteurs 191 embarqué": "scripts/test_v02191_interrupteurs_email.js" in noms,
        "test interrupteurs 190 embarqué": "scripts/test_v02190_interrupteurs_destinataires.js" in noms,
        "test certificat dédié masqué 186 embarqué": "scripts/test_v02186_masquer_certificat_rh.js" in noms,
        "route upload présente": "src/app/api/payslips/upload/route.ts" in noms,
        "reduit présent": "servicerh-readme-technique-reduit.pdf" in noms or mode == "LEGER",
        "VBS chiffrer-fiches-silencieux ABSENT": not any("CHIFFRER-FICHES-SILENCIEUX" in n for n in noms),
        "0 PDF v0.2.186→193 restant": not any((s in n) for n in noms for s in ("-v0.2.186.pdf", "-v0.2.187.pdf", "-v0.2.188.pdf", "-v0.2.189.pdf", "-v0.2.190.pdf", "-v0.2.191.pdf", "-v0.2.192.pdf", "-v0.2.193.pdf")),
        "0 lanceur supprimé": not any(x in noms for x in (
            "DEMARRER-WINDOWS.bat", "DEMARRER-TOUT-WINDOWS.bat",
            "DEMARRER-PORTAIL-WINDOWS.bat", "SCINDER-DOCX-WINDOWS.bat",
            "SCINDER-EXCEL-WINDOWS.bat", "SCINDER-FICHES-WINDOWS.bat",
            "SECURISER-DOSSIER-WINDOWS.bat", "SECURISER-DOSSIERS-WINDOWS.bat")),
    }
    zf.close()
    return verifs


def main():
    print("=== Construction v0.2.194 (bloc d'import du certificat masqué pour le RH) ===\n")
    echecs_total = 0
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
        echecs_total += len(echecs)
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
    if echecs_total:
        raise SystemExit(f"{echecs_total} VÉRIFICATION(S) EN ÉCHEC")
    print("\nTOUTES LES VÉRIFICATIONS SONT PASSÉES.")


if __name__ == "__main__":
    main()
