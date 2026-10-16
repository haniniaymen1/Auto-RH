#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 34 — E2E interface SUPERADMINISTRATEUR (gestion + suppression des comptes IT/RH).

Prérequis : admin (3000) démarré avec le code Task 34.

Comptes de test créés puis SUPPRIMÉS à la fin (base rendue à l'état initial) :
  - super34@test.tn   (SUPERADMIN, SuperTest34AB)
  - super34b@test.tn  (SUPERADMIN, SuperTest34CD)
  - temp34@test.tn    (RH, Temp34pass)

Les comptes RÉELS (it@demo.tn / rh@demo.tn) ne sont JAMAIS modifiés
durablement : aucun mot de passe ni rôle ni statut n'est changé.

Vérifications :
  A. Script d'amorçage : création superadmin + comptes de test, --statut
  B. Login superadmin -> role SUPERADMIN ; liste /api/users -> 200
  C. Sans session -> 401 ; IT conserve l'accès à la liste (non-suppressif)
  D. IT BLOQUÉ sur les routes superadmin (password 403, role 403)
  E. Superadmin : réinitialisation mot de passe (sur compte de test) + connexion
     avec le nouveau mot de passe, puis restauration
  F. Superadmin : bascule de rôle RH -> IT -> RH (compte de test)
  G. Superadmin : désactivation + réactivation du compte de test
  H. Superadmin : SUPPRESSION du compte RH de test (le cœur de la demande)
  I. Garde-fous : auto-désactivation 400, auto-suppression 400, rôle de soi 400,
     rôle d'un compte SUPERADMIN 400, suppression du DERNIER superadmin 400,
     mot de passe trop court 400, rôle invalide 400
  J. Nettoyage : comptes de test supprimés via scripts/supprime-utilisateur.js
"""
import json, http.client, re, subprocess, sys

ADMIN_HOST, ADMIN_PORT = "127.0.0.1", 4000  # (MODIFIÉ Task 64 : administration sur 4000)
ADMIN_EMAIL, ADMIN_PASSWORD = "it@demo.tn", "demo1234"

PASS = FAIL = 0
FAILURES = []


def check(label, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  [OK]   {label}")
    else:
        FAIL += 1
        FAILURES.append(f"{label} {detail}")
        print(f"  [FAIL] {label}  {detail}")


def requete(port, method, path, body=None, cookie=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=20)
    headers = {"Content-Type": "application/json"}
    if cookie:
        headers["Cookie"] = cookie
    data = json.dumps(body).encode() if body is not None else None
    conn.request(method, path, body=data, headers=headers)
    r = conn.getresponse()
    corps = r.read()
    entetes = {}
    for k, v in r.getheaders():
        entetes.setdefault(k.lower(), []).append(v)
    conn.close()
    try:
        js = json.loads(corps.decode() or "{}")
    except Exception:
        js = {"raw": corps.decode(errors="replace")[:200]}
    cookie_val = None
    for sc in entetes.get("set-cookie", []):
        m = re.search(r"(auto_rh_session=[^;]+)", sc)
        if m:
            cookie_val = m.group(1)
    return r.status, js, cookie_val


def login(email, password):
    st, js, ck = requete(ADMIN_PORT, "POST", "/api/auth/login",
                         {"email": email, "password": password, "remember": False})
    return st, js, ck


def script(*args):
    return subprocess.run(["node", *args], capture_output=True, text=True, timeout=90)


print("== Task 34 : interface SUPERADMINISTRATEUR ==")

SA, SB, TP = "super34@test.tn", "super34b@test.tn", "temp34@test.tn"

# ---------- A. Script d'amorçage ----------
print("\n[A] Script creer-superadmin.js")
r = script("scripts/creer-superadmin.js", "--statut")
check("--statut s'exécute", r.returncode == 0, r.stderr[:120])
r = script("scripts/creer-superadmin.js", "--creer", "--email", SA,
           "--nom", "Super Admin Test", "--password", "SuperTest34AB")
check("création superadmin (A1)", r.returncode == 0 and "CRÉÉ" in r.stdout, (r.stdout + r.stderr)[:150])
r = script("scripts/creer-superadmin.js", "--creer", "--email", SA, "--nom", "X Y",
           "--password", "SuperTest34AB")
check("email dupliqué refusé", r.returncode != 0, r.stdout[:100])
r = script("scripts/creer-superadmin.js", "--creer", "--email", SA, "--nom", "X Y",
           "--password", "court")
check("mot de passe trop court refusé", r.returncode != 0, r.stdout[:100])
r = script("scripts/creer-superadmin.js", "--creer", "--role", "RH", "--email", TP,
           "--nom", "Compte Temp RH", "--password", "Temp34pass")
check("création compte RH de test", r.returncode == 0 and "CRÉÉ" in r.stdout, (r.stdout + r.stderr)[:150])

st_admin = {}
try:
    # ---------- B. Login superadmin + liste ----------
    print("\n[B] Connexion superadministrateur")
    st, js, ck_sa = login(SA, "SuperTest34AB")
    check("login superadmin -> 200", st == 200, f"{st} {str(js)[:120]}")
    check("rôle SUPERADMIN dans la session", js.get("user", {}).get("role") == "SUPERADMIN", str(js)[:120])

    st, js, _ = requete(ADMIN_PORT, "GET", "/api/users", cookie=ck_sa)
    users = js.get("users", [])
    check("liste /api/users -> 200", st == 200, f"{st}")
    check("la liste contient le superadmin, IT et RH",
          any(u["role"] == "SUPERADMIN" for u in users) and
          any(u["role"] == "IT" for u in users) and any(u["role"] == "RH" for u in users),
          str([(u.get('email'), u.get('role')) for u in users])[:150])
    ids = {u["email"]: u["id"] for u in users}
    id_temp, id_sa = ids.get(TP), ids.get(SA)
    check("aucun passwordHash exposé", all("passwordHash" not in u for u in users))

    # ---------- C. Sessions et accès ----------
    print("\n[C] Sessions + accès IT conservé")
    st, js, _ = requete(ADMIN_PORT, "GET", "/api/users")
    check("sans session -> 401", st == 401, f"{st}")
    st, js, ck_it = login(ADMIN_EMAIL, ADMIN_PASSWORD)
    check("login IT (compte réel) -> 200", st == 200, f"{st}")
    st, js, _ = requete(ADMIN_PORT, "GET", "/api/users", cookie=ck_it)
    check("IT liste toujours les comptes (non-suppressif)", st == 200, f"{st}")

    # ---------- D. IT bloqué sur les routes superadmin ----------
    print("\n[D] Routes exclusivement superadmin")
    st, js, _ = requete(ADMIN_PORT, "POST", f"/api/users/{id_temp}/password",
                        {"password": "NouveauMot34"}, cookie=ck_it)
    check("IT -> reset password 403", st == 403 and "superadministrateur" in js.get("error", ""), f"{st} {str(js)[:100]}")
    st, js, _ = requete(ADMIN_PORT, "POST", f"/api/users/{id_temp}/role",
                        {"role": "IT"}, cookie=ck_it)
    check("IT -> changement rôle 403", st == 403, f"{st}")

    # ---------- E. Réinitialisation de mot de passe (compte de test) ----------
    print("\n[E] Réinitialisation de mot de passe")
    st, js, _ = requete(ADMIN_PORT, "POST", f"/api/users/{id_temp}/password",
                        {"password": "Temp34pass-NOUVEAU"}, cookie=ck_sa)
    check("superadmin réinitialise le mot de passe -> 200", st == 200, f"{st} {str(js)[:120]}")
    st, js, _ = login(TP, "Temp34pass-NOUVEAU")
    check("connexion avec le NOUVEAU mot de passe -> 200", st == 200, f"{st}")
    st, js, _ = requete(ADMIN_PORT, "POST", f"/api/users/{id_temp}/password",
                        {"password": "Temp34pass"}, cookie=ck_sa)
    check("restauration du mot de passe initial (compte de test)", st == 200)
    st, js, _ = requete(ADMIN_PORT, "POST", f"/api/users/{id_temp}/password",
                        {"password": "court"}, cookie=ck_sa)
    check("mot de passe trop court -> 400", st == 400, f"{st}")

    # ---------- F. Changement de rôle RH <-> IT ----------
    print("\n[F] Changement de rôle")
    st, js, _ = requete(ADMIN_PORT, "POST", f"/api/users/{id_temp}/role",
                        {"role": "IT"}, cookie=ck_sa)
    check("RH -> IT : 200", st == 200 and js.get("user", {}).get("role") == "IT", f"{st} {str(js)[:120]}")
    st, js, _ = login(TP, "Temp34pass")
    check("le compte IT de test se connecte toujours", st == 200, f"{st}")
    st, js, _ = requete(ADMIN_PORT, "POST", f"/api/users/{id_temp}/role",
                        {"role": "RH"}, cookie=ck_sa)
    check("IT -> RH : retour au rôle initial", st == 200 and js.get("user", {}).get("role") == "RH")
    st, js, _ = requete(ADMIN_PORT, "POST", f"/api/users/{id_temp}/role",
                        {"role": "SUPERADMIN"}, cookie=ck_sa)
    check("attribution SUPERADMIN via API -> 400 (script uniquement)", st == 400, f"{st}")
    st, js, _ = requete(ADMIN_PORT, "POST", f"/api/users/{id_temp}/role",
                        {"role": "DIRECTEUR"}, cookie=ck_sa)
    check("rôle invalide -> 400", st == 400, f"{st}")

    # ---------- G. Désactivation / réactivation ----------
    print("\n[G] Désactivation / réactivation")
    st, js, _ = requete(ADMIN_PORT, "PATCH", f"/api/users/{id_temp}",
                        {"isActive": False}, cookie=ck_sa)
    check("désactivation du compte de test -> 200", st == 200, f"{st}")
    st, js, _ = login(TP, "Temp34pass")
    check("compte désactivé -> connexion 403", st == 403, f"{st}")
    st, js, ck_temp = login(SA, "SuperTest34AB")
    st, js, _ = requete(ADMIN_PORT, "PATCH", f"/api/users/{id_temp}",
                        {"isActive": True}, cookie=ck_sa)
    check("réactivation -> 200", st == 200, f"{st}")
    st, js, _ = login(TP, "Temp34pass")
    check("compte réactivé -> connexion 200", st == 200, f"{st}")

    # ---------- H. SUPPRESSION (cœur de la demande) ----------
    print("\n[H] Suppression de comptes")
    st, js, _ = requete(ADMIN_PORT, "DELETE", f"/api/users/{id_temp}", cookie=ck_sa)
    check("superadmin SUPPRIME le compte RH de test -> 200", st == 200, f"{st} {str(js)[:120]}")
    st, js, _ = login(TP, "Temp34pass")
    check("compte supprimé -> connexion 401", st == 401, f"{st}")
    st, js, _ = requete(ADMIN_PORT, "DELETE", f"/api/users/{id_temp}", cookie=ck_sa)
    check("re-suppression -> 404", st == 404, f"{st}")

    # ---------- I. Garde-fous ----------
    print("\n[I] Garde-fous")
    st, js, _ = requete(ADMIN_PORT, "PATCH", f"/api/users/{id_sa}",
                        {"isActive": False}, cookie=ck_sa)
    check("auto-désactivation -> 400", st == 400, f"{st}")
    st, js, _ = requete(ADMIN_PORT, "DELETE", f"/api/users/{id_sa}", cookie=ck_sa)
    check("auto-suppression -> 400", st == 400, f"{st}")
    st, js, _ = requete(ADMIN_PORT, "POST", f"/api/users/{id_sa}/role",
                        {"role": "RH"}, cookie=ck_sa)
    check("changement de rôle de soi -> 400", st == 400, f"{st}")

    # second superadmin : suppression possible, puis garde « dernier superadmin »
    r = script("scripts/creer-superadmin.js", "--creer", "--email", SB,
               "--nom", "Super Admin Test B", "--password", "SuperTest34CD")
    check("création 2e superadmin", r.returncode == 0, (r.stdout + r.stderr)[:120])
    st, js2, _ = requete(ADMIN_PORT, "GET", "/api/users", cookie=ck_sa)
    ids2 = {u["email"]: u["id"] for u in js2.get("users", [])}
    st, js, _ = requete(ADMIN_PORT, "DELETE", f"/api/users/{ids2[SB]}", cookie=ck_sa)
    check("suppression d'un AUTRE superadmin (pas le dernier) -> 200", st == 200, f"{st}")
    # via l'API, un superadmin seul ne peut se supprimer lui-même (garde combinée :
    # auto-suppression 400 — le garde « dernier superadmin » est démontré via CLI)
    st, js, _ = requete(ADMIN_PORT, "DELETE", f"/api/users/{id_sa}", cookie=ck_sa)
    check("auto-suppression refusée -> 400", st == 400, f"{st} {str(js)[:120]}")
    r = script("scripts/supprime-utilisateur.js", "--email", SA, "--forcer")
    check("CLI refuse le DERNIER superadmin actif", r.returncode != 0 and "DERNIER" in r.stderr,
          (r.stdout + r.stderr)[:120])

finally:
    # ---------- J. Nettoyage complet (base à l'état initial) ----------
    print("\n[J] Nettoyage")
    for email in (TP, SB):
        r = script("scripts/supprime-utilisateur.js", "--email", email, "--forcer")
        ok = r.returncode == 0
        print(f"  [{'OK' if ok else '??'}] {email} : {(r.stdout + r.stderr).strip()[:80]}")
    # super34 est le DERNIER superadmin actif : la CLI refuse par sécurité —
    # le nettoyage du compte de test utilise la porte de secours documentée.
    r = script("scripts/supprime-utilisateur.js", "--email", SA,
               "--forcer", "--forcer-dernier")
    print(f"  [{'OK' if r.returncode == 0 else '??'}] {SA} : {(r.stdout + r.stderr).strip()[:80]}")
    # les comptes réels it@demo.tn / rh@demo.tn n'ont JAMAIS été modifiés
    r = script("scripts/creer-superadmin.js", "--statut")
    fin = r.stdout
    check("comptes réels intacts (IT actif, RH actif, 0 compte de test restant)",
          "DESACTIVE" not in fin and "super34" not in fin and "temp34" not in fin
          and "it@demo.tn" in fin and "rh@demo.tn" in fin, fin[:250])

print(f"\n==== RÉSULTAT : {PASS} OK / {FAIL} ÉCHEC(S) ====")
if FAILURES:
    print("Échecs :")
    for f in FAILURES:
        print("  -", f)
sys.exit(1 if FAIL else 0)
