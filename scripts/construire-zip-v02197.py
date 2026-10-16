#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Construit les ZIP de livraison v0.2.197 (Auto-RH) — PARRAINAGE EN COPIE +
VÉRIFICATION DES COPIES CONGÉ / AUTORISATION (demande utilisateur du
13/10/2026 : « Pour les demandes de congé et d'autorisation, la configuration
des adresses e-mail en copie dans le cadre rouge ne fonctionne pas. Merci de
vérifier et de corriger ce problème. Pour les demandes de parrainage, je
souhaite également ajouter une adresse e-mail en copie de responsable
principal du parrainage. ») :

  - COMPLET : auto-rh-scripts-site-web-v0.2.197.zip
  - LEGER   : auto-rh-scripts-site-web-v0.2.197-leger.zip

Base : ZIP v0.2.196.
Changements :
  0) prisma/schema.prisma (v0.2.197) — MailConfig.parrainageCopieEmail
     (String @default("")) : adresse en COPIE des demandes de parrainage ;
  1) scripts/portail-server.js (v0.2.197) — lireConfigMailDemandes expose
     parrainageCopieEmail (déchiffrée) ; envoyerEmailsDemandeEnArrierePlan :
     le bloc COPIE s'étend au PARRAINAGE (copie = parrainageCopieEmail, sans
     repli — l'adresse dédiée reste PRINCIPAL) ; copie identique au principal
     = IGNORÉE + JOURNALISÉE (« demande-creation-copie-ignoree »,
     COPIE_IDENTIQUE_PRINCIPAL) ;
  2) src/lib/mailer.ts (v0.2.197) — type + défaut + lectures
     parrainageCopieEmail (lireConfigMail + transporteurDepuisConfig) ;
  3) src/app/api/mail-config/route.ts (v0.2.197) — lecture, validation
     (« L'adresse e-mail en copie des demandes de parrainage est invalide »)
     et persistance de parrainageCopieEmail ;
  4) src/components/payslip/mail-panel.tsx (v0.2.197) — champ « E-mail dédié —
     demandes de parrainage (copie) » + descriptions (responsable principal
     du parrainage) ;
  5) scripts/test_v02197_parrainage_copie.js (NOUVEAU) — preuve sur le CODE
     RÉEL du portail : 22 contrôles, 0 échec ;
  6) scripts/preuve-ui-v02197.js (NOUVEAU) — preuve UI : demandes soumises au
     portail RÉEL + SMTP puits (RCPT TO) + données conservées pour captures ;
  7) scripts/test_v094_routage_emails.js (MIS À JOUR) — copie parrainage +
     copie invalide → 400 + copie identique ignorée : 30 contrôles E2E, 0 échec ;
  8) README : ÉDITION ESSENTIELLE v0.2.197 (18 pages — puce « Routage e-mail :
     parrainage EN COPIE (v0.2.197) », Tableau 5.1 + ligne v0.2.197,
     couverture, 197 versions / 31 jours, marqueurs verifier) ;
  9) générateur/constructeur v0.2.197 embarqués ; VERSION = 0.2.197,
     MANIFEST-LIVRAISON.txt régénéré.

