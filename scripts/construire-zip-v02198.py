#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Construit les ZIP de livraison v0.2.198 (Service RH) — PORTS DES DEUX
INTERFACES MODIFIABLES PAR LE .ENV (demande utilisateur : « comment changer
les deux ports de deux interfaces ? » puis « integre dans nouveau zip complet ») :

  - COMPLET : service-rh-scripts-site-web-v0.2.198.zip
  - LEGER   : service-rh-scripts-site-web-v0.2.198-leger.zip

Base : ZIP v0.2.197.
Changements :
  0) scripts/portail-server.js (v0.2.198) — PLUS de repli du portail sur
     process.env.PORT : PORTAL_PORT (env ou .env) sinon 4001. L'ancien repli
     démarrait le portail sur le port de l'administration dès qu'on ajoutait
     PORT au .env → EADDRINUSE ;
  1) DEMARRER-WINDOWS.bat (v0.2.198, RÉINTÉGRÉ au ZIP — absent depuis la
     Task 168) — lit PORT dans le .env (défaut 3000), affiche et ouvre le
     navigateur sur le port configuré ;
  2) DEMARRER-PORTAIL-WINDOWS.bat (v0.2.198, RÉINTÉGRÉ) — lit PORTAL_PORT
     (défaut 4001) et PORT ; plus AUCUNE trace du faux port 3001 ;
  3) DEMARRER-TOUT-WINDOWS.bat (v0.2.198, RÉINTÉGRÉ) — lit les deux variables,
     fenêtres + affichages dynamiques ;
  4) scripts/service-paiesage.js (v0.2.198, RÉINTÉGRÉ) — lirePortEnv : suit
     PORT / PORTAL_PORT du .env, PAIESAGE_PORT_ADMIN / PAIESAGE_PORT_PORTAIL
     prioritaires, défauts historiques 4000 / 4001 conservés ;
  5) DEMARRER-LINUX-MAC.sh / DEMARRER-PORTAIL-LINUX-MAC.sh /
     DEMARRER-TOUT-LINUX-MAC.sh (v0.2.198) — lecture .env, affichages réels
     (correctif : le site Linux annonçait 4000 au lieu de 3000) ;
  6) DEMARRER-SILENCIEUX-WINDOWS.vbs (v0.2.198) — LirePortAdmin : le
     navigateur s'ouvre sur le PORT lu dans le .env ;
     INSTALLER-DEMARRAGE-AUTOMATIQUE-WINDOWS.vbs — énoncé exact (4000 + 4001
     par défaut, modifiables dans le .env) ;
  7) scripts/redemarrer-services-4000-4001.js (v0.2.198) — lirePortEnv ;
  8) scripts/test_v02198_ports.js (NOUVEAU) — 48 contrôles sur le CODE RÉEL ;
  9) README : ÉDITION ESSENTIELLE v0.2.198 (19 pages — puce « Ports des deux
     interfaces modifiables (v0.2.198) », Tableau 5.1 + ligne v0.2.198,
     couverture, 198 versions / 31 jours, marqueurs verifier) ;
 10) générateur/constructeur v0.2.198 embarqués ; VERSION = 0.2.198,
     MANIFEST-LIVRAISON.txt régénéré.

