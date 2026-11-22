#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Construit les ZIP de livraison v0.2.200 (Service RH) — SUPPRESSION DES
COMPTES ADMIN + GUIDE D'INSTALLATION LINUX/WINDOWS + CHANGEMENT DES PORTS
(demande utilisateur : « supprimer si il y a des comptes admin ainsi donne
moi comment j installe dans linux et comment l installe dans windows ? , et
comment changer les port des interfaces dans linux et dans windows ») :

  - COMPLET : service-rh-scripts-site-web-v0.2.200.zip
  - LEGER   : service-rh-scripts-site-web-v0.2.200-leger.zip

Base : ZIP v0.2.199.
Changements :
  0) db/custom.db REMPLACÉE par une base VIERGE (schéma Prisma appliqué,
     ZÉRO compte, ZÉRO donnée — les 3 comptes de démonstration de la base
     v0.2.199 n'existent plus ; le premier compte créé à l'installation
     devient l'administrateur) ; archive de traçabilité scripts/base-vierge/ ;
  1) GUIDE-INSTALLATION-LINUX-WINDOWS.txt (NOUVEAU) : installation
     Linux/macOS (script tout-en-un v0.2.199), installation Windows (.bat +
     menu CREER-SUPERADMIN-WINDOWS.bat), CHANGEMENT DES PORTS des deux
     interfaces (PORT / PORTAL_PORT du .env, valeurs DIFFÉRENTES) pour les
     deux systèmes, mode non interactif, accès réseau/pare-feu, problèmes
     courants ;
  2) scripts/test_v02200_guide_comptes.js (NOUVEAU) — 18 contrôles dont la
     vérification RÉELLE des bases (0 compte) ;
  3) README : ÉDITION ESSENTIELLE v0.2.200 (puce « Comptes supprimés +
     guide... », Tableau 5.1 + ligne v0.2.200, couverture, 200 versions /
     31 jours, marqueurs verifier) ;
  4) générateur/constructeur v0.2.200 embarqués ; VERSION = 0.2.200,
     MANIFEST-LIVRAISON.txt régénéré.
  Héritage v0.2.199 intégralement conservé (installation Linux tout-en-un,
  ports modifiables, lanceurs).

