#!/usr/bin/env python3
"""Task 80 (19/09/2026) : « Dans cette fenêtre, afficher uniquement le QR
code » + « Dans le portail d'administration, ajouter une section dans
« Accès Portal » dédiée à la gestion des QR codes ».

CHANGEMENTS :
  1. PORTAIL EMPLOYÉS — la page /otp de PREMIÈRE connexion devient une page
     d'INSCRIPTION DÉDIÉE : UNIQUEMENT le QR code (format standard
     otpauth://totp/…, Task 78 conservé). L'ancien contenu — paragraphe
     « Format standard », code OTP affiché en clair, compte à rebours,
     formulaire « Confirmez le code OTP », boutons « Valider le code » /
     « Générer un nouveau code » / « Se déconnecter », aide — est RETIRÉ de
     cette fenêtre (conservé tel quel sur la page de CONFIRMATION des
     connexions suivantes). Après le scan, l'employé se RECONNECTE (CIN +
     mot de passe) : la page de confirmation s'ouvre alors. À l'expiration
     (10 min), la page bascule d'elle-même vers « Code OTP expiré ».
  2. VERROU PERSISTANT PortalAccess.qrPresente (migration db push) : posé
     quand la page QR est servie ; le verrou d'affichage devient
     `!lastLoginAt && !qrPresente` — le QR s'affiche UNE SEULE FOIS, même
     après annulation (5 erreurs) ou expiration. /api/otp/verify REFUSE
     (403 OTP_QR_A_SCANNER, sans consommer de tentative) tout code pendant
     le défi « première connexion ».
  3. ADMINISTRATION — nouvelle section « Gestion des QR codes » dans l'onglet
     « Accès portail » : statuts (QR non généré / jamais affiché / affiché —
     code en attente / Actif), compteurs, filtre, « Afficher le QR » (SVG +
     URI otpauth standard, secret persistant créé à la volée) et
     « Réinitialiser le QR » (nouveau secret, qrPresente:false,
     lastUsedWindow:null, nouveau QR pour re-scan immédiat). API
     /api/portal-access enrichie (qrPresente + hasQrSecret booléens — le
     secret ne quitte jamais le serveur) + actions « qr » / « reset-qr ».
  4. SÉCURISATION : le secret TOTP est CHIFFRÉ EN BASE (champ « alea »,
     Task 32 — comme passwordHash) côté portail ET administration ; les
     secrets historiques en clair restent lus tels quels.
  5. CONSERVÉ : règles Tasks 74-79 (QR à la première connexion seule, 10
     minutes, usage unique, 5 tentatives, changement de mot de passe après
     l'OTP, page de confirmation inchangée, double voie code écran /
     application, anti-rejeu).

Nouveaux :
  - scripts/test80_qr_seul.py (76 vérifications)
  - scripts/test80_harnais.sh (COPIE + ports 4218/4219/4220, trap EXIT)
Remplacés :
  - scripts/portail-server.js, prisma/schema.prisma,
    src/app/api/portal-access/route.ts,
    src/components/payslip/portal-access-tab.tsx, package.json (0.2.10),
    README-DEPLOIEMENT-LOCAL.md (§45), test64_inserer.js,
    test64_portail, test65, test66, test67, test69, test70, test71, test73,
    test74, test75, test76, test77, test78 (réalignés sur la nouvelle
    spécification : le code se lit APRÈS la reconnexion).
Remis en cohérence (hors archive) :
  - scripts/patch_attendu_task80.py : ATTENDU 274 -> 276 dans les maillons
    38/64/65/66/67/69/70/71/73/74/75/76/77/78/79 + suites task40/42 ;
    contrôles de version des maillons 74-79 réalignés 0.2.10 ; contrôles de
    composant des maillons 64/65/67/70/71/73/77 réorientés sur la section QR.
Compte : 274 (état Task 79) + 2 nouveaux = 276 fichiers.
Hérite de la chaîne : 34 -> 35/35-bis -> 36 -> 37 -> 38/39/40 -> 42 ->
64 -> 65 -> 66 -> 67 -> 69 -> 70 -> 71 -> 73 -> 74 -> 75 -> 76 -> 77 -> 78
-> 79 -> 80.
"""
import zipfile, shutil, os, subprocess, sys, hashlib