Intégrité vérifiée (testzip) + contrôles + MD5 affichés.
"""
import os, zipfile, hashlib, shutil

REF_COMPLET = "/tmp/my-project/download/service-rh-scripts-site-web-v0.2.197.zip"
REF_LEGER   = "/tmp/my-project/download/service-rh-scripts-site-web-v0.2.197-leger.zip"
SORTIE      = "/home/z/my-project/download"
VERSION     = "v0.2.198"

README_NOUVEAU = "/home/z/my-project/download/servicerh-readme-technique-v0.2.198.pdf"
FICHIERS_REMPLACES = {
    # (v0.2.198) serveur : plus AUCUN repli du portail sur PORT
    "scripts/portail-server.js": "/home/z/my-project/scripts/portail-server.js",
    # (v0.2.198) relance après mise à jour : ports lus dans le .env
    "scripts/redemarrer-services-4000-4001.js": "/home/z/my-project/scripts/redemarrer-services-4000-4001.js",
    # (v0.2.198) lanceurs Linux/macOS : lecture .env + affichages réels
    "DEMARRER-LINUX-MAC.sh": "/home/z/my-project/DEMARRER-LINUX-MAC.sh",
    "DEMARRER-PORTAIL-LINUX-MAC.sh": "/home/z/my-project/DEMARRER-PORTAIL-LINUX-MAC.sh",
    "DEMARRER-TOUT-LINUX-MAC.sh": "/home/z/my-project/DEMARRER-TOUT-LINUX-MAC.sh",
    # (v0.2.198) kit silencieux : LirePortAdmin + énoncé exact
    "DEMARRER-SILENCIEUX-WINDOWS.vbs": "/home/z/my-project/DEMARRER-SILENCIEUX-WINDOWS.vbs",
    "INSTALLER-DEMARRAGE-AUTOMATIQUE-WINDOWS.vbs": "/home/z/my-project/INSTALLER-DEMARRAGE-AUTOMATIQUE-WINDOWS.vbs",
    # (v0.2.197) schéma + chaîne e-mail — réécrits à l'identique depuis l'arbre
    "prisma/schema.prisma": "/home/z/my-project/prisma/schema.prisma",
    "src/lib/mailer.ts": "/home/z/my-project/src/lib/mailer.ts",
    "src/app/api/mail-config/route.ts": "/home/z/my-project/src/app/api/mail-config/route.ts",
    "src/components/payslip/mail-panel.tsx": "/home/z/my-project/src/components/payslip/mail-panel.tsx",
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
    # (v0.2.198) lanceurs Windows visibles RÉINTÉGRÉS au ZIP (absents depuis Task 168)
    "DEMARRER-WINDOWS.bat": "/home/z/my-project/DEMARRER-WINDOWS.bat",
    "DEMARRER-PORTAIL-WINDOWS.bat": "/home/z/my-project/DEMARRER-PORTAIL-WINDOWS.bat",
    "DEMARRER-TOUT-WINDOWS.bat": "/home/z/my-project/DEMARRER-TOUT-WINDOWS.bat",
    # (v0.2.198) moteur du mode silencieux RÉINTÉGRÉ (requis par le kit .vbs)
    "scripts/service-paiesage.js": "/home/z/my-project/scripts/service-paiesage.js",
    # (v0.2.198) test dédié + chaîne de livraison
    "scripts/test_v02198_ports.js": "/home/z/my-project/scripts/test_v02198_ports.js",
    "scripts/transformer_readme_v02198.py": "/home/z/my-project/scripts/transformer_readme_v02198.py",
    "scripts/creer_readme_essentiel_v02198.py": "/home/z/my-project/scripts/creer_readme_essentiel_v02198.py",
    "scripts/construire-zip-v02198.py": "/home/z/my-project/scripts/construire-zip-v02198.py",
}


def md5(fichier):
    h = hashlib.md5()
    with open(fichier, "rb") as f:
        for bloc in iter(lambda: f.read(1 << 20), b""):
            h.update(bloc)
    return h.hexdigest()


def crlf_ok(data):
    return b"\n" in data and data.count(b"\n") == data.count(b"\r\n")


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
            if n == "service-rh-readme-technique.pdf":
                out.write(README_NOUVEAU, n)  # édition essentielle v0.2.198
                continue
            if n == "servicerh-readme-technique-reduit.pdf" and mode == "COMPLET":
                out.write(README_NOUVEAU, n)
                continue
            out.writestr(n, ref.read(n))
        for arc, src in NOUVEAUX.items():
            out.write(src, arc)
        out.writestr("VERSION", "0.2.198\n")
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
    contenu_readme = zf.read("service-rh-readme-technique.pdf")
    lecteur = PdfReader(io.BytesIO(contenu_readme))
    texte = " ".join((p.extract_text() or "") for p in lecteur.pages)
    # le pied de page peut tomber PILE au milieu d'une expression : on retire
    # le chrome avant la vérification.
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
    test198 = zf.read("scripts/test_v02198_ports.js").decode("utf-8", "replace")
    dem_win = zf.read("DEMARRER-WINDOWS.bat").decode("latin-1")
    dem_por = zf.read("DEMARRER-PORTAIL-WINDOWS.bat").decode("latin-1")
    dem_tout = zf.read("DEMARRER-TOUT-WINDOWS.bat").decode("latin-1")
    dem_linux = zf.read("DEMARRER-LINUX-MAC.sh").decode("utf-8", "replace")
    por_linux = zf.read("DEMARRER-PORTAIL-LINUX-MAC.sh").decode("utf-8", "replace")
    tout_linux = zf.read("DEMARRER-TOUT-LINUX-MAC.sh").decode("utf-8", "replace")
    sil_vbs = zf.read("DEMARRER-SILENCIEUX-WINDOWS.vbs").decode("latin-1")
    inst_vbs = zf.read("INSTALLER-DEMARRAGE-AUTOMATIQUE-WINDOWS.vbs").decode("latin-1")
    paiesage = zf.read("scripts/service-paiesage.js").decode("utf-8", "replace")
    redem = zf.read("scripts/redemarrer-services-4000-4001.js").decode("utf-8", "replace")
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
        "VERSION 0.2.198": zf.read("VERSION").decode().strip() == "0.2.198",
        # ---- NOUVEAU v0.2.198 : PORTS MODIFIABLES ----
        "portail = plus AUCUN repli sur PORT (const exacte)":
          'const PORT = parseInt(process.env.PORTAL_PORT || "4001", 10);' in portail and
          "process.env.PORTAL_PORT || process.env.PORT" not in portail,
        "portail = commentaire du correctif (EADDRINUSE)":
          "PLUS de repli sur PORT" in portail and "EADDRINUSE" in portail,
        "DEMARRER-WINDOWS.bat = PORT lu dans .env (défaut 3000) + URLs !PORT!":
          'set "PORT=3000"' in dem_win and 'findstr /B /C:"PORT="' in dem_win and
          'start "" http://localhost:!PORT!' in dem_win and
          "localhost:3000" not in dem_win,
        "DEMARRER-PORTAIL-WINDOWS.bat = PORTAL_PORT/PORT_ADMIN lus + URLs dynamiques":
          'set "PORTAL_PORT=4001"' in dem_por and 'set "PORT_ADMIN=3000"' in dem_por and
          'findstr /B /C:"PORTAL_PORT="' in dem_por and
          'start "" http://localhost:!PORTAL_PORT!' in dem_por,
        "DEMARRER-PORTAIL-WINDOWS.bat = plus AUCUNE trace du faux port 3001":
          "3001" not in dem_por,
        "DEMARRER-TOUT-WINDOWS.bat = les DEUX variables + fenêtres dynamiques":
          'findstr /B /C:"PORT="' in dem_tout and 'findstr /B /C:"PORTAL_PORT="' in dem_tout and
          "port !PORT!" in dem_tout and "port !PORTAL_PORT!" in dem_tout and
          "localhost:3000" not in dem_tout and "localhost:3001" not in dem_tout,
        "3 .bat Windows = CRLF intégral":
          all(crlf_ok(zf.read(f)) for f in
              ("DEMARRER-WINDOWS.bat", "DEMARRER-PORTAIL-WINDOWS.bat", "DEMARRER-TOUT-WINDOWS.bat")),
        "DEMARRER-LINUX-MAC.sh = PORT du .env (défaut 3000) + plus de localhost:4000":
          "grep -E '^PORT=' .env" in dem_linux and 'PORT="${PORT:-3000}"' in dem_linux and
          "localhost:4000" not in dem_linux,
        "DEMARRER-PORTAIL-LINUX-MAC.sh = PORTAL_PORT du .env + plus de 4001/4000 codés":
          "grep -E '^PORTAL_PORT=' .env" in por_linux and
          'PORTAL_PORT="${PORTAL_PORT:-4001}"' in por_linux and
          "localhost:4001" not in por_linux and "localhost:4000" not in por_linux,
        "DEMARRER-TOUT-LINUX-MAC.sh = les DEUX variables lues":
          "grep -E '^PORT=' .env" in tout_linux and "grep -E '^PORTAL_PORT=' .env" in tout_linux,
        "DEMARRER-SILENCIEUX.vbs = LirePortAdmin + navigateur sur le port LU":
          "Function LirePortAdmin" in sil_vbs and
          'sh.Run "http://localhost:" & portAdmin' in sil_vbs and
          'sh.Run "http://localhost:4000"' not in sil_vbs,
        "INSTALLER-DEMARRAGE.vbs = énoncé exact (4000 + 4001, .env), plus de 3001":
          "administration port 4000 + portail port 4001" in inst_vbs and
          "modifiables dans le fichier .env" in inst_vbs and
          "port 3000 + portail port 3001" not in inst_vbs,
        "service-paiesage.js = lirePortEnv + priorité PAIESAGE_PORT_*":
          "function lirePortEnv(cle, defaut)" in paiesage and
          'lirePortEnv("PORT", "4000")' in paiesage and
          'lirePortEnv("PORTAL_PORT", "4001")' in paiesage and
          "process.env.PAIESAGE_PORT_ADMIN || lirePortEnv" in paiesage and
          "process.env.PAIESAGE_PORT_PORTAIL || lirePortEnv" in paiesage,
        "redemarrer-services = lirePortEnv (défauts 4000/4001)":
          "function lirePortEnv(cle, defaut)" in redem and
          'lirePortEnv("PORT", 4000)' in redem and
          'lirePortEnv("PORTAL_PORT", 4001)' in redem,
        "test dédié 198 embarqué = preuve ports complète":
          "scripts/test_v02198_ports.js" in noms and
          "PORTAL_PORT" in test198 and "LirePortAdmin" in test198 and
          "lirePortEnv" in test198,
        # ---- NOUVEAU v0.2.198 : lanceurs réintégrés au ZIP ----
        "lanceurs Windows visibles RÉINTÉGRÉS (3 .bat + service-paiesage.js)":
          all(x in noms for x in ("DEMARRER-WINDOWS.bat", "DEMARRER-PORTAIL-WINDOWS.bat",
                                  "DEMARRER-TOUT-WINDOWS.bat", "scripts/service-paiesage.js")),
        "0 outil SCINDER/SECURISER réintégré (exclusions historiques intactes)":
          not any(x in noms for x in ("SCINDER-DOCX-WINDOWS.bat", "SCINDER-EXCEL-WINDOWS.bat",
                                      "SCINDER-FICHES-WINDOWS.bat", "SECURISER-DOSSIER-WINDOWS.bat",
                                      "SECURISER-DOSSIERS-WINDOWS.bat")),
        # ---- héritage v0.2.197 : parrainage EN COPIE ----
        "schema = MailConfig.parrainageCopieEmail String @default(\"\") (héritage 197)":
          'parrainageCopieEmail    String @default("")' in schema and "v0.2.197" in schema,
        "portail = lireConfigMailDemandes expose parrainageCopieEmail (héritage 197)":
          -1 < i_config and -1 < i_parr_copie_cfg and i_config < i_parr_copie_cfg,
        "portail = bloc copie couvre le PARRAINAGE (héritage 197)":
          -1 < i_envoi and -1 < i_type_parr and i_envoi < i_type_parr and
          "if (typeValidation || typeAttestation || typeParrainage) {" in portail,
        "portail = copie identique IGNORÉE + JOURNALISÉE (héritage 197)":
          -1 < i_ignoree and "COPIE_IDENTIQUE_PRINCIPAL" in portail,
        "portail = commentaires v0.2.197 présents (héritage)":
          portail.count("v0.2.197") >= 8,
        "mailer.ts = type + lectures parrainageCopieEmail (héritage 197)":
          mailer.count("parrainageCopieEmail") >= 5 and
          "parrainageCopieEmail: string;" in mailer and
          'parrainageCopieEmail: "",' in mailer,
        "API mail-config = validation + persistance parrainageCopieEmail (héritage 197)":
          'String(body?.parrainageCopieEmail ?? "").trim()' in api and
          "parrainageCopieEmail," in api,
        "mail-panel = champ « demandes de parrainage (copie) » (héritage 197)":
          "E-mail dédié — demandes de parrainage (copie)" in mail_panel and
          'id="mail-parrainage-copie"' in mail_panel,
        "mail-panel = 5 descriptions « Reçoit une COPIE » (héritage)":
          mail_panel.count("Reçoit une <b>COPIE</b>") == 5,
        "test 197 embarqué = code réel complet (héritage)":
          "scripts/test_v02197_parrainage_copie.js" in noms and
          "COPIE_IDENTIQUE_PRINCIPAL" in test197,
        "preuve UI 197 embarquée (héritage)":
          "scripts/preuve-ui-v02197.js" in noms and "RCPT TO" in preuve,
        "test v094 = sémantique v0.2.197 (héritage)":
          "demande-creation-copie-ignoree" in test094 or "EMAIL_PARRAINAGE_COPIE" in test094,
        # ---- héritage v0.2.196 : attestations EN COPIE ----
        "portail = attestations EN COPIE (héritage 196)":
          "copie systématique à l'adresse dédiée des demandes d'" in portail and
          "const typeAttestation =" in portail,
        "mail-panel = libellés attestations « (copie) » (héritage 196)":
          "E-mail dédié — attestations de travail (copie)" in mail_panel and
          "E-mail dédié — attestations de salaire (copie)" in mail_panel,
        "portail = commentaires v0.2.196 (héritage)":
          portail.count("v0.2.196") >= 10,
        # ---- héritage v0.2.195/194 : carte manager + certificat masqué ----
        "demandes-tab = constante estRh (héritage 195)":
          'const estRh = role === "RH";' in demandes_tab,
        "demandes-tab = ternaire {estRh ? note : carte} (héritage 195)":
          demandes_tab.find("{estRh ? (") > -1,
        "demandes-tab = <SignaturePanelReponses masquerCertificat ... /> (héritage 194)":
          '<SignaturePanelReponses masquerCertificat={role === "RH"} />' in demandes_tab,
        "demandes-tab = <ReponsePdfPanel masquerCertificat ... /> (héritage 186)":
          '<ReponsePdfPanel masquerCertificat={role === "RH"} />' in demandes_tab,
        "réponses 194 = prop masquerCertificat + garde (héritage)":
          "masquerCertificat = false," in sp_reponses and sp_reponses.count("{!masquerCertificat && (") == 1,
        "importer 194 = prop masquerCertificat + garde (héritage)":
          "masquerCertificat = false," in sp_import and sp_import.count("{!masquerCertificat && (") == 1,
        "page app/lib = <SignaturePanel masquerCertificat ... /> (héritage 194)":
          '<SignaturePanel masquerCertificat={me?.role === "RH"} />' in page_app and
          '<SignaturePanel masquerCertificat={me?.role === "RH"} />' in page_lib,
        # ---- héritage v0.2.193 : notifications toujours envoyées ----
        "portail = drapeaux EFFECTIFS avecPdfDecision (héritage 193)":
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
        # ---- README v0.2.198 ----
        "README = édition essentielle (V0.2.198, plus V0.2.197 en bandeau)":
          "V0.2.198" in sans_esp and "V0.2.197" not in sans_esp,
        "README = puce « Ports des deux interfaces modifiables (v0.2.198) »":
          "Portsdesdeuxinterfacesmodifiables(v0.2.198)" in sans_esp,
        "README = Tableau 5.1 ligne v0.2.198 (PORTS MODIFIABLES)":
          "PORTSMODIFIABLES" in sans_esp,
        "README = PORTAL_PORT cité": "PORTAL_PORT" in sans_esp,
        "README = correctif 3001 cité": "3001fantôme" in sans_esp,
        "README = EADDRINUSE cité": "EADDRINUSE" in sans_esp,
        "README = lirePortEnv / redemarrer-services cités":
          "lirePortEnv" in sans_esp and "redemarrer-services" in sans_esp,
        "README = sources v0.2.198 citées": "Codesourcelivrév0.2.198" in sans_esp,
        "README = héritage 197 (v0.2.197 cité)": "v0.2.197" in sans_esp,
        "README = héritage 196/195 cités": "v0.2.196" in sans_esp and "v0.2.195" in sans_esp,
        "README = durée du projet (198 versions / 31 jours)":
          ("Duréeduprojet" in sans_esp and "31jours" in sans_esp and "198versions" in sans_esp),
        "README = 19 pages": len(lecteur.pages) == 19,
        # ---- embarqués ----
        "générateur README 198 embarqué": "scripts/creer_readme_essentiel_v02198.py" in noms,
        "transformateur README 198 embarqué": "scripts/transformer_readme_v02198.py" in noms,
        "constructeur ZIP 198 embarqué": "scripts/construire-zip-v02198.py" in noms,
        "générateur README 197 embarqué": "scripts/creer_readme_essentiel_v02197.py" in noms,
        "constructeur ZIP 197 embarqué": "scripts/construire-zip-v02197.py" in noms,
        "test 197 embarqué": "scripts/test_v02197_parrainage_copie.js" in noms,
        "test 196 embarqué": "scripts/test_v02196_attestations_copie.js" in noms,
        "transformateur README 196 embarqué": "scripts/transformer_readme_v02196.py" in noms,
        "constructeur ZIP 196 embarqué": "scripts/construire-zip-v02196.py" in noms,
        "test 193 notifications embarqué": "scripts/test_v02193_notifications_toujours.js" in noms,
        "test scénario manager-off (v0.2.193) embarqué": "scripts/test_v02193_scenario_manager_off_pieces.js" in noms,
        "test interrupteurs 191 embarqué": "scripts/test_v02191_interrupteurs_email.js" in noms,
        "test interrupteurs 190 embarqué": "scripts/test_v02190_interrupteurs_destinataires.js" in noms,
        "test certificat dédié masqué 186 embarqué": "scripts/test_v02186_masquer_certificat_rh.js" in noms,
        "route upload présente": "src/app/api/payslips/upload/route.ts" in noms,
        "reduit présent": "servicerh-readme-technique-reduit.pdf" in noms or mode == "LEGER",
        "VBS chiffrer-fiches-silencieux ABSENT": not any("CHIFFRER-FICHES-SILENCIEUX" in n for n in noms),
        "0 PDF v0.2.186→197 restant": not any((s in n) for n in noms for s in ("-v0.2.186.pdf", "-v0.2.187.pdf", "-v0.2.188.pdf", "-v0.2.189.pdf", "-v0.2.190.pdf", "-v0.2.191.pdf", "-v0.2.192.pdf", "-v0.2.193.pdf", "-v0.2.194.pdf", "-v0.2.195.pdf", "-v0.2.196.pdf", "-v0.2.197.pdf")),
    }
    zf.close()
    return verifs


def main():
    print("=== Construction v0.2.198 (ports des deux interfaces modifiables) ===\n")
    echecs_total = 0
    for ref, nom, mode in [
        (REF_COMPLET, f"service-rh-scripts-site-web-{VERSION}.zip", "COMPLET"),
        (REF_LEGER,   f"service-rh-scripts-site-web-{VERSION}-leger.zip", "LEGER"),
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
        (f"service-rh-scripts-site-web-{VERSION}.zip", "service-rh-scripts-site-web.zip"),
        (f"service-rh-scripts-site-web-{VERSION}-leger.zip", "service-rh-scripts-site-web-leger.zip"),
    ]:
        shutil.copyfile(os.path.join(SORTIE, src), os.path.join(SORTIE, dst))
        m1 = md5(os.path.join(SORTIE, src)); m2 = md5(os.path.join(SORTIE, dst))
        print(f"copie générique {dst} : {'IDENTIQUE' if m1 == m2 else 'DIVERGENCE !!'} (MD5 {m1})")
    if echecs_total:
        raise SystemExit(f"{echecs_total} VÉRIFICATION(S) EN ÉCHEC")
    print("\nTOUTES LES VÉRIFICATIONS SONT PASSÉES.")


if __name__ == "__main__":
    main()
