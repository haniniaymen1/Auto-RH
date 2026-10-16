#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Construit les ZIP de livraison v0.2.196 (Auto-RH) — ADRESSES DÉDIÉES DES
ATTESTATIONS « EN COPIE » (demande utilisateur du 13/10/2026 : « Ajouter cette
configuration en copie dans la configuration des e-mails dédiée au service RH.
je parle dans le cadre vert » — cadre vert = les deux champs « E-mail dédié —
attestations de travail / de salaire » du panneau SMTP → routage) :

  - COMPLET : auto-rh-scripts-site-web-v0.2.196.zip
  - LEGER   : auto-rh-scripts-site-web-v0.2.196-leger.zip

Base : ZIP v0.2.195.
Changements :
  0) scripts/portail-server.js (v0.2.196) — destinatairePourDemande : les
     demandes d'ATTESTATION repartent à la BOÎTE DU SERVICE RH comme
     destinataire PRINCIPAL (historique Task 116 restauré ; repli : adresse
     dédiée si la boîte RH est absente) ; envoyerEmailsDemandeEnArrierePlan :
     la COPIE systématique s'étend aux attestations (adresse DÉDIÉE du type —
     Task 197 — sans repli RH, jamais de doublon du principal) ; garde IMAP de
     traiterMessageRecu : l'adresse dédiée de SON type reste expéditeur
     habilité (rôle « rh » — 4e expéditeur légitime, continuité Task 197) ;
     commentaires actualisés (en-tête Task 116, lecture MailConfig) ;
  1) src/components/payslip/mail-panel.tsx (v0.2.196) — panneau SMTP →
     routage : libellés « E-mail dédié — attestations de travail (copie) » /
     « attestations de salaire (copie) », descriptions « Reçoit une COPIE… »,
     description de la boîte RH précisée (destinataire PRINCIPAL) ;
  2) scripts/test_v02196_attestations_copie.js (NOUVEAU) — preuve sur le CODE
     RÉEL du portail : 36 contrôles (routage, envois capturés, journal, garde
     IMAP), 0 échec ;
  3) scripts/test_v094_routage_emails.js (MIS À JOUR) — sémantique v0.2.196
     + remise à jour v0.2.132 (manager responsable) : 24 contrôles E2E avec
     SMTP puits (RCPT TO réels), pré-nettoyage résilient, 0 échec ;
  4) README : ÉDITION ESSENTIELLE v0.2.196 (18 pages — puce « Routage e-mail :
     attestations EN COPIE (v0.2.196) », Tableau 5.1 + ligne v0.2.196,
     couverture, 196 versions / 31 jours, marqueurs verifier) ;
  5) générateur/constructeur v0.2.196 embarqués ; VERSION = 0.2.196,
     MANIFEST-LIVRAISON.txt régénéré.

