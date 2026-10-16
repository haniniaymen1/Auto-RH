#!/usr/bin/env python3
"""Task 84 (19/09/2026) : cercles du portail employés passés du BLEU au VERT.

DEMANDE UTILISATEUR : « change le de ces cercle vers vert » (+ capture du
cercle bleu « 2 » de la page /otp — badge d'étape .etq-etape).

CHANGEMENTS (scripts/portail-server.js) :
  - badge d'étape .etq-etape (cercles « 1 » / « 2 » de /premiere et /otp) :
    fond #2563eb → #059669 (le vert des boutons), ombre portée
    rgba(37, 99, 235, 0.28) → rgba(5, 150, 105, 0.28) ;
  - cercles d'icônes .icon-rond (cadenas /premiere, utilisateur /login,
    /changer) : même passage au vert ;
  - couleurs uniquement : 4 blocs CSS (LOGIN, /changer, CSS_OTP partagé,
    fiches) — 8 cercles + 8 ombres ; AUCUNE règle fonctionnelle touchée
    (connexion, QR, OTP, quotas, messages strictement identiques).

Nouveaux : test84_cercles_verts.py (26 vérif.) + test84_harnais.sh.
Remplacés : portail, package.json (0.2.24), README (§49), suites réalignées
version 74/75/76/78/80/81/82 + test83 enrichie (cercles verts).
Compte : 282 (état Task 83) + 2 nouveaux = 284 fichiers.
Hérite de la chaîne : 34 -> … -> 80 -> 81 -> 83 -> 84.
"""
import zipfile, shutil, os, subprocess, sys, hashlib

BASE = "/home/z/my-project"
SRC = os.path.join(BASE, "download/auto-rh-scripts-site-web.zip")
COPIES = [
    os.path.join(BASE, "download/Fiches-de-Paie-v5-portail-securise-OTP.zip"),
    os.path.join(BASE, "download/auto-rh.zip"),
]
ATTENDU = 307  # (MODIFIÉ Task 94) 306 (état Task 93) + 1 fichier Task 94 (test94_politique_complexite)

FILES = [
    ("scripts/portail-server.js", "scripts/portail-server.js", False),
    ("package.json", "package.json", False),
    ("README-DEPLOIEMENT-LOCAL.md", "README-DEPLOIEMENT-LOCAL.md", False),
    ("scripts/test74_otp_qr.py", "scripts/test74_otp_qr.py", False),
    ("scripts/test75_otp_premiere_connexion.py", "scripts/test75_otp_premiere_connexion.py", False),
    ("scripts/test76_otp_qr_chaque_connexion.py", "scripts/test76_otp_qr_chaque_connexion.py", False),
    ("scripts/test78_totp_authenticator.py", "scripts/test78_totp_authenticator.py", False),
    ("scripts/test80_qr_seul.py", "scripts/test80_qr_seul.py", False),
    ("scripts/test81_reconnexion_apres_scan.py", "scripts/test81_reconnexion_apres_scan.py", False),
    ("scripts/test82_champ_otp_connexion.py", "scripts/test82_champ_otp_connexion.py", False),
    ("scripts/test83_premiere_connexion_moderne.py", "scripts/test83_premiere_connexion_moderne.py", False),
    ("scripts/test84_cercles_verts.py", "scripts/test84_cercles_verts.py", False),
    ("scripts/test84_harnais.sh", "scripts/test84_harnais.sh", False),
]


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


# 1) Chaîne cumulative jusqu'à la Task 83
r = subprocess.run([sys.executable, os.path.join(BASE, "scripts/update_zip_task83.py")])
if r.returncode != 0:
    print("OVERLAY PRECEDENT EN ECHEC — arrêt.")
    sys.exit(1)