Intégrité vérifiée (testzip) + contrôles + MD5 affichés.
"""
import os, zipfile, hashlib, shutil, tempfile, subprocess

REF_COMPLET = "/home/z/my-project/download/service-rh-scripts-site-web-v0.2.199.zip"
REF_LEGER   = "/home/z/my-project/download/service-rh-scripts-site-web-v0.2.199-leger.zip"
SORTIE      = "/home/z/my-project/download"
VERSION     = "v0.2.200"
BASE_VIERGE = "/home/z/my-project/scripts/base-vierge/custom.db"

README_NOUVEAU = "/home/z/my-project/download/servicerh-readme-technique-v0.2.200.pdf"
FICHIERS_REMPLACES = {
    # (v0.2.200) base VIERGE : remplace la base embarquée v0.2.199 (3 comptes)
    "db/custom.db": BASE_VIERGE,
    # (v0.2.199) serveur + relance + lanceurs + installeur — réécrits à l'identique depuis l'arbre
    "scripts/portail-server.js": "/home/z/my-project/scripts/portail-server.js",
    "scripts/redemarrer-services-4000-4001.js": "/home/z/my-project/scripts/redemarrer-services-4000-4001.js",
    "DEMARRER-LINUX-MAC.sh": "/home/z/my-project/DEMARRER-LINUX-MAC.sh",
    "DEMARRER-PORTAIL-LINUX-MAC.sh": "/home/z/my-project/DEMARRER-PORTAIL-LINUX-MAC.sh",
    "DEMARRER-TOUT-LINUX-MAC.sh": "/home/z/my-project/DEMARRER-TOUT-LINUX-MAC.sh",
    "DEMARRER-SILENCIEUX-WINDOWS.vbs": "/home/z/my-project/DEMARRER-SILENCIEUX-WINDOWS.vbs",
    "INSTALLER-DEMARRAGE-AUTOMATIQUE-WINDOWS.vbs": "/home/z/my-project/INSTALLER-DEMARRAGE-AUTOMATIQUE-WINDOWS.vbs",
    "DEMARRER-WINDOWS.bat": "/home/z/my-project/DEMARRER-WINDOWS.bat",
    "DEMARRER-PORTAIL-WINDOWS.bat": "/home/z/my-project/DEMARRER-PORTAIL-WINDOWS.bat",
    "DEMARRER-TOUT-WINDOWS.bat": "/home/z/my-project/DEMARRER-TOUT-WINDOWS.bat",
    "scripts/service-paiesage.js": "/home/z/my-project/scripts/service-paiesage.js",
    "prisma/schema.prisma": "/home/z/my-project/prisma/schema.prisma",
    "src/lib/mailer.ts": "/home/z/my-project/src/lib/mailer.ts",
    "src/app/api/mail-config/route.ts": "/home/z/my-project/src/app/api/mail-config/route.ts",
    "src/components/payslip/mail-panel.tsx": "/home/z/my-project/src/components/payslip/mail-panel.tsx",
    "scripts/test_v094_routage_emails.js": "/home/z/my-project/scripts/test_v094_routage_emails.js",
    "src/components/payslip/demandes-tab.tsx": "/home/z/my-project/src/components/payslip/demandes-tab.tsx",
    "src/components/payslip/signature-panel-reponses.tsx": "/home/z/my-project/src/components/payslip/signature-panel-reponses.tsx",
    "src/components/payslip/signature-panel.tsx": "/home/z/my-project/src/components/payslip/signature-panel.tsx",
    "src/app/page.tsx": "/home/z/my-project/src/app/page.tsx",
    "src/lib/page.tsx": "/home/z/my-project/src/lib/page.tsx",
    "scripts/test_v02193_notifications_toujours.js": "/home/z/my-project/scripts/test_v02193_notifications_toujours.js",
}
NOUVEAUX = {
    # (v0.2.200) guide + base vierge (traçabilité) + preuve + chaîne README/ZIP
    "GUIDE-INSTALLATION-LINUX-WINDOWS.txt": "/home/z/my-project/GUIDE-INSTALLATION-LINUX-WINDOWS.txt",
    "scripts/base-vierge/custom.db": BASE_VIERGE,
    "scripts/base-vierge/LISEZMOI.txt": "/home/z/my-project/scripts/base-vierge/LISEZMOI.txt",
    "scripts/test_v02200_guide_comptes.js": "/home/z/my-project/scripts/test_v02200_guide_comptes.js",
    "scripts/transformer_readme_v02200.py": "/home/z/my-project/scripts/transformer_readme_v02200.py",
    "scripts/creer_readme_essentiel_v02200.py": "/home/z/my-project/scripts/creer_readme_essentiel_v02200.py",
    "scripts/construire-zip-v02200.py": "/home/z/my-project/scripts/construire-zip-v02200.py",
}


def md5(fichier):
    h = hashlib.md5()
    with open(fichier, "rb") as f:
        for bloc in iter(lambda: f.read(1 << 20), b""):
            h.update(bloc)
    return h.hexdigest()


def crlf_ok(data):
    return b"\n" in data and data.count(b"\n") == data.count(b"\r\n")


def comptes_dans_base(chemin_db):
    """Vérification RÉELLE : ouvre la base avec Prisma et compte les users."""
    code = (
        "const {PrismaClient}=require('@prisma/client');"
        "const prisma=new PrismaClient({datasources:{db:{url:'file:" + chemin_db.replace("\\", "/") + "'}}});"
        "prisma.user.count().then(n=>{console.log('USERS='+n);return prisma.$disconnect();})"
        ".catch(e=>{console.error(e.message);process.exit(1);});"
    )
    r = subprocess.run(["node", "-e", code], cwd="/home/z/my-project",
                       capture_output=True, text=True, timeout=90)
    m = [l for l in r.stdout.splitlines() if l.startswith("USERS=")]
    if not m:
        raise RuntimeError("comptage impossible : " + (r.stderr or r.stdout)[-300:])
    return int(m[0].split("=")[1])


def construire(ref_zip, nom_sortie, mode):
    chemin_sortie = os.path.join(SORTIE, nom_sortie)
    ref = zipfile.ZipFile(ref_zip)
    noms = [n for n in ref.namelist() if n != "MANIFEST-LIVRAISON.txt"]
    with zipfile.ZipFile(chemin_sortie, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as out:
        for n in noms:
            if n == "VERSION":
                continue
            if n in FICHIERS_REMPLACES:
                out.write(FICHIERS_REMPLACES[n], n)
                continue
            if n == "service-rh-readme-technique.pdf":
                out.write(README_NOUVEAU, n)
                continue
            if n == "servicerh-readme-technique-reduit.pdf" and mode == "COMPLET":
                out.write(README_NOUVEAU, n)
                continue
            out.writestr(n, ref.read(n))
        for arc, src in NOUVEAUX.items():
            out.write(src, arc)
        out.writestr("VERSION", "0.2.200\n")
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
    test199 = zf.read("scripts/test_v02199_installeur_linux.js").decode("utf-8", "replace")
    test200 = zf.read("scripts/test_v02200_guide_comptes.js").decode("utf-8", "replace")
    installeur = zf.read("INSTALLER-ET-DEMARRER-LINUX-MAC.sh").decode("utf-8", "replace")
    guide = zf.read("GUIDE-INSTALLATION-LINUX-WINDOWS.txt").decode("utf-8", "replace")
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

    # ---- VÉRIFICATION RÉELLE : la base du ZIP COMPLET est VIERGE ----
    # (le ZIP LEGER n'embarque PAS de base : règle historique — les lanceurs
    #  la créent au premier démarrage ; contrôle = absence)
    nb_users, taille_db = -1, 0
    if "db/custom.db" in noms:
        with tempfile.TemporaryDirectory() as tmp:
            chemin_db = os.path.join(tmp, "custom.db")
            with open(chemin_db, "wb") as f:
                f.write(zf.read("db/custom.db"))
            nb_users = comptes_dans_base(chemin_db)
            taille_db = os.path.getsize(chemin_db)

    verifs = {
        "testzip": bad is None,
        "VERSION 0.2.200": zf.read("VERSION").decode().strip() == "0.2.200",
        # ---- NOUVEAU v0.2.200 : BASE VIERGE (comptes supprimés) ----
        "BASE VIERGE RÉELLE : db/custom.db du ZIP contient ZÉRO compte":
          (mode == "LEGER" and "db/custom.db" not in noms) or nb_users == 0,
        "base vierge : schéma appliqué (taille cohérente, non vide)":
          mode == "LEGER" or (100000 < taille_db < 500000),
        "base vierge : archive de traçabilité scripts/base-vierge/ embarquée":
          "scripts/base-vierge/custom.db" in noms and "scripts/base-vierge/LISEZMOI.txt" in noms,
        "test dédié 200 embarqué (comptes + guide)":
          "scripts/test_v02200_guide_comptes.js" in noms and
          "ZÉRO compte utilisateur" in test200 and
          "GUIDE-INSTALLATION-LINUX-WINDOWS.txt" in test200,
        # ---- NOUVEAU v0.2.200 : GUIDE INSTALLATION + PORTS ----
        "GUIDE présent à la racine du ZIP":
          "GUIDE-INSTALLATION-LINUX-WINDOWS.txt" in noms,
        "GUIDE = installation LINUX (script tout-en-un + unzip + Node 20)":
          guide.startswith("=") and "INSTALLATION SOUS LINUX / macOS" in guide and
          "bash INSTALLER-ET-DEMARRER-LINUX-MAC.sh" in guide and
          "nohup" in guide and "DEMARRER-TOUT-LINUX-MAC.sh" in guide,
        "GUIDE = installation WINDOWS (3 .bat + .vbs + menu superadmin)":
          "INSTALLATION SOUS WINDOWS" in guide and
          "DEMARRER-WINDOWS.bat" in guide and "DEMARRER-PORTAIL-WINDOWS.bat" in guide and
          "DEMARRER-TOUT-WINDOWS.bat" in guide and "DEMARRER-SILENCIEUX-WINDOWS.vbs" in guide and
          "CREER-SUPERADMIN-WINDOWS.bat" in guide,
        "GUIDE = CHANGEMENT DES PORTS (PORT / PORTAL_PORT .env, 2 systèmes, valeurs DIFFÉRENTES)":
          "CHANGER LES PORTS DES DEUX INTERFACES" in guide and
          "PORT         = port de l'ADMINISTRATION RH/IT (defaut 3000)" in guide and
          "PORTAL_PORT  = port du PORTAIL EMPLOYES     (defaut 4001)" in guide and
          "DOIVENT etre DIFFERENTES" in guide and
          "relisent le .env a chaque demarrage" in guide,
        "GUIDE = base VIERGE annoncée + politique mot de passe + problèmes courants":
          "VIERGE : AUCUN compte" in guide and "supprimes," in guide and
          "8 caracteres minimum" in guide and "EADDRINUSE" in guide,
        "GUIDE = ASCII strict (aucun souci d'encodage)":
          all(ord(c) < 127 for c in guide),
        # ---- héritage v0.2.199 : INSTALLATION LINUX TOUT-EN-UN ----
        "installeur = présent à la racine du ZIP":
          "INSTALLER-ET-DEMARRER-LINUX-MAC.sh" in noms,
        "installeur = Node vérifié + .env préparé (base + secret gardé + dossiers)":
          installeur.startswith("#!/usr/bin/env bash") and
          "node scripts/gen-secret.js" in installeur and
          'export DATABASE_URL="file:${PROJECT_DIR}/db/custom.db"' in installeur and
          "export AUTH_SECRET=" in installeur and
          'if [ -f "${PROJECT_DIR}/db/custom.db" ]' in installeur and
          "cle de chiffrement actuelle conservee" in installeur,
        "installeur = lignes PORT/PORTAL_PORT ajoutées SI absentes (héritage 198)":
          "grep -q '^PORT=' .env.tmp" in installeur and
          "printf 'PORTAL_PORT=4001\\n'" in installeur and
          'PORT="${PORT:-3000}"' in installeur and
          'PORTAL_PORT="${PORTAL_PORT:-4001}"' in installeur,
        "installeur = dépendances CLI locaux (Task 89/92), AUCUN npx en commande":
          "node_modules/prisma/build/index.js" in installeur and
          "node_modules/next/dist/bin/next" in installeur and
          "node_modules/nodemailer/package.json" in installeur and
          "node node_modules/prisma/build/index.js db push" in installeur and
          "node node_modules/next/dist/bin/next build" in installeur,
        "installeur = CRÉATION ADMINISTRATEUR (interactif masqué + SUPERADMIN_* non interactif)":
          "read -rs ADMIN_MDP" in installeur and
          "[ -t 0 ]" in installeur and
          "--email \"${SUPERADMIN_EMAIL}\"" in installeur and
          '--nom "${SUPERADMIN_NOM:-Administrateur}"' in installeur and
          "--password \"${SUPERADMIN_PASSWORD}\"" in installeur and
          "INSTALLER_SANS_ADMIN=1" in installeur and
          "node scripts/creer-superadmin.js" in installeur,
        "installeur = démarrage des DEUX interfaces (nohup, journaux, PIDs, arrêt)":
          "nohup node scripts/start-prod.js" in installeur and
          "nohup node scripts/portail-server.js" in installeur and
          "ADMIN_PID=$!" in installeur and "PORTAL_PID=$!" in installeur and
          "kill $ADMIN_PID $PORTAL_PID" in installeur and
          "paiesage-admin.log" in installeur and "paiesage-portail.log" in installeur,
        "installeur = URLS sur ports du .env + build conditionnel (verifier-build-a-jour)":
          "http://localhost:${PORT}" in installeur and
          "http://localhost:${PORTAL_PORT}" in installeur and
          "node scripts/verifier-build-a-jour.js" in installeur and
          "http://localhost:3000" not in installeur and
          "http://localhost:4001" not in installeur,
        "test dédié 199 embarqué (héritage)":
          "scripts/test_v02199_installeur_linux.js" in noms and
          "INSTALLER-ET-DEMARRER-LINUX-MAC.sh" in test199 and
          "SUPERADMIN_EMAIL" in test199,
        # ---- héritage v0.2.198 : PORTS MODIFIABLES ----
        "portail = plus AUCUN repli sur PORT (héritage 198)":
          'const PORT = parseInt(process.env.PORTAL_PORT || "4001", 10);' in portail and
          "process.env.PORTAL_PORT || process.env.PORT" not in portail,
        "portail = commentaire du correctif EADDRINUSE (héritage 198)":
          "PLUS de repli sur PORT" in portail and "EADDRINUSE" in portail,
        "DEMARRER-WINDOWS.bat = PORT du .env + URLs !PORT! (héritage 198)":
          'set "PORT=3000"' in dem_win and 'findstr /B /C:"PORT="' in dem_win and
          'start "" http://localhost:!PORT!' in dem_win and
          "localhost:3000" not in dem_win,
        "DEMARRER-PORTAIL-WINDOWS.bat = PORTAL_PORT + plus de 3001 (héritage 198)":
          'set "PORTAL_PORT=4001"' in dem_por and
          'start "" http://localhost:!PORTAL_PORT!' in dem_por and
          "3001" not in dem_por,
        "DEMARRER-TOUT-WINDOWS.bat = les DEUX variables (héritage 198)":
          'findstr /B /C:"PORT="' in dem_tout and 'findstr /B /C:"PORTAL_PORT="' in dem_tout and
          "localhost:3000" not in dem_tout and "localhost:3001" not in dem_tout,
        "3 .bat Windows = CRLF intégral (héritage 198)":
          all(crlf_ok(zf.read(f)) for f in
              ("DEMARRER-WINDOWS.bat", "DEMARRER-PORTAIL-WINDOWS.bat", "DEMARRER-TOUT-WINDOWS.bat")),
        "3 .sh Linux = ports du .env (héritage 198)":
          "grep -E '^PORT=' .env" in dem_linux and
          "grep -E '^PORTAL_PORT=' .env" in por_linux and
          "grep -E '^PORTAL_PORT=' .env" in tout_linux and
          "localhost:4000" not in dem_linux and "localhost:4001" not in por_linux,
        "2 .vbs = LirePortAdmin + énoncé 4000/4001 (héritage 198)":
          "Function LirePortAdmin" in sil_vbs and
          'sh.Run "http://localhost:" & portAdmin' in sil_vbs and
          "administration port 4000 + portail port 4001" in inst_vbs and
          "port 3000 + portail port 3001" not in inst_vbs,
        "service-paiesage = lirePortEnv + priorité PAIESAGE_PORT_* (héritage 198)":
          "function lirePortEnv(cle, defaut)" in paiesage and
          "process.env.PAIESAGE_PORT_ADMIN || lirePortEnv" in paiesage and
          "process.env.PAIESAGE_PORT_PORTAIL || lirePortEnv" in paiesage,
        "redemarrer-services = lirePortEnv (héritage 198)":
          "function lirePortEnv(cle, defaut)" in redem and
          'lirePortEnv("PORT", 4000)' in redem and
          'lirePortEnv("PORTAL_PORT", 4001)' in redem,
        "lanceurs Windows réintégrés + exclusions historiques (héritage 198)":
          all(x in noms for x in ("DEMARRER-WINDOWS.bat", "DEMARRER-PORTAIL-WINDOWS.bat",
                                  "DEMARRER-TOUT-WINDOWS.bat", "scripts/service-paiesage.js")) and
          not any(x in noms for x in ("SCINDER-DOCX-WINDOWS.bat", "SCINDER-EXCEL-WINDOWS.bat",
                                      "SCINDER-FICHES-WINDOWS.bat", "SECURISER-DOSSIER-WINDOWS.bat",
                                      "SECURISER-DOSSIERS-WINDOWS.bat")),
        "test dédié 198 embarqué (héritage)":
          "scripts/test_v02198_ports.js" in noms and "LirePortAdmin" in test198,
        # ---- héritage v0.2.197 : parrainage EN COPIE ----
        "schema = parrainageCopieEmail (héritage 197)":
          'parrainageCopieEmail    String @default("")' in schema and "v0.2.197" in schema,
        "portail = lireConfigMailDemandes expose parrainageCopieEmail (héritage 197)":
          -1 < i_config and -1 < i_parr_copie_cfg and i_config < i_parr_copie_cfg,
        "portail = bloc copie couvre le PARRAINAGE (héritage 197)":
          -1 < i_envoi and -1 < i_type_parr and i_envoi < i_type_parr and
          "if (typeValidation || typeAttestation || typeParrainage) {" in portail,
        "portail = copie identique IGNORÉE + JOURNALISÉE (héritage 197)":
          -1 < i_ignoree and "COPIE_IDENTIQUE_PRINCIPAL" in portail,
        "portail = commentaires v0.2.197 (héritage)":
          portail.count("v0.2.197") >= 8,
        "mailer.ts = type + lectures parrainageCopieEmail (héritage 197)":
          mailer.count("parrainageCopieEmail") >= 5 and
          "parrainageCopieEmail: string;" in mailer,
        "API mail-config = persistance parrainageCopieEmail (héritage 197)":
          'String(body?.parrainageCopieEmail ?? "").trim()' in api and
          "parrainageCopieEmail," in api,
        "mail-panel = champ « demandes de parrainage (copie) » (héritage 197)":
          "E-mail dédié — demandes de parrainage (copie)" in mail_panel and
          'id="mail-parrainage-copie"' in mail_panel,
        "mail-panel = 5 descriptions « Reçoit une COPIE » (héritage)":
          mail_panel.count("Reçoit une <b>COPIE</b>") == 5,
        "test 197 + preuve UI embarqués (héritage)":
          "scripts/test_v02197_parrainage_copie.js" in noms and
          "COPIE_IDENTIQUE_PRINCIPAL" in test197 and
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
        # ---- héritage v0.2.195/194 : carte manager + certificat masqué ----
        "demandes-tab = estRh + ternaire (héritage 195)":
          'const estRh = role === "RH";' in demandes_tab and
          demandes_tab.find("{estRh ? (") > -1,
        "demandes-tab = panneaux masquerCertificat (héritage 194/186)":
          '<SignaturePanelReponses masquerCertificat={role === "RH"} />' in demandes_tab and
          '<ReponsePdfPanel masquerCertificat={role === "RH"} />' in demandes_tab,
        "réponses + importer = garde masquerCertificat (héritage 194)":
          "masquerCertificat = false," in sp_reponses and
          sp_reponses.count("{!masquerCertificat && (") == 1 and
          "masquerCertificat = false," in sp_import and
          sp_import.count("{!masquerCertificat && (") == 1,
        "page app/lib = <SignaturePanel masquerCertificat ... /> (héritage 194)":
          '<SignaturePanel masquerCertificat={me?.role === "RH"} />' in page_app and
          '<SignaturePanel masquerCertificat={me?.role === "RH"} />' in page_lib,
        # ---- héritage v0.2.193 : notifications toujours envoyées ----
        "portail = drapeaux avecPdfDecision + trace TOUJOURS (héritage 193)":
          "const avecPdfDecision = {" in portail and
          "manager: emailActifDecision && envoyerManagerDecision," in portail and
          "notification TOUJOURS envoyée" in portail and
          'code: "ENVOI_DESACTIVE"' not in portail,
        "module acc. = destinataires TOUJOURS complets (héritage 193)":
          "manager: ctx.emailManager || ''," in acceptation_src,
        "panneau 186 + colonne Actions collante 192 (héritage)":
          "masquerCertificat = false," in panel and
          "sticky right-0 z-10 bg-card text-right border-l border-border/60" in users_tab,
        # ---- README v0.2.200 ----
        "README = édition essentielle (V0.2.200, plus V0.2.199 en bandeau)":
          "V0.2.200" in sans_esp and "V0.2.199" not in sans_esp,
        "README = puce « Comptes supprimés + guide d'installation et des ports (v0.2.200) »":
          "Comptessupprimés+guided'installationetdesports(v0.2.200)" in sans_esp,
        "README = base VIERGE annoncée (ZÉRO compte)":
          "ZÉROcompte" in sans_esp and "BASEVIERGE" in sans_esp,
        "README = Tableau 5.1 ligne v0.2.200 (COMPTES SUPPRIMÉS + GUIDE)":
          "COMPTESSUPPRIMÉS+GUIDED'INSTALLATION" in sans_esp,
        "README = GUIDE-INSTALLATION-LINUX-WINDOWS cité": "GUIDE-INSTALLATION-LINUX-WINDOWS" in sans_esp,
        "README = changement de ports documenté (PORT=8080 exemple)":
          "PORT=8080" in sans_esp and "PORTAL_PORT=8081" in sans_esp,
        "README = sources v0.2.200 citées": "Codesourcelivrév0.2.200" in sans_esp,
        "README = héritage 199 (v0.2.199 cité)":
          "v0.2.199" in sans_esp and "INSTALLATIONLINUXTOUT-EN-UN" in sans_esp,
        "README = héritage 198/197 cités": "v0.2.198" in sans_esp and "v0.2.197" in sans_esp,
        "README = durée du projet (200 versions / 31 jours)":
          ("Duréeduprojet" in sans_esp and "31jours" in sans_esp and "200versions" in sans_esp),
        "README = pages": len(lecteur.pages) >= 20,
        # ---- embarqués ----
        "générateur README 200 embarqué": "scripts/creer_readme_essentiel_v02200.py" in noms,
        "transformateur README 200 embarqué": "scripts/transformer_readme_v02200.py" in noms,
        "constructeur ZIP 200 embarqué": "scripts/construire-zip-v02200.py" in noms,
        "générateur README 199 embarqué": "scripts/creer_readme_essentiel_v02199.py" in noms,
        "constructeur ZIP 199 embarqué": "scripts/construire-zip-v02199.py" in noms,
        "test 199 embarqué": "scripts/test_v02199_installeur_linux.js" in noms,
        "générateur README 198 embarqué": "scripts/creer_readme_essentiel_v02198.py" in noms,
        "constructeur ZIP 198 embarqué": "scripts/construire-zip-v02198.py" in noms,
        "test 198 embarqué": "scripts/test_v02198_ports.js" in noms,
        "générateur README 197 embarqué": "scripts/creer_readme_essentiel_v02197.py" in noms,
        "constructeur ZIP 197 embarqué": "scripts/construire-zip-v02197.py" in noms,
        "test 197 embarqué": "scripts/test_v02197_parrainage_copie.js" in noms,
        "test 196 embarqué": "scripts/test_v02196_attestations_copie.js" in noms,
        "test 193 notifications embarqué": "scripts/test_v02193_notifications_toujours.js" in noms,
        "test scénario manager-off (v0.2.193) embarqué": "scripts/test_v02193_scenario_manager_off_pieces.js" in noms,
        "test interrupteurs 191 embarqué": "scripts/test_v02191_interrupteurs_email.js" in noms,
        "test interrupteurs 190 embarqué": "scripts/test_v02190_interrupteurs_destinataires.js" in noms,
        "test certificat dédié masqué 186 embarqué": "scripts/test_v02186_masquer_certificat_rh.js" in noms,
        "route upload présente": "src/app/api/payslips/upload/route.ts" in noms,
        "reduit présent": "servicerh-readme-technique-reduit.pdf" in noms or mode == "LEGER",
        "VBS chiffrer-fiches-silencieux ABSENT": not any("CHIFFRER-FICHES-SILENCIEUX" in n for n in noms),
        "0 PDF v0.2.186→199 restant": not any((s in n) for n in noms for s in ("-v0.2.186.pdf", "-v0.2.187.pdf", "-v0.2.188.pdf", "-v0.2.189.pdf", "-v0.2.190.pdf", "-v0.2.191.pdf", "-v0.2.192.pdf", "-v0.2.193.pdf", "-v0.2.194.pdf", "-v0.2.195.pdf", "-v0.2.196.pdf", "-v0.2.197.pdf", "-v0.2.198.pdf", "-v0.2.199.pdf")),
    }
    zf.close()
    return verifs


def main():
    print("=== Construction v0.2.200 (comptes supprimés + guide installation/ports) ===\n")
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