SRC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
COPIES = [
    "/home/z/my-project/download/Fiches-de-Paie-v5-portail-securise-OTP.zip",
    "/home/z/my-project/download/auto-rh.zip",
]
BASE = "/home/z/my-project"

FILES = [
    ("scripts/portail-server.js", "scripts/portail-server.js", False),
    ("prisma/schema.prisma", "prisma/schema.prisma", False),
    ("src/app/api/portal-access/route.ts", "src/app/api/portal-access/route.ts", False),
    ("src/components/payslip/portal-access-tab.tsx", "src/components/payslip/portal-access-tab.tsx", False),
    ("package.json", "package.json", False),
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md", False),
    ("scripts/test64_inserer.js", "scripts/test64_inserer.js", False),
    ("scripts/test64_portail.py", "scripts/test64_portail.py", False),
    ("scripts/test65_remplissage_auto.py", "scripts/test65_remplissage_auto.py", False),
    ("scripts/test66_champ_motdepasse.py", "scripts/test66_champ_motdepasse.py", False),
    ("scripts/test67_repertoire_complet.py", "scripts/test67_repertoire_complet.py", False),
    ("scripts/test69_champ_style.py", "scripts/test69_champ_style.py", False),
    ("scripts/test70_remplissage_auto.py", "scripts/test70_remplissage_auto.py", False),
    ("scripts/test71_tableau_auto.py", "scripts/test71_tableau_auto.py", False),
    ("scripts/test73_recherche_bouton.py", "scripts/test73_recherche_bouton.py", False),
    ("scripts/test74_otp_qr.py", "scripts/test74_otp_qr.py", False),
    ("scripts/test75_otp_premiere_connexion.py", "scripts/test75_otp_premiere_connexion.py", False),
    ("scripts/test76_otp_qr_chaque_connexion.py", "scripts/test76_otp_qr_chaque_connexion.py", False),
    ("scripts/test77_sans_barre_cin.py", "scripts/test77_sans_barre_cin.py", False),
    ("scripts/test78_totp_authenticator.py", "scripts/test78_totp_authenticator.py", False),
    ("scripts/test80_qr_seul.py", "scripts/test80_qr_seul.py", False),
    ("scripts/test80_harnais.sh", "scripts/test80_harnais.sh", False),
]

ATTENDU = 307  # (MODIFIÉ Task 94) 306 (état Task 93) + 1 fichier Task 94 (test94_politique_complexite)


def lire(src, crlf):
    data = open(os.path.join(BASE, src), "rb").read()
    if crlf:
        data = data.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
    return data


def md5(chemin):
    h = hashlib.md5()
    with open(chemin, "rb") as f:
        for bloc in iter(lambda: f.read(1 << 20), b""):
            h.update(bloc)
    return h.hexdigest()