Intégrité vérifiée (testzip) + contrôles + MD5 affichés.
"""
import os, zipfile, hashlib, shutil

REF_COMPLET = "/tmp/my-project/download/auto-rh-scripts-site-web-v0.2.195.zip"
REF_LEGER   = "/tmp/my-project/download/auto-rh-scripts-site-web-v0.2.195-leger.zip"
SORTIE      = "/home/z/my-project/download"
VERSION     = "v0.2.196"

README_NOUVEAU = "/home/z/my-project/download/servicerh-readme-technique-v0.2.196.pdf"
FICHIERS_REMPLACES = {
    # (v0.2.196) serveur : attestations EN COPIE (routage + copie + garde IMAP)
    "scripts/portail-server.js": "/home/z/my-project/scripts/portail-server.js",
    # (v0.2.196) interface : libellés « (copie) » + descriptions
    "src/components/payslip/mail-panel.tsx": "/home/z/my-project/src/components/payslip/mail-panel.tsx",
    # (v0.2.196) test E2E de routage actualisé (v0.2.196 + v0.2.132)
    "scripts/test_v094_routage_emails.js": "/home/z/my-project/scripts/test_v094_routage_emails.js",
    # (v0.2.195/194) interface — réécrits à l'identique depuis l'arbre
    "src/components/payslip/demandes-tab.tsx": "/home/z/my-project/src/components/payslip/demandes-tab.tsx",
    "src/components/payslip/signature-panel-reponses.tsx": "/home/z/my-project/src/components/payslip/signature-panel-reponses.tsx",
    "src/components/payslip/signature-panel.tsx": "/home/z/my-project/src/components/payslip/signature-panel.tsx",
    "src/app/page.tsx": "/home/z/my-project/src/app/page.tsx",
    "src/lib/page.tsx": "/home/z/my-project/src/lib/page.tsx",
    "scripts/test_v02193_notifications_toujours.js": "/home/z/my-project/scripts/test_v02193_notifications_toujours.js",
}
NOUVEAUX = {
    "scripts/test_v02196_attestations_copie.js": "/home/z/my-project/scripts/test_v02196_attestations_copie.js",
    "scripts/transformer_readme_v02196.py": "/home/z/my-project/scripts/transformer_readme_v02196.py",
    "scripts/creer_readme_essentiel_v02196.py": "/home/z/my-project/scripts/creer_readme_essentiel_v02196.py",
    "scripts/construire-zip-v02196.py":       "/home/z/my-project/scripts/construire-zip-v02196.py",
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
                out.write(README_NOUVEAU, n)  # édition essentielle v0.2.196
                continue
            if n == "servicerh-readme-technique-reduit.pdf" and mode == "COMPLET":
                out.write(README_NOUVEAU, n)
                continue
            out.writestr(n, ref.read(n))
        for arc, src in NOUVEAUX.items():
            out.write(src, arc)
        out.writestr("VERSION", "0.2.196\n")
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
    # (v0.2.196) le pied de page peut tomber PILE au milieu d'une expression :
    # on retire le chrome avant la vérification.
    texte = "\n".join(
        l_ for l_ in texte.splitlines()
        if not l_.strip().startswith("page ") and "Documentation technique et README officiel" not in l_
    )
    sans_esp = "".join(texte.split())
    portail = zf.read("scripts/portail-server.js").decode("utf-8", "replace")
    mail_panel = zf.read("src/components/payslip/mail-panel.tsx").decode("utf-8", "replace")
    test196 = zf.read("scripts/test_v02196_attestations_copie.js").decode("utf-8", "replace")
    test094 = zf.read("scripts/test_v094_routage_emails.js").decode("utf-8", "replace")
    # (v0.2.195) fichier d'interface MODIFIÉ, lu depuis l'archive
    demandes_tab = zf.read("src/components/payslip/demandes-tab.tsx").decode("utf-8", "replace")
    sp_reponses = zf.read("src/components/payslip/signature-panel-reponses.tsx").decode("utf-8", "replace")
    sp_import = zf.read("src/components/payslip/signature-panel.tsx").decode("utf-8", "replace")
    page_app = zf.read("src/app/page.tsx").decode("utf-8", "replace")
    page_lib = zf.read("src/lib/page.tsx").decode("utf-8", "replace")
    panel = zf.read("src/components/payslip/reponse-pdf-panel.tsx").decode("utf-8", "replace")
    users_tab = zf.read("src/components/payslip/users-tab.tsx").decode("utf-8", "replace")
    acceptation_src = zf.read("scripts/document-acceptation.js").decode("utf-8", "replace")
    i_routage = portail.find("function destinatairePourDemande")
    i_dediee = portail.find("const dediee", i_routage)
    i_rh = portail.find("if (cfg.rhEmail) {", i_routage)
    verifs = {
        "testzip": bad is None,
        "VERSION 0.2.196": zf.read("VERSION").decode().strip() == "0.2.196",
        # ---- NOUVEAU v0.2.196 : attestations EN COPIE ----
        "portail = routage : boîte RH PRINCIPALE avant l'adresse dédiée (attestations)":
          -1 < i_routage and -1 < i_rh and -1 < i_dediee and i_rh < i_dediee,
        "portail = motif « copie systématique à l'adresse dédiée »":
          "copie systématique à l'adresse dédiée des demandes d'" in portail,
        "portail = repli dédiée (boîte RH absente)":
          "(repli — boîte du service RH non configurée)" in portail,
        "portail = bloc copie étendu aux attestations (typeAttestation)":
          "const typeAttestation =" in portail and
          "if (typeValidation || typeAttestation) {" in portail,
        "portail = copie attestation SANS repli RH (destCopie = copieDediee seulement)":
          "        : (copieDediee || \"\");" in portail,
        "portail = cfg.attestationTravailEmail présent ≥ 2 fois (routage + copie)":
          portail.count("cfg.attestationTravailEmail") >= 2,
        "portail = cfg.attestationSalaireEmail présent ≥ 2 fois (routage + copie)":
          portail.count("cfg.attestationSalaireEmail") >= 2,
        "portail = garde IMAP : dérogation adresse dédiée (expAttestationDediee)":
          "const expAttestationDediee = Boolean(" in portail and
          "    } else if (expAttestationDediee) {\n      roleReponse = \"rh\";" in portail,
        "portail = garde IMAP : lecture de l'adresse dédiée pour SON type":
          'demande.type === "ATTESTATION_TRAVAIL" && cfgMail.attestationTravailEmail' in portail and
          'demande.type === "ATTESTATION_SALAIRE" && cfgMail.attestationSalaireEmail' in portail,
        "portail = commentaires v0.2.196 (en-tête Task 116 + map MailConfig)":
          portail.count("v0.2.196") >= 10 and
          "MAP DE CONFIGURATION\n    // DES MAILS" in portail,
        "mail-panel = libellé « attestations de travail (copie) »":
          'E-mail dédié — attestations de travail (copie)' in mail_panel,
        "mail-panel = libellé « attestations de salaire (copie) »":
          'E-mail dédié — attestations de salaire (copie)' in mail_panel,
        "mail-panel = 4 descriptions « Reçoit une COPIE » (2 attestations + congé + autorisation)":
          mail_panel.count("Reçoit une <b>COPIE</b>") == 4,
        "mail-panel = boîte RH destinataire PRINCIPAL (description v0.2.196)":
          "destinataire PRINCIPAL" in mail_panel and "v0.2.196" in mail_panel,
        "test 196 embarqué = code réel complet (routage + envois + garde)":
          "scripts/test_v02196_attestations_copie.js" in noms and
          "36 OK" not in test196 and "destinatairePourDemande" in test196 and
          "envoyerEmailsDemandeEnArrierePlan" in test196 and "expAttestationDediee" in test196,
        "test v094 = sémantique v0.2.196 + manager responsable (v0.2.132)":
          "v0.2.196" in test094 and "EMAIL_MANAGER" in test094 and
          "Pré-nettoyage" in test094 and
          "destinataire PRINCIPAL = boîte RH (v0.2.196)" in test094,
        # ---- héritage v0.2.195 : carte « Décision Manager » masquée pour le RH ----
        "demandes-tab = constante estRh (role === \"RH\") (héritage 195)":
          'const estRh = role === "RH";' in demandes_tab,
        "demandes-tab = ternaire {estRh ? note : carte} (héritage 195)":
          demandes_tab.find("{estRh ? (") > -1,
        "demandes-tab = carte « Décision Manager » dans la branche superadmin (héritage 195)":
          -1 < demandes_tab.find("Décision Manager</span>", demandes_tab.find("{estRh ? (")) and
          -1 < demandes_tab.find("Enregistrer la décision du manager", demandes_tab.find("{estRh ? (")),
        "demandes-tab = <SignaturePanelReponses masquerCertificat={role === \"RH\"} /> (héritage 194)":
          '<SignaturePanelReponses masquerCertificat={role === "RH"} />' in demandes_tab,
        "demandes-tab = <ReponsePdfPanel masquerCertificat={role === \"RH\"} /> (héritage 186)":
          '<ReponsePdfPanel masquerCertificat={role === "RH"} />' in demandes_tab,
        # ---- héritage v0.2.194 : certificat masqué (5 fichiers) ----
        "réponses 194 = prop masquerCertificat + garde (héritage)":
          "masquerCertificat = false," in sp_reponses and sp_reponses.count("{!masquerCertificat && (") == 1,
        "importer 194 = prop masquerCertificat + garde (héritage)":
          "masquerCertificat = false," in sp_import and sp_import.count("{!masquerCertificat && (") == 1,
        "page app/lib = <SignaturePanel masquerCertificat={me?.role === \"RH\"} /> (héritage 194)":
          '<SignaturePanel masquerCertificat={me?.role === "RH"} />' in page_app and
          '<SignaturePanel masquerCertificat={me?.role === "RH"} />' in page_lib,
        # ---- héritage v0.2.193 : notifications toujours envoyées ----
        "portail = drapeaux EFFECTIFS avecPdfDecision (maître ET interrupteur) (héritage 193)":
          "const avecPdfDecision = {" in portail and
          "manager: emailActifDecision && envoyerManagerDecision," in portail,
        "portail = trace « notification TOUJOURS envoyée » (héritage 193)":
          "notification TOUJOURS envoyée" in portail,
        "portail = ENVOI_DESACTIVE SUPPRIMÉ (héritage 193)":
          'code: "ENVOI_DESACTIVE"' not in portail,
        "module acc. = destinataires TOUJOURS complets (héritage 193)":
          "manager: ctx.emailManager || ''," in acceptation_src,
        "panneau 186 = héritage intact (masquerCertificat)":
          "masquerCertificat = false," in panel and "sont TOUJOURS envoyés" in panel,
        # ---- héritage v0.2.192 : boutons de gestion collants ----
        "interface 192 = colonne Actions COLLANTE (héritage)":
          "sticky right-0 z-10 bg-card text-right border-l border-border/60" in users_tab,
        # ---- README v0.2.196 ----
        "README = édition essentielle (V0.2.196, plus V0.2.195)":
          "V0.2.196" in sans_esp and "V0.2.195" not in sans_esp,
        "README = puce « Routage e-mail : attestations EN COPIE (v0.2.196) »":
          "Routagee-mail:attestationsENCOPIE(v0.2.196)" in sans_esp,
        "README = Tableau 5.1 ligne v0.2.196 (ATTESTATIONS EN COPIE)":
          "ATTESTATIONSENCOPIE" in sans_esp,
        "README = « attestations de travail (copie) » cité":
          "attestationsdetravail(copie)" in sans_esp,
        "README = « 4e expéditeur légitime » cité": "4eexpéditeurlégitime" in sans_esp,
        "README = « COPIE systématique » cité": "COPIEsystématique" in sans_esp,
        "README = « destinataire PRINCIPAL » cité": "destinatairePRINCIPAL" in sans_esp,
        "README = durée du projet (196 versions / 31 jours)":
          ("Duréeduprojet" in sans_esp and "31jours" in sans_esp and "196versions" in sans_esp),
        "README = sources v0.2.196 citées": "Codesourcelivrév0.2.196" in sans_esp,
        "README = héritage 195 (v0.2.195 cité)": "v0.2.195" in sans_esp,
        "README = héritage 194 (masquerCertificat cité)": "masquerCertificat" in sans_esp,
        "README = 18 pages": len(lecteur.pages) == 18,
        # ---- embarqués ----
        "générateur README 196 embarqué": "scripts/creer_readme_essentiel_v02196.py" in noms,
        "transformateur README 196 embarqué": "scripts/transformer_readme_v02196.py" in noms,
        "constructeur ZIP 196 embarqué": "scripts/construire-zip-v02196.py" in noms,
        "générateur README 195 embarqué": "scripts/creer_readme_essentiel_v02195.py" in noms,
        "transformateur README 195 embarqué": "scripts/transformer_readme_v02195.py" in noms,
        "constructeur ZIP 195 embarqué": "scripts/construire-zip-v02195.py" in noms,
        "vérification état 195 embarquée": "scripts/verif-etat-v02195.js" in noms,
        "créateur demandes de test 195 embarqué": "scripts/creer-demandes-test-v02195.js" in noms,
        "générateur README 194 embarqué": "scripts/creer_readme_essentiel_v02194.py" in noms,
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
        "0 PDF v0.2.186→195 restant": not any((s in n) for n in noms for s in ("-v0.2.186.pdf", "-v0.2.187.pdf", "-v0.2.188.pdf", "-v0.2.189.pdf", "-v0.2.190.pdf", "-v0.2.191.pdf", "-v0.2.192.pdf", "-v0.2.193.pdf", "-v0.2.194.pdf", "-v0.2.195.pdf")),
        "0 lanceur supprimé": not any(x in noms for x in (
            "DEMARRER-WINDOWS.bat", "DEMARRER-TOUT-WINDOWS.bat",
            "DEMARRER-PORTAIL-WINDOWS.bat", "SCINDER-DOCX-WINDOWS.bat",
            "SCINDER-EXCEL-WINDOWS.bat", "SCINDER-FICHES-WINDOWS.bat",
            "SECURISER-DOSSIER-WINDOWS.bat", "SECURISER-DOSSIERS-WINDOWS.bat")),
    }
    zf.close()
    return verifs


def main():
    print("=== Construction v0.2.196 (adresses dédiées des attestations EN COPIE) ===\n")
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
