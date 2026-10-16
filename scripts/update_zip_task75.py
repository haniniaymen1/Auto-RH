#!/usr/bin/env python3
"""Task 75 (18/09/2026) : PORTAIL EMPLOYÉS — « Qr code s'affiche juste pour
la première connexion » :

  1. RÈGLE NOUVELLE (verrou lastLoginAt, aucune migration de schéma) : la
     vérification en deux étapes (code OTP + QR code, 10 minutes — Task 74)
     n'est exigée qu'à la TOUTE PREMIÈRE connexion d'un employé. Les
     connexions suivantes s'ouvrent DIRECTEMENT après CIN + mot de passe
     (réponse ok + redirect / ou /changer, cinMasked).
  2. SCELLER LA PREMIÈRE CONNEXION : lastLoginAt est écrit PAR
     /api/otp/verify quand le code est confirmé (et par /api/verify pour une
     connexion suivante directe) — un défi abandonné/expiré/annulé
     n'écrit RIEN : la reconnexion exige de nouveau l'OTP.
  3. CHANGEMENT OBLIGATOIRE conservé : pour une connexion suivante,
     mustChangePassword (initial / réinitialisé / expiré) est évalué
     immédiatement dans /api/verify (session pending 10 min → /changer).
  4. DOCUMENTATION : README section 40 + note de mise à jour en tête de la
     section 39 ; page de connexion : « à la PREMIÈRE connexion uniquement ».

Nouveaux :
  - scripts/test75_otp_premiere_connexion.py (43 vérifications : statique +
    flux 1re connexion → scellement → 2e connexion DIRECTE ; annulation et
    expiration qui laissent la première connexion due ; verlu lastLoginAt
    lu en base à chaque étape)
  - scripts/test75_harnais.sh (harnais portable : COPIE + 2 portails
    4210/4211 — TTL normal et TTL 3,5 s)
  - scripts/test74_inserer.js (accès jetables TEST74EXPIRE/TEST74ANNULE +
    mode « lire <CIN> » qui imprime l'état de lastLoginAt)
Remplacés :
  - scripts/portail-server.js  (verrou première connexion + réponse directe)
  - README-DEPLOIEMENT-LOCAL.md (section 40 + note §39)
  - package.json (0.2.4 -> 0.2.5)
  - scripts/test74_otp_qr.py, test74_harnais.sh (réalignés Task 75 — via le
    maillon 74 relancé depuis le disque)
  - scripts/test64_portail.py, test66_champ_motdepasse.py (réalignés Task 75
    — via les maillons 64/66 relancés depuis le disque)
Remis en cohérence (hors archive) :
  - scripts/update_zip_task{38,64,65,66,67,69,70,71,73,74}.py : ATTENDU 263 -> 266
  - scripts/test_task40_securisation_auto.py : ATTENDU 263 -> 266
  - scripts/test_task42_demarrage_unique.py  : ATTENDU 263 -> 266
Compte : 263 (état Task 74) + 3 nouveaux = 266 fichiers.
Hérite de la chaîne : 34 -> 35/35-bis -> 36 -> 37 -> 38/39/40 -> 42 ->
64 -> 65 -> 66 -> 67 -> 69 -> 70 -> 71 -> 73 -> 74 -> 75.
"""
import zipfile, shutil, os, subprocess, sys, hashlib

SRC = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
COPIES = [
    "/home/z/my-project/download/Fiches-de-Paie-v5-portail-securise-OTP.zip",
    "/home/z/my-project/download/auto-rh.zip",
]
BASE = "/home/z/my-project"

