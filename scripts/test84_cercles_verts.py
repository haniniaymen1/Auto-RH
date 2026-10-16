#!/usr/bin/env python3
"""
Task 84 — cercles du portail employés passés du BLEU au VERT :
« change le de ces cercle vers vert » (+ capture du cercle bleu « 2 » de la
page /otp — badge d'étape .etq-etape).

CHANGEMENT (scripts/portail-server.js, v0.2.14) :
  - badge d'étape .etq-etape (cercles « 1 » / « 2 » de /premiere et /otp) :
    fond #2563eb → #059669 (vert des boutons), ombre rgba(37,99,235,.28) →
    rgba(5,150,105,.28) ;
  - cercles d'icônes .icon-rond (cadenas /premiere, utilisateur /login,
    /changer) : même passage au vert ;
  - couleurs uniquement : 4 blocs CSS (LOGIN, /changer, CSS_OTP partagé,
    fiches) — 8 cercles + 8 ombres. AUCUNE règle fonctionnelle touchée.

CONTENU (contrôles statiques + pages servies sur COPIE de base, harnais
test84_harnais.sh, portail de test 4244) :
  - section 0 : source — 0 bleu restant, 8 cercles verts + 8 ombres vertes,
    4 blocs complets, design Task 83 intact, invariants fonctionnels ;
  - section A : pages servies /login et /premiere embarquent le CSS vert et
    AUCUN bleu ; tête de carte intacte (cercle + titre + sous-titre) ;
  - section B : intégrité fonctionnelle rapide (messages génériques,
    version produit 0.2.14).
"""
import json
import os
import sys
import urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P1 = "http://127.0.0.1:4244"

RESULTATS = []


def check(nom, cond, detail=""):
    RESULTATS.append(bool(cond))
    print(f"  {'OK' if cond else 'KO'}  {nom}" + ("" if cond else f" — {detail}"))


def req_get(url):
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            return r.status, r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")
    except Exception as e:  # noqa: BLE001
        return 0, str(e)


def req_post(url, payload):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8"))
        except Exception:  # noqa: BLE001
            return e.code, {}
    except Exception as e:  # noqa: BLE001
        return 0, {"erreur": str(e)}


# ================= SECTION 0 : contrôles statiques (source) =================
print("--- SECTION 0 : contrôles statiques (scripts/portail-server.js) ---")
src = open(os.path.join(BASE, "scripts/portail-server.js"), encoding="utf-8").read()

check("S0.1 AUCUN bleu restant : #2563eb absent de tout le portail",
      src.count("#2563eb") == 0, src.count("#2563eb"))
check("S0.2 AUCUN bleu restant : rgba(37, 99, 235 …) absent (ombres)",
      src.count("rgba(37, 99, 235") == 0, src.count("rgba(37, 99, 235"))
check("S0.3 8 cercles VERTS (4 .icon-rond + 4 .etq-etape) : background #059669",
      src.count("border-radius: 50%; background: #059669;") == 8,
      src.count("border-radius: 50%; background: #059669;"))
check("S0.4 8 ombres portées VERTES rgba(5, 150, 105, 0.28)",
      src.count("box-shadow: 0 6px 14px rgba(5, 150, 105, 0.28);") == 8,
      src.count("box-shadow: 0 6px 14px rgba(5, 150, 105, 0.28);"))
check("S0.5 4 définitions .icon-rond (LOGIN, /changer, CSS_OTP, fiches)",
      src.count(".icon-rond {") == 4, src.count(".icon-rond {"))
check("S0.6 4 définitions .etq-etape (mêmes 4 blocs CSS)",
      src.count(".etq-etape {") == 4, src.count(".etq-etape {"))
check("S0.7 commentaires mis à jour : « cercle icône vert » (4 blocs), plus aucun « bleu »",
      src.count("cercle icône vert") == 4 and src.count("cercle icône bleu") == 0)
check("S0.8 en-tête documenté Task 84 (demande utilisateur tracée)",
      "MODIFIÉ Task 84" in src and "change le de ces cercle vers vert" in src)
check("S0.9 le vert des cercles = le vert des boutons (#059669)",
      src.count("background: #059669; color: #fff;") >= 8)

# --- Design Task 83 intact (rien d'autre n'a bougé) ---
check("S10 fond clair bleuté #f4f6fb conservé (4 blocs CSS)",
      src.count("background: #f4f6fb;") == 4)