Intégrité vérifiée (testzip) + contrôles + MD5 affichés.
"""
import os, zipfile, hashlib, shutil

REF_COMPLET = "/tmp/my-project/download/auto-rh-scripts-site-web-v0.2.196.zip"
REF_LEGER   = "/tmp/my-project/download/auto-rh-scripts-site-web-v0.2.196-leger.zip"
SORTIE      = "/home/z/my-project/download"
VERSION     = "v0.2.197"

README_NOUVEAU = "/home/z/my-project/download/servicerh-readme-technique-v0.2.197.pdf"
FICHIERS_REMPLACES = {
    # (v0.2.197) schéma : MailConfig.parrainageCopieEmail
    "prisma/schema.prisma": "/home/z/my-project/prisma/schema.prisma",
    # (v0.2.197) serveur : copie parrainage + copie identique ignorée/journalisée
    "scripts/portail-server.js": "/home/z/my-project/scripts/portail-server.js",
    # (v0.2.197) service mail admin : type + lectures parrainageCopieEmail
    "src/lib/mailer.ts": "/home/z/my-project/src/lib/mailer.ts",
    # (v0.2.197) API mail-config : validation + persistance parrainageCopieEmail
    "src/app/api/mail-config/route.ts": "/home/z/my-project/src/app/api/mail-config/route.ts",
    # (v0.2.197) interface : champ « demandes de parrainage (copie) »
    "src/components/payslip/mail-panel.tsx": "/home/z/my-project/src/components/payslip/mail-panel.tsx",
    # (v0.2.197) test E2E de routage étendu (copie parrainage + ignorée)
    "scripts/test_v094_routage_emails.js": "/home/z/my-project/scripts/test_v094_routage_emails.js",
    # (v0.2.196/195/194) interface — réécrits à l'identique depuis l'arbre
    "src/components/payslip/demandes-tab.tsx": "/home/z/my-project/src/components/payslip/demandes-tab.tsx",
    "src/components/payslip/signature-panel-reponses.tsx": "/home/z/my-project/src/components/payslip/signature-panel-reponses.tsx",
    "src/components/payslip/signature-panel.tsx": "/home/z/my-project/src/components/payslip/signature-panel.tsx",
    "src/app/page.tsx": "/home/z/my-project/src/app/page.tsx",
    "src/lib/page.tsx": "/home/z/my-project/src/lib/page.tsx",
    "scripts/test_v02193_notifications_toujours.js": "/home/z/my-project/scripts/test_v02193_notifications_toujours.js",
}
NOUVEAUX = {
    "scripts/test_v02197_parrainage_copie.js": "/home/z/my-project/scripts/test_v02197_parrainage_copie.js",
    "scripts/preuve-ui-v02197.js":            "/home/z/my-project/scripts/preuve-ui-v02197.js",
    "scripts/transformer_readme_v02197.py":   "/home/z/my-project/scripts/transformer_readme_v02197.py",
    "scripts/creer_readme_essentiel_v02197.py": "/home/z/my-project/scripts/creer_readme_essentiel_v02197.py",
    "scripts/construire-zip-v02197.py":       "/home/z/my-project/scripts/construire-zip-v02197.py",
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
                out.write(README_NOUVEAU, n)  # édition essentielle v0.2.197
                continue
            if n == "servicerh-readme-technique-reduit.pdf" and mode == "COMPLET":
                out.write(README_NOUVEAU, n)
                continue
            out.writestr(n, ref.read(n))
        for arc, src in NOUVEAUX.items():
            out.write(src, arc)
        out.writestr("VERSION", "0.2.197\n")
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
    schema = zf.read("prisma/schema.prisma").decode("utf-8", "replace")
    mailer = zf.read("src/lib/mailer.ts").decode("utf-8", "replace")
    api = zf.read("src/app/api/mail-config/route.ts").decode("utf-8", "replace")
    mail_panel = zf.read("src/components/payslip/mail-panel.tsx").decode("utf-8", "replace")
    test197 = zf.read("scripts/test_v02197_parrainage_copie.js").decode("utf-8", "replace")
    test094 = zf.read("scripts/test_v094_routage_emails.js").decode("utf-8", "replace")
    preuve = zf.read("scripts/preuve-ui-v02197.js").decode("utf-8", "replace")
    # (v0.2.195) fichiers d'interface MODIFIÉS, lus depuis l'archive
    demandes_tab = zf.read("src/components/payslip/demandes-tab.tsx").decode("utf-8", "replace")
    sp_reponses = zf.read("src/components/payslip/signature-panel-reponses.tsx").decode("utf-8", "replace")
    sp_import = zf.read("src/components/payslip/signature-panel.tsx").decode("utf-8", "replace")
    page_app = zf.read("src/app/page.tsx").decode("utf-8", "replace")
    page_lib = zf.read("src/lib/page.tsx").decode("utf-8", "replace")
    panel = zf.read("src/components/payslip/reponse-pdf-panel.tsx").decode("utf-8", "replace")
    users_tab = zf.read("src/components/payslip/users-tab.tsx").decode("utf-8", "replace")
    acceptation_src = zf.read("scripts/document-acceptation.js").decode("utf-8", "replace")
    i_config = portail.find("async function lireConfigMailDemandes()")
    i_parr_copie_cfg = portail.find("parrainageCopieEmail: dechiffrerAdresse(cfg.parrainageCopieEmail)")
    i_envoi = portail.find("async function envoyerEmailsDemandeEnArrierePlan")
    i_type_parr = portail.find("const typeParrainage = demandeCreee.type === \"PARRAINAGE\";")
    i_ignoree = portail.find('"demande-creation-copie-ignoree"')
    verifs = {
        "testzip": bad is None,
        "VERSION 0.2.197": zf.read("VERSION").decode().strip() == "0.2.197",
        # ---- NOUVEAU v0.2.197 : parrainage EN COPIE ----
        "schema = MailConfig.parrainageCopieEmail String @default(\"\")":
          'parrainageCopieEmail    String @default("")' in schema and "v0.2.197" in schema,
        "portail = lireConfigMailDemandes expose parrainageCopieEmail (déchiffré)":
          -1 < i_config and -1 < i_parr_copie_cfg and i_config < i_parr_copie_cfg,
        "portail = bloc copie couvre le PARRAINAGE (typeParrainage)":
          -1 < i_envoi and -1 < i_type_parr and i_envoi < i_type_parr and
          "if (typeValidation || typeAttestation || typeParrainage) {" in portail,
        "portail = copie parrainage lit cfg.parrainageCopieEmail (AUCUN repli)":
          "              : cfg.parrainageCopieEmail" in portail,
        "portail = copie identique au principal IGNORÉE + JOURNALISÉE":
          -1 < i_ignoree and "COPIE_IDENTIQUE_PRINCIPAL" in portail,
        "portail = commentaires v0.2.197 présents (≥ 8 occurrences)":
          portail.count("v0.2.197") >= 8,
        "mailer.ts = type + défaut + 2 lectures parrainageCopieEmail":
          mailer.count("parrainageCopieEmail") >= 5 and
          "parrainageCopieEmail: string;" in mailer and
          'parrainageCopieEmail: "",' in mailer and
          "parrainageCopieEmail: cfg.parrainageCopieEmail ?? \"\"" in mailer and
          "parrainageCopieEmail: brut.parrainageCopieEmail ?? \"\"" in mailer,
        "API mail-config = lecture + validation + persistance parrainageCopieEmail":
          'String(body?.parrainageCopieEmail ?? "").trim()' in api and
          "en copie des demandes de parrainage" in api and
          "parrainageCopieEmail," in api,
        "mail-panel = champ « E-mail dédié — demandes de parrainage (copie) »":
          "E-mail dédié — demandes de parrainage (copie)" in mail_panel and
          'id="mail-parrainage-copie"' in mail_panel and
          'setParrainageCopieEmail(c.parrainageCopieEmail ?? "")' in mail_panel,
        "mail-panel = description « responsable principal du parrainage »":
          mail_panel.count("responsable principal du parrainage") >= 2,
        "mail-panel = 5 descriptions « Reçoit une COPIE » (parrainage + 2 attestations + congé + autorisation)":
          mail_panel.count("Reçoit une <b>COPIE</b>") == 5,
        "test 197 embarqué = code réel complet (config + copie + ignorée)":
          "scripts/test_v02197_parrainage_copie.js" in noms and
          "parrainageCopieEmail" in test197 and
          "envoyerEmailsDemandeEnArrierePlan" in test197 and
          "COPIE_IDENTIQUE_PRINCIPAL" in test197,
        "preuve UI 197 embarquée (portail réel + SMTP puits)":
          "scripts/preuve-ui-v02197.js" in noms and "RCPT TO" in preuve and
          "responsable.parrainage@entreprise.tn" in preuve,
        "test v094 = sémantique v0.2.197 (copie parrainage + ignorée + validations)":
          "EMAIL_PARRAINAGE_COPIE" in test094 and
          "copie IGNORÉE + JOURNALISÉE (v0.2.197)" in test094.replace("— ", "") or
          "demande-creation-copie-ignoree" in test094,
        "test v094 = PUT parrainageCopieEmail invalide → 400":
          "en copie des demandes de parrainage" in test094,
        # ---- héritage v0.2.196 : attestations EN COPIE ----
        "portail = attestations EN COPIE (routage RH principal) (héritage 196)":
          "copie systématique à l'adresse dédiée des demandes d'" in portail and
          "const typeAttestation =" in portail and
          "const expAttestationDediee = Boolean(" in portail,
        "mail-panel = libellés attestations « (copie) » (héritage 196)":
          "E-mail dédié — attestations de travail (copie)" in mail_panel and
          "E-mail dédié — attestations de salaire (copie)" in mail_panel,
        "portail = commentaires v0.2.196 (héritage)":
          portail.count("v0.2.196") >= 10,
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
        # ---- README v0.2.197 ----
        "README = édition essentielle (V0.2.197, plus V0.2.196)":
          "V0.2.197" in sans_esp and "V0.2.196" not in sans_esp,
        "README = puce « Routage e-mail : parrainage EN COPIE (v0.2.197) »":
          "Routagee-mail:parrainageENCOPIE(v0.2.197)" in sans_esp,
        "README = Tableau 5.1 ligne v0.2.197 (PARRAINAGE EN COPIE)":
          "PARRAINAGEENCOPIE" in sans_esp,
        "README = « demandes de parrainage (copie) » cité":
          "demandesdeparrainage(copie)" in sans_esp,
        "README = « responsable principal du parrainage » cité":
          "responsableprincipalduparrainage" in sans_esp,
        "README = « COPIE_IDENTIQUE_PRINCIPAL » cité": "COPIE_IDENTIQUE_PRINCIPAL" in sans_esp,
        "README = vérification du cadre rouge (copies congé / autorisation) citée":
          "congeEmail" in sans_esp and "autorisationEmail" in sans_esp,
        "README = « COPIE systématique » cité": "COPIEsystématique" in sans_esp,
        "README = durée du projet (197 versions / 31 jours)":
          ("Duréeduprojet" in sans_esp and "31jours" in sans_esp and "197versions" in sans_esp),
        "README = sources v0.2.197 citées": "Codesourcelivrév0.2.197" in sans_esp,
        "README = héritage 196 (v0.2.196 cité)": "v0.2.196" in sans_esp,
        "README = héritage 195/194 cités": "v0.2.195" in sans_esp and "masquerCertificat" in sans_esp,
        "README = 18 pages": len(lecteur.pages) == 18,
        # ---- embarqués ----
        "générateur README 197 embarqué": "scripts/creer_readme_essentiel_v02197.py" in noms,
        "transformateur README 197 embarqué": "scripts/transformer_readme_v02197.py" in noms,
        "constructeur ZIP 197 embarqué": "scripts/construire-zip-v02197.py" in noms,
        "générateur README 196 embarqué": "scripts/creer_readme_essentiel_v02196.py" in noms,
        "test 196 embarqué": "scripts/test_v02196_attestations_copie.js" in noms,
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
        "0 PDF v0.2.186→196 restant": not any((s in n) for n in noms for s in ("-v0.2.186.pdf", "-v0.2.187.pdf", "-v0.2.188.pdf", "-v0.2.189.pdf", "-v0.2.190.pdf", "-v0.2.191.pdf", "-v0.2.192.pdf", "-v0.2.193.pdf", "-v0.2.194.pdf", "-v0.2.195.pdf", "-v0.2.196.pdf")),
        "0 lanceur supprimé": not any(x in noms for x in (
            "DEMARRER-WINDOWS.bat", "DEMARRER-TOUT-WINDOWS.bat",
            "DEMARRER-PORTAIL-WINDOWS.bat", "SCINDER-DOCX-WINDOWS.bat",
            "SCINDER-EXCEL-WINDOWS.bat", "SCINDER-FICHES-WINDOWS.bat",
            "SECURISER-DOSSIER-WINDOWS.bat", "SECURISER-DOSSIERS-WINDOWS.bat")),
    }
    zf.close()
    return verifs


def main():
    print("=== Construction v0.2.197 (parrainage EN COPIE + vérification copies congé/autorisation) ===\n")
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
