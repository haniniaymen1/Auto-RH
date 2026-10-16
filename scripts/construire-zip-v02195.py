#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Construit les ZIP de livraison v0.2.195 (Auto-RH) — CARTE « DÉCISION
MANAGER » DU DÉTAIL DES DEMANDES MASQUÉE POUR LE RÔLE RH (demande utilisateur
du 13/10/2026 : « masquer cette partie dans cadre vert pour role rh dans les
demade conge et autorisation ») :

  - COMPLET : auto-rh-scripts-site-web-v0.2.195.zip
  - LEGER   : auto-rh-scripts-site-web-v0.2.195-leger.zip

Base : ZIP v0.2.194.
Changements :
  0) src/components/payslip/demandes-tab.tsx (v0.2.195) — onglet « Demandes » :
     dans le dialogue de détail des demandes à DEUX étapes (congé et
     autorisation de sortie), la CARTE « Décision Manager » (badge d'état +
     rangée « Enregistrer la décision du manager : Acceptée / Refusée ») est
     MASQUÉE pour le rôle RH (constante estRh + ternaire {estRh ? note : carte})
     ; une note discrète la remplace ; l'ÉTAT de la décision reste visible
     dans la boîte « ÉTAT ACTUEL » de la section « Décision RH » et dans la
     liste (badges « M : ») ; le SUPERADMIN conserve la carte ENTIÈRE ;
     commentaires v0.2.195 (en-tête + Task 181) ; AUCUN changement serveur ;
  1) preuve navigateur réelle : RH — carte absente + note affichée sur une
     demande de congé ET une autorisation de sortie, aucun bouton
     « Enregistrer la décision du manager » ; SUPERADMIN — carte entière
     conservée ; captures task195-rh-demande-conge.png /
     task195-rh-demande-autorisation.png / task195-superadmin-demande-conge.png
     ; build production OK ; suites v0.2.190→193 relancées : 232 contrôles,
     0 échec ;
  2) README : ÉDITION ESSENTIELLE v0.2.195 (17 pages — puce « Demandes : carte
     « Décision Manager » masquée pour le rôle RH (v0.2.195) », Tableau 5.1 +
     ligne v0.2.195, couverture, 195 versions / 31 jours, marqueurs verifier) ;
  3) générateur/constructeur v0.2.195 + scripts de préparation de la preuve
     (verif-etat-v02195.js, creer-demandes-test-v02195.js) embarqués ;
     VERSION = 0.2.195, MANIFEST-LIVRAISON.txt régénéré.