check("S11 cartes blanches arrondies + ombres légères conservées (×4)",
      src.count("box-shadow: 0 12px 34px rgba(15, 23, 42, 0.07);") == 4)
check("S12 règle input[type=password] :focus conservée (3 occurrences)",
      src.count('input[type="password"]:focus { border-color: #059669; box-shadow: 0 0 0 3px rgba(5,150,105,.14); }') == 3)
check("S13 notes vertes / mention d'expiration / œil conservés",
      ".note-verte {" in src and ".expire-note {" in src and ".oeil {" in src)

# --- Invariants fonctionnels (le changement est STRICTEMENT CSS) ---
check("S14 QR standard otpauth://totp + verifyTotp inchangés (Task 78/82)",
      '"otpauth://totp/"' in src and "verifyTotp" in src)
check("S15 verrou QR unique conservé (!lastLoginAt && !qrPresente)",
      "const premiereInscription = !acc.lastLoginAt && !acc.qrPresente;" in src)
check("S16 /premiere + /api/premiere + orientation mustChangePassword conservés (Task 83)",
      'id="form-premiere"' in src and 'pathname === "/api/premiere"' in src
      and 'redirect: "/premiere",' in src)
check("S17 changement obligatoire + /api/change-password conservés (Task 64)",
      'redirect: "/changer",' in src and "/api/change-password" in src)
check("S18 badge d'étape « 2 » toujours présent sur la page Configuration OTP",
      '<span class="etq-etape" aria-hidden="true">2</span>' in src)

# --- Version produit ---
pkg = json.load(open(os.path.join(BASE, "package.json"), encoding="utf-8"))
check("S19 version du produit = 0.2.23 (NOUVEAU Task 93)",
      pkg.get("version") == "0.2.23", pkg.get("version"))

# ================= SECTION A : pages servies (portail de test 4244) =================
print("\n--- SECTION A : pages servies (portail de test 4244) ---")
code, brut = req_get(f"{P1}/login")
check("A1 /login → 200 ; CSS VERT servi (cercles), AUCUN bleu dans la page",
      code == 200 and "border-radius: 50%; background: #059669;" in brut
      and "#2563eb" not in brut and "rgba(37, 99, 235" not in brut, code)
check("A2 /login : tête de carte intacte (cercle icône + titre « Connexion »)",
      'class="icon-rond"' in brut and "carte-titre\">Connexion" in brut
      and 'href="/premiere"' in brut)
check("A3 /login : les 3 champs Task 82/83 toujours servis (CIN + mot de passe + Code OTP)",
      'id="cin" name="cin"' in brut and 'id="password" name="password"' in brut
      and 'id="otp" name="otp"' in brut)

code, brut = req_get(f"{P1}/premiere")
check("A4 /premiere → 200 ; CSS_OTP VERT servi (cercle cadenas), AUCUN bleu",
      code == 200 and "border-radius: 50%; background: #059669;" in brut
      and 'class="icon-rond"' in brut and "#2563eb" not in brut
      and "rgba(37, 99, 235" not in brut, code)
check("A5 /premiere : 4 champs + bouton Valider + lien retour (page étape 1 intacte)",
      ">Mot de passe initial</label>" in brut and ">Nouveau mot de passe</label>" in brut
      and ">Répéter le nouveau mot de passe</label>" in brut
      and 'id="form-premiere"' in brut)

# ================= SECTION B : intégrité fonctionnelle rapide =================
print("\n--- SECTION B : intégrité fonctionnelle (messages inchangés) ---")
code, rep = req_post(f"{P1}/api/verify", {"cin": "CININEXISTANT84", "password": "PeuImporte84x"})
check("B1 CIN inconnu → 401 + message générique (aucune fuite, comportement inchangé)",
      code == 401 and "incorrect" in str(rep.get("error", "")).lower(), (code, rep))
code, brut = req_get(f"{P1}/")
check("B2 racine portail → 200 (page fiches servie, bloc CSS 4 vert)",
      code == 200 and "border-radius: 50%; background: #059669;" in brut
      and "#2563eb" not in brut, code)

total = len(RESULTATS)
ok = sum(RESULTATS)
print("\n" + "=" * 76)
print(f"RÉSULTAT : {ok}/{total}")
print("=" * 76)
sys.exit(0 if ok == total else 1)