# (chemin disque, chemin dans l'archive, conversion CRLF ?)
FILES = [
    # --- Task 75 : QR/OTP uniquement à la première connexion ---
    ("scripts/portail-server.js", "scripts/portail-server.js", False),
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md", False),
    ("package.json", "package.json", False),
    ("scripts/test74_inserer.js", "scripts/test74_inserer.js", False),
    ("scripts/test75_otp_premiere_connexion.py", "scripts/test75_otp_premiere_connexion.py", False),
    ("scripts/test75_harnais.sh", "scripts/test75_harnais.sh", False),
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


# 1) Chaîne cumulative jusqu'à la Task 74 (elle-même bâtie sur 34->...->74)
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task74.py")])
if r.returncode != 0:
    print("OVERLAY PRECEDENT EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Overlay Task 75 : remplacements + ajouts (sans doublons)
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
    readm = zz.read("README-DEPLOIEMENT-LOCAL.md").decode("utf-8", errors="replace")
    pkg = zz.read("package.json").decode("utf-8", errors="replace")
    t75 = zz.read("scripts/test75_otp_premiere_connexion.py").decode("utf-8", errors="replace")
    t75sh = zz.read("scripts/test75_harnais.sh").decode("utf-8", errors="replace")
    t74in = zz.read("scripts/test74_inserer.js").decode("utf-8", errors="replace")
    t74 = zz.read("scripts/test74_otp_qr.py").decode("utf-8", errors="replace")
    t64 = zz.read("scripts/test64_portail.py").decode("utf-8", errors="replace")
    t66 = zz.read("scripts/test66_champ_motdepasse.py").decode("utf-8", errors="replace")

    def check(nom, cond, detail=""):
        global ok
        print(f"   {nom} : {'OK' if cond else 'KO'}{'' if cond else ' — ' + str(detail)}")
        if not cond:
            ok = False

    # --- Contrôles Task 75 (RÉALIGNÉS Task 76) : scellement + QR 1re connexion seulement ---
    check("portail : verrou premiereConnexion = !acc.lastLoginAt",
          "const premiereConnexion = !acc.lastLoginAt" in portail)
    check("(MODIFIÉ Task 85) portail : règle Task 76 documentée dans l'entête (DEUX ÉTAPES À CHAQUE CONNEXION) + demande Task 85",
          "DEUX ÉTAPES À CHAQUE CONNEXION" in portail
          and "jamais affiche le code otp comme ca" in portail)
    check("portail : lastLoginAt JAMAIS écrit dans /api/verify (uniquement à la confirmation OTP)",
          "...(premiereConnexion ? {} : { lastLoginAt: new Date() })" not in portail
          and "lastLoginAt: new Date()," in portail)
    check("(MODIFIÉ Task 86) portail : chaque connexion → défi OTP ALIGNÉ sur la fenêtre du secret + session « otp »",
          "creerDefiOtp(cin, remember, premiereConnexion, secretOtp, fenetre.expireAt)" in portail
          and "createPortalSession(cin, false, false, true)" in portail)
    check("portail : branche directe Task 75 SUPPRIMÉE (aucune session ouverte sans OTP)",
          "doitChangerDirect" not in portail)
    check("portail : changement obligatoire (initial/expiré) évalué APRÈS la confirmation du code",
          "acc.mustChangePassword || estMotDePasseExpire(acc.passwordChangedAt)" in portail
          and 'redirect: "/changer"' in portail)
    check("portail : première connexion SCELLÉE dans /api/otp/verify (lastLoginAt)",
          "lastLoginAt: new Date()," in portail)
    check("(MODIFIÉ Task 85) page de connexion : « Le code OTP n'est JAMAIS affiché à l'écran »",
          "Le code OTP n'est JAMAIS affiché à l'écran" in portail
          and "QR code d'inscription affiché à la PREMIÈRE connexion uniquement" not in portail)
    check("(MODIFIÉ Task 85) portail : invariants Task 74 conservés (QR 10 min, usage unique, 5 tentatives — plus de régénération, gardes ×4)",
          "n <= 600000 ? n : 10 * 60 * 1000" in portail and "OTP_MAX_TENTATIVES = 5" in portail
          and '"/api/otp/nouveau"' not in portail
          and portail.count('code: "OTP_REQUIS"') == 4)

    # --- Tests embarqués Task 75 + réalignés ---
    check("tests Task 75 embarqués (otp_premiere_connexion + harnais 4210/4211 + jeu test74_inserer)",
          "RÉSULTAT TASK 75" in t75 and "test75.db" in t75sh
          and "4210" in t75sh and "4211" in t75sh
          and 'operation === "lire"' in t74in and "TEST74EXPIRE" in t74in)
    check("test74 réaligné Task 76 (accès jetables + OTP obligatoire à chaque connexion)",
          "Task 76" in t74 and "TEST74EXPIRE" in t74
          and "2e connexion ESPA" in t74)
    check("(MODIFIÉ Task 85) test64/test66 réalignés Task 76 (OTP obligatoire à chaque connexion, confirmation par TOTP)",
          "Task 76" in t64 and "code_totp_frais" in t64
          and "Task 76" in t66 and 'premiereConnexion") is False' in t66)

    # --- Version + documentation ---
    check("package.json : version 0.2.24 (MODIFIÉ Task 83)", '"version": "0.2.24"' in pkg, pkg[:80])
    check("README : section 40 (QR uniquement à la 1re connexion) + note de mise à jour §39",
          "## 40. Portail employés : le QR code ne s'affiche qu'à la PREMIÈRE connexion" in readm
          and "Mise à jour (section 40)" in readm)
    check("README : sections 31-39 intactes",
          "## 31. Mots de passe : initial, changement OBLIGATOIRE, expiration tous les 15 jours" in readm
          and "## 38. Accès portail : bandeau vert et puces retirés" in readm
          and "## 39. Portail employés : connexion en DEUX ÉTAPES — code OTP + QR code valables 10 minutes" in readm)

print("MD5 ZIPs :", md5s[0])
print("TASK75 ZIP:", "TOUT OK" if ok else "PROBLEME DETECTE")
sys.exit(0 if ok else 1)