# 1) Chaîne cumulative jusqu'à la Task 79 (elle-même bâtie sur 34->...->79)
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task79.py")])
if r.returncode != 0:
    print("OVERLAY PRECEDENT EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Overlay Task 80 : remplacements + ajouts (sans doublons)
tmp = SRC + ".tmp"
with zipfile.ZipFile(SRC, "r") as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    exclus = {arc for _, arc, _ in FILES}
    for item in zin.infolist():
        if item.filename in exclus:
            continue
        zout.writestr(item, zin.read(item.filename))
    for src, arc, crlf in FILES:
        zout.writestr(arc, lire(src, crlf))
os.replace(tmp, SRC)
for c in COPIES:
    shutil.copyfile(SRC, c)

# 3) Contrôles automatiques
ok = True
md5s = [md5(SRC)] + [md5(c) for c in COPIES]
for z, empreinte in zip([SRC] + COPIES, md5s):
    with zipfile.ZipFile(z) as zz:
        bad = zz.testzip()
        liste = zz.namelist()
        names = set(liste)
        manquants = [arc for _, arc, _ in FILES if arc not in names]
        doublons = len(liste) != len(names)
        identique = empreinte == md5s[0]
        print(f"OK {os.path.basename(z)} : {len(names)} fichiers (attendu {ATTENDU}), intégrité={'OK' if bad is None else 'KO'}, doublons={'OUI!' if doublons else 'non'}, taille={os.path.getsize(z)//1024} Ko")
        if manquants:
            ok = False
            print(f"   MANQUANTS : {manquants}")
        if bad is not None or doublons or len(names) != ATTENDU or not identique:
            ok = False

with zipfile.ZipFile(SRC) as zz:
    portail = zz.read("scripts/portail-server.js").decode("utf-8", errors="replace")
    schema = zz.read("prisma/schema.prisma").decode("utf-8", errors="replace")
    route_ts = zz.read("src/app/api/portal-access/route.ts").decode("utf-8", errors="replace")
    tsx = zz.read("src/components/payslip/portal-access-tab.tsx").decode("utf-8", errors="replace")
    pkg = zz.read("package.json").decode("utf-8", errors="replace")
    readm = zz.read("README-DEPLOIEMENT-LOCAL.md").decode("utf-8", errors="replace")
    t80 = zz.read("scripts/test80_qr_seul.py").decode("utf-8", errors="replace")
    t80sh = zz.read("scripts/test80_harnais.sh").decode("utf-8", errors="replace")
    t64p = zz.read("scripts/test64_portail.py").decode("utf-8", errors="replace")
    t74 = zz.read("scripts/test74_otp_qr.py").decode("utf-8", errors="replace")

    def check(nom, cond, detail=""):
        global ok
        print(f"   {nom} : {'OK' if cond else 'KO'}{'' if cond else ' — ' + str(detail)}")
        if not cond:
            ok = False

    # --- Contrôles Task 80 (MODIFIÉ Task 83) : page « Configuration OTP » ---
    check("portail : page d'inscription otpPremiereHtml(defi, svgQr) présente (MODIFIÉ Task 83)",
          "function otpPremiereHtml(defi, svgQr)" in portail)
    i0 = portail.index("function otpPremiereHtml")
    i1 = portail.index("function otpExpireHtml", i0)
    corps_qr = portail[i0:i1]
    check("portail : la fenêtre d'inscription contient le BLOC QR + le champ « Code OTP » + le bouton « Valider » (maquette Task 83), sans code affiché ni compte à rebours",
          'class="otp-qr otp-premiere"' in corps_qr and 'data-payload="' in corps_qr
          and 'id="otp-saisie"' in corps_qr and 'id="btn-otp"' in corps_qr
          and 'id="otp-affiche"' not in corps_qr and "Confirmez le code OTP" not in corps_qr
          and "Générer un nouveau code" not in corps_qr
          and "Se déconnecter" not in corps_qr and 'id="compte"' not in corps_qr)
    check("(MODIFIÉ Task 85) portail : fenêtre de CONFIRMATION des connexions suivantes — QR + champ, AUCUN code ni bouton de régénération",
          'id="otp-affiche"' not in portail and "Confirmez le code OTP" in portail
          and "Générer un nouveau code</button>" not in portail and "Se déconnecter" in portail)
    check("portail : verrou d'affichage !lastLoginAt && !qrPresente + pose du verrou à l'affichage",
          "const premiereConnexion = !acc.lastLoginAt && !acc.qrPresente" in portail
          and "data: { qrPresente: true }" in portail)
    check("portail : refus Task 80 OTP_QR_A_SCANNER SUPPRIMÉ (MODIFIÉ Task 83 : le code est accepté dans la fenêtre d'inscription)",
          'code: "OTP_QR_A_SCANNER"' not in portail and "defi.premiere" in portail)
    check("(MODIFIÉ Task 86) portail : secret TOTP (FENÊTRE d'inscription) CHIFFRÉ en base (Task 32) — lecture déchiffrée",
          "cryptoBd.chiffrerChamp(secret, false)" in portail
          and "cryptoBd.dechiffrerChamp(accTotp.totpSecret)" in portail)
    check("schéma : champ qrPresente (Boolean @default(false))",
          "qrPresente     Boolean   @default(false)" in schema)

    # --- Contrôles Task 80 : administration ---
    check("API admin : actions « qr » et « reset-qr » (SVG + URI otpauth, secret persistant)",
          'action === "qr"' in route_ts and 'action === "reset-qr"' in route_ts
          and "otpauth://totp/" in route_ts and "genererSecretTotp" in route_ts)
    check("(MODIFIÉ Task 86) API admin : reset-qr = nouveau secret + qrPresente:false + lastUsedWindow:null + fenêtre selon l'état",
          "totpSecret: nouveauSecret," in route_ts
          and "otpFenetreCreeA: row.lastLoginAt ? null : new Date()" in route_ts)
    check("API admin : liste enrichie en booléens SEULEMENT (jamais le secret)",
          "hasQrSecret: Boolean(r.totpSecret)" in route_ts
          and "qrPresente: r.qrPresente" in route_ts)
    check("interface : section « Gestion des QR codes » (statuts, Afficher le QR, Réinitialiser le QR)",
          "Gestion des QR codes" in tsx and "Afficher le QR" in tsx
          and "Réinitialiser le QR" in tsx and 'action: "reset-qr"' in tsx)

    # --- Version + documentation + suite embarquée ---
    check("package.json : version 0.2.24", '"version": "0.2.24"' in pkg, pkg[:80])
    check("test74 embarqué réaligné Task 80 (page QR seul + reconnexion + version 0.2.10)",
          "RÉALIGNÉ Task 80" in t74 or "MODIFIÉ Task 80" in t74 or "Task 80" in t74)
    check("(MODIFIÉ Task 85) test64_portail embarqué réaligné (confirmer_otp = TOTP calculé depuis le QR)",
          "REFONTE Task 85" in t64p and "code_totp_frais" in t64p)
    check("test80 embarqué (76 vérifications : page QR seul, verrou, refus, reconnexion, scellement, administration)",
          "RESULTAT TASK 80" in t80 and "OTP_QR_A_SCANNER" in t80 and "0.2.24" in t80
          and "Gestion des QR codes" in t80 and "reset-qr" in t80)
    check("harnais test80 embarqué (COPIE de base, ports 4218/4219/4220, trap EXIT)",
          "test80.db" in t80sh and "4218" in t80sh and "4219" in t80sh and "4220" in t80sh
          and "trap" in t80sh)
    check("README : section 45 (UNIQUEMENT le QR code + gestion des QR codes)",
          "## 45. Fenêtre d'inscription : UNIQUEMENT le QR code" in readm
          and "test80_harnais.sh" in readm and "qrPresente" in readm)
    check("README : sections 31-44 intactes",
          "## 44. Tableau de bord : « CIN détectés » compte désormais les CIN DISTINCTS" in readm
          and "## 43. Portail employés : le QR code devient une vraie inscription « application d'authentification »" in readm
          and "## 31." in readm)

    # --- Invariants Task 78/79 (QR otpauth + CIN distincts intacts) ---
    check("invariant Task 78 : QR otpauth://totp standard toujours dans le portail embarqué",
          '"otpauth://totp/"' in portail
          and '"&issuer=Auto-RH&algorithm=SHA1&digits=6&period=30"' in portail
          and "verifyTotp" in portail)
    check("invariant Task 79 : dédoublonnage CIN distincts toujours dans /api/stats",
          "cinsDistincts" in zz.read("src/app/api/stats/route.ts").decode("utf-8", errors="replace"))

print("TASK80 ZIP:", "TOUT OK" if ok else "ECHEC")
sys.exit(0 if ok else 1)