Intégrité vérifiée (testzip) + contrôles + MD5 affichés.
"""
import os, zipfile, hashlib, shutil

REF_COMPLET = "/tmp/my-project/download/auto-rh-scripts-site-web-v0.2.194.zip"
REF_LEGER   = "/tmp/my-project/download/auto-rh-scripts-site-web-v0.2.194-leger.zip"
SORTIE      = "/home/z/my-project/download"
VERSION     = "v0.2.195"

README_NOUVEAU = "/home/z/my-project/download/servicerh-readme-technique-v0.2.195.pdf"
FICHIERS_REMPLACES = {
    # (v0.2.195) interface : carte « Décision Manager » masquée pour le RH
    "src/components/payslip/demandes-tab.tsx": "/home/z/my-project/src/components/payslip/demandes-tab.tsx",
    # (v0.2.194) interface : bloc d'import du certificat masqué (réécrits à
    # l'identique depuis l'arbre — garantie d'exactitude)
    "src/components/payslip/signature-panel-reponses.tsx": "/home/z/my-project/src/components/payslip/signature-panel-reponses.tsx",
    "src/components/payslip/signature-panel.tsx": "/home/z/my-project/src/components/payslip/signature-panel.tsx",
    "src/app/page.tsx": "/home/z/my-project/src/app/page.tsx",
    "src/lib/page.tsx": "/home/z/my-project/src/lib/page.tsx",
    "scripts/test_v02193_notifications_toujours.js": "/home/z/my-project/scripts/test_v02193_notifications_toujours.js",
}
NOUVEAUX = {
    "scripts/transformer_readme_v02195.py": "/home/z/my-project/scripts/transformer_readme_v02195.py",
    "scripts/creer_readme_essentiel_v02195.py": "/home/z/my-project/scripts/creer_readme_essentiel_v02195.py",
    "scripts/construire-zip-v02195.py":       "/home/z/my-project/scripts/construire-zip-v02195.py",
    "scripts/verif-etat-v02195.js":           "/home/z/my-project/scripts/verif-etat-v02195.js",
    "scripts/creer-demandes-test-v02195.js":  "/home/z/my-project/scripts/creer-demandes-test-v02195.js",
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
                out.write(README_NOUVEAU, n)  # édition essentielle v0.2.195
                continue
            if n == "servicerh-readme-technique-reduit.pdf" and mode == "COMPLET":
                out.write(README_NOUVEAU, n)
                continue
            out.writestr(n, ref.read(n))
        for arc, src in NOUVEAUX.items():
            out.write(src, arc)
        out.writestr("VERSION", "0.2.195\n")
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
    # (v0.2.195) fichier d'interface MODIFIÉ, lu depuis l'archive
    demandes_tab = zf.read("src/components/payslip/demandes-tab.tsx").decode("utf-8", "replace")
    sp_reponses = zf.read("src/components/payslip/signature-panel-reponses.tsx").decode("utf-8", "replace")
    sp_import = zf.read("src/components/payslip/signature-panel.tsx").decode("utf-8", "replace")
    page_app = zf.read("src/app/page.tsx").decode("utf-8", "replace")
    page_lib = zf.read("src/lib/page.tsx").decode("utf-8", "replace")
    panel = zf.read("src/components/payslip/reponse-pdf-panel.tsx").decode("utf-8", "replace")
    users_tab = zf.read("src/components/payslip/users-tab.tsx").decode("utf-8", "replace")
    acceptation_src = zf.read("scripts/document-acceptation.js").decode("utf-8", "replace")
    pos_note = demandes_tab.find("{estRh ? (")
    pos_carte = demandes_tab.find(") : (", pos_note if pos_note > -1 else 0)
    verifs = {
        "testzip": bad is None,
        "VERSION 0.2.195": zf.read("VERSION").decode().strip() == "0.2.195",
        # ---- NOUVEAU v0.2.195 : carte « Décision Manager » masquée pour le RH ----
        "demandes-tab = constante estRh (role === \"RH\")":
          'const estRh = role === "RH";' in demandes_tab,
        "demandes-tab = ternaire {estRh ? note : carte}":
          pos_note > -1 and pos_carte > pos_note,
        "demandes-tab = note RH à la place (enregistrée par sa réponse e-mail)":
          "enregistrée par sa réponse" in demandes_tab and
          demandes_tab.find("enregistrée par sa réponse", pos_note) < pos_carte,
        "demandes-tab = carte « Décision Manager » DANS la branche superadmin":
          -1 < demandes_tab.find("Décision Manager</span>", pos_carte) and
          -1 < demandes_tab.find("Enregistrer la décision du manager", pos_carte),
        "demandes-tab = boutons traiter(ACCEPTEE/REFUSEE, manager) conservés (branche superadmin)":
          -1 < demandes_tab.find('traiter("ACCEPTEE", "manager")', pos_carte) and
          -1 < demandes_tab.find('traiter("REFUSEE", "manager")', pos_carte),
        "demandes-tab = cartes « Décision RH » et « Statut final » HORS ternaire (toujours visibles)":
          demandes_tab.find("Décision RH</span>") > demandes_tab.find(")}", pos_carte)
          and demandes_tab.find("Statut final</span>") > demandes_tab.find(")}", pos_carte),
        "demandes-tab = état manager conservé dans la section RH (ÉTAT ACTUEL)":
          "Décision Manager&nbsp;:</span>" in demandes_tab,
        "demandes-tab = badges liste « M : » conservés":
          "M&nbsp;: {libelleDecision(d.decisionManager)}" in demandes_tab,
        "demandes-tab = commentaire carte v0.2.195":
          "(v0.2.195 : carte MASQUÉE" in demandes_tab,
        "demandes-tab = en-tête v0.2.195 (carte MASQUÉE pour le rôle RH)":
          "carte « Décision Manager » du détail MASQUÉE pour le rôle" in demandes_tab,
        "demandes-tab = commentaire composant v0.2.195 (estRh)":
          "(NOUVEAU v0.2.195 — demande utilisateur) le rôle RH ne voit PAS la carte" in demandes_tab,
        # ---- héritage v0.2.194 : certificat masqué (5 fichiers) ----
        "réponses 194 = prop masquerCertificat + garde (héritage)":
          "masquerCertificat = false," in sp_reponses and sp_reponses.count("{!masquerCertificat && (") == 1,
        "importer 194 = prop masquerCertificat + garde (héritage)":
          "masquerCertificat = false," in sp_import and sp_import.count("{!masquerCertificat && (") == 1,
        "demandes-tab = <SignaturePanelReponses masquerCertificat={role === \"RH\"} /> (héritage 194)":
          '<SignaturePanelReponses masquerCertificat={role === "RH"} />' in demandes_tab,
        "demandes-tab = <ReponsePdfPanel masquerCertificat={role === \"RH\"} /> (héritage 186)":
          '<ReponsePdfPanel masquerCertificat={role === "RH"} />' in demandes_tab,
        "page app/lib = <SignaturePanel masquerCertificat={me?.role === \"RH\"} /> (héritage 194)":
          '<SignaturePanel masquerCertificat={me?.role === "RH"} />' in page_app and
          '<SignaturePanel masquerCertificat={me?.role === "RH"} />' in page_lib,
        "estIt (IT/SUPERADMIN) inchangé":
          'const estIt = role === "IT" || role === "SUPERADMIN";' in demandes_tab,
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
        # ---- README v0.2.195 ----
        "README = édition essentielle (V0.2.195, plus V0.2.194)":
          "V0.2.195" in sans_esp and "V0.2.194" not in sans_esp,
        "README = puce « Demandes : carte « Décision Manager » masquée pour le rôle RH (v0.2.195) »":
          "Demandes:carte«DécisionManager»masquéepourlerôleRH(v0.2.195)" in sans_esp,
        "README = Tableau 5.1 ligne v0.2.195 (DÉCISION MANAGER : CARTE MASQUÉE POUR LE RH)":
          "DÉCISIONMANAGER:CARTEMASQUÉEPOURLERH" in sans_esp,
        "README = « Enregistrer la décision du manager » cité":
          "Enregistrerladécisiondumanager" in sans_esp,
        "README = « enregistrée par sa réponse e-mail » cité":
          "enregistréeparsaréponsee-mail" in sans_esp,
        "README = « ÉTAT ACTUEL » cité": "ÉTATACTUEL" in sans_esp,
        "README = « DemandesTab » cité": "DemandesTab" in sans_esp,
        "README = durée du projet (195 versions / 31 jours)":
          ("Duréeduprojet" in sans_esp and "31jours" in sans_esp and "195versions" in sans_esp),
        "README = sources v0.2.195 citées": "Codesourcelivrév0.2.195" in sans_esp,
        "README = héritage 194 (v0.2.194 cité)": "v0.2.194" in sans_esp,
        "README = héritage 193 (v0.2.193 cité)": "v0.2.193" in sans_esp,
        "README = héritage 194 (masquerCertificat cité)": "masquerCertificat" in sans_esp,
        "README = héritage 186 (Certificat dédié masqué)":
          "CertificatdédiémasquépourlerôleRH" in sans_esp,
        "README = 17 pages": len(lecteur.pages) == 17,
        # ---- embarqués ----
        "générateur README 195 embarqué": "scripts/creer_readme_essentiel_v02195.py" in noms,
        "transformateur README 195 embarqué": "scripts/transformer_readme_v02195.py" in noms,
        "constructeur ZIP 195 embarqué": "scripts/construire-zip-v02195.py" in noms,
        "vérification état 195 embarquée": "scripts/verif-etat-v02195.js" in noms,
        "créateur demandes de test 195 embarqué": "scripts/creer-demandes-test-v02195.js" in noms,
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
        "0 PDF v0.2.186→194 restant": not any((s in n) for n in noms for s in ("-v0.2.186.pdf", "-v0.2.187.pdf", "-v0.2.188.pdf", "-v0.2.189.pdf", "-v0.2.190.pdf", "-v0.2.191.pdf", "-v0.2.192.pdf", "-v0.2.193.pdf", "-v0.2.194.pdf")),
        "0 lanceur supprimé": not any(x in noms for x in (
            "DEMARRER-WINDOWS.bat", "DEMARRER-TOUT-WINDOWS.bat",
            "DEMARRER-PORTAIL-WINDOWS.bat", "SCINDER-DOCX-WINDOWS.bat",
            "SCINDER-EXCEL-WINDOWS.bat", "SCINDER-FICHES-WINDOWS.bat",
            "SECURISER-DOSSIER-WINDOWS.bat", "SECURISER-DOSSIERS-WINDOWS.bat")),
    }
    zf.close()
    return verifs


def main():
    print("=== Construction v0.2.195 (carte « Décision Manager » masquée pour le RH) ===\n")
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