# 2) Overlay Task 84 : remplacements + ajouts (sans doublons)
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
    pkg = zz.read("package.json").decode("utf-8", errors="replace")
    readm = zz.read("README-DEPLOIEMENT-LOCAL.md").decode("utf-8", errors="replace")
    t83 = zz.read("scripts/test83_premiere_connexion_moderne.py").decode("utf-8", errors="replace")
    t84 = zz.read("scripts/test84_cercles_verts.py").decode("utf-8", errors="replace")
    t84sh = zz.read("scripts/test84_harnais.sh").decode("utf-8", errors="replace")
    t74 = zz.read("scripts/test74_otp_qr.py").decode("utf-8", errors="replace")

    def check(nom, cond, detail=""):
        global ok
        print(f"   {nom} : {'OK' if cond else 'KO'}{'' if cond else ' — ' + str(detail)}")
        if not cond:
            ok = False

    # --- Contrôles Task 84 : cercles verts ---
    check("portail : AUCUN bleu restant (#2563eb et rgba(37, 99, 235 absents)",
          "#2563eb" not in portail and "rgba(37, 99, 235" not in portail)
    check("portail : 8 cercles VERTS #059669 (4 .icon-rond + 4 .etq-etape)",
          portail.count("border-radius: 50%; background: #059669;") == 8)
    check("portail : 8 ombres portées VERTES rgba(5, 150, 105, 0.28)",
          portail.count("box-shadow: 0 6px 14px rgba(5, 150, 105, 0.28);") == 8)
    check("portail : 4 blocs CSS complets (.icon-rond + .etq-etape)",
          portail.count(".icon-rond {") == 4 and portail.count(".etq-etape {") == 4)
    check("portail : commentaires « cercle icône vert » (×4) + en-tête Task 84",
          portail.count("cercle icône vert") == 4
          and "MODIFIÉ Task 84" in portail
          and "change le de ces cercle vers vert" in portail)
    check("portail : badge d'étape « 2 » de la page Configuration OTP toujours servi",
          '<span class="etq-etape" aria-hidden="true">2</span>' in portail)

    # --- Design Task 83 intact ---
    check("portail : design maquette inchangé (fond #f4f6fb ×4, cartes, oeil, notes vertes)",
          portail.count("background: #f4f6fb;") == 4
          and portail.count("box-shadow: 0 12px 34px rgba(15, 23, 42, 0.07);") == 4
          and ".oeil {" in portail and ".note-verte {" in portail and ".expire-note {" in portail)

    # --- Invariants fonctionnels (changement strictement CSS) ---
    check("invariant Task 78 : QR otpauth://totp standard + verifyTotp conservés",
          '"otpauth://totp/"' in portail and "verifyTotp" in portail)
    check("invariant Task 83 : /premiere + orientation mustChangePassword + verrou QR conservés",
          'id="form-premiere"' in portail and 'redirect: "/premiere",' in portail
          and "const premiereInscription = !acc.lastLoginAt && !acc.qrPresente;" in portail)
    check("invariant Task 64 : changement obligatoire conservé (/changer + /api/change-password)",
          "/api/change-password" in portail and 'redirect: "/changer",' in portail)

    # --- Version + suites embarquées ---
    check("package.json : version 0.2.24", '"version": "0.2.24"' in pkg, pkg[:80])
    check("test74 embarqué réaligné version 0.2.24 (NOUVEAU Task 94)",
          'version du produit = 0.2.24 (NOUVEAU Task 94)' in t74
          and 'pkg.get("version") == "0.2.24"' in t74)
    check("test83 embarqué enrichi (cercles verts + version 0.2.24)",
          "cercles du portail EN VERT (Task 84)" in t83 and "0.2.24" in t83)
    check("test84 embarqué (26 vérifications : 0 bleu restant, 8 cercles + 8 ombres verts, pages servies)",
          "Task 84 — cercles du portail employés passés du BLEU au VERT" in t84
          and "AUCUN bleu restant" in t84 and "#2563eb" in t84
          and "SECTION A : pages servies" in t84)
    check("harnais test84 embarqué (COPIE de base, port 4244, trap EXIT)",
          "test84.db" in t84sh and "4244" in t84sh and "trap" in t84sh and "COPIE" in t84sh)
    check("README : section 49 (cercles verts) + sections 47/48 intactes",
          "## 49. Portail employés : les cercles des têtes de carte passent au vert" in readm
          and "## 48. Portail employés : première connexion en 2 étapes (maquette) + design modernisé" in readm
          and "## 47. Portail employés : le champ « Code OTP » directement dans le formulaire de connexion" in readm)

print("TASK84 ZIP:", "TOUT OK" if ok else "ECHEC")
sys.exit(0 if ok else 1)
