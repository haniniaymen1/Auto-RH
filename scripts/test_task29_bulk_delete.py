#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 29 : E2E — SUPPRESSION MULTIPLE dans le portail administration.
1. Nouvelle route POST /api/payslips/delete-many : supprime N fiches en une
   requête (base + fichiers), résultat détaillé deleted/missing/failed.
2. La carte « Employés » n'est plus affichée sur la page d'accueil admin
   (l'API /api/stats reste inchangée).
3. Régression : la suppression UNITAIRE DELETE /api/payslips/[id] fonctionne
   toujours ; base rendue à l'état initial (107 fiches).
"""
import json, sys, urllib.request, http.cookiejar, io, os

BASE = "http://localhost:3000"
cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
FAILS = []

def check(name, cond, extra=""):
    print(("  [OK] " if cond else "  [!!] ") + name + (" — " + str(extra) if extra else ""))
    if not cond:
        FAILS.append(name)

def req(path, data=None, method=None, headers=None, with_auth=True):
    body = None
    h = dict(headers or {})
    if data is not None:
        body = json.dumps(data).encode()
        h["Content-Type"] = "application/json"
    r = urllib.request.Request(BASE + path, body, h, method=method)
    op = opener if with_auth else urllib.request.build_opener()
    try:
        with op.open(r, timeout=180) as resp:
            raw = resp.read()
            try:
                return resp.status, json.loads(raw)
            except Exception:
                return resp.status, raw
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, None

def upload_file(path_on_disk, name, mime):
    boundary = "----task29boundary"
    with open(path_on_disk, "rb") as f:
        content = f.read()
    body = io.BytesIO()
    body.write(("--%s\r\nContent-Disposition: form-data; name=\"files\"; filename=\"%s\"\r\n"
                "Content-Type: %s\r\n\r\n" % (boundary, name, mime)).encode())
    body.write(content)
    body.write(("\r\n--%s--\r\n" % boundary).encode())
    r = urllib.request.Request(
        BASE + "/api/payslips/upload", body.getvalue(),
        {"Content-Type": "multipart/form-data; boundary=" + boundary}, method="POST")
    with opener.open(r, timeout=300) as resp:
        return resp.status, json.loads(resp.read())

def all_fiches():
    st, j = req("/api/payslips")
    return (j if isinstance(j, list) else (j.get("payslips") or j.get("items") or []))

print("== 1) Login admin ==")
st, j = req("/api/auth/login", {"email": "it@demo.tn", "password": "demo1234"})
check("login admin -> 200", st == 200, str(st))
total0 = len(all_fiches())
check("état initial = 107 fiches", total0 == 107, str(total0))

print("== 2) Préparation : 3 fiches de test (uploads réels) ==")
ids = []
for k in range(3):
    st, j = upload_file("/home/z/my-project/upload/fiche_avec_annexes_test.pdf",
                        f"task29_test_{k}.pdf", "application/pdf")
    ok = st == 200
    if ok:
        res = (j.get("results") or [{}])[0] if isinstance(j, dict) else {}
        rid = res.get("id")
        ok = res.get("status") == "SUCCESS" and bool(rid)
        if rid:
            ids.append(rid)
    check(f"upload test {k + 1}/3 -> fiche créée", ok, str(res.get("message", ""))[:80] if ok else str(st))
check("3 fiches de test créées", len(ids) == 3, str(len(ids)))
check("total = 110 après uploads", len(all_fiches()) == 110, str(len(all_fiches())))

print("== 3) Suppression MULTIPLE (nouvelle route) ==")
st, j = req("/api/payslips/delete-many", {"ids": ids[:2]}, method="POST")
check("delete-many 2 fiches -> 200", st == 200, str(st))
check("deleted=2, failed=0, missing=0",
      j and j.get("deleted") == 2 and j.get("failed") == 0 and j.get("missing") == 0, str(j))
check("total = 108 après suppression multiple", len(all_fiches()) == 108, str(len(all_fiches())))
st, _ = req("/api/payslips/" + ids[0])
check("fiche supprimée n°1 -> 404 (base + fichier)", st == 404, str(st))
st, _ = req("/api/payslips/" + ids[1])
check("fiche supprimée n°2 -> 404", st == 404, str(st))
st, _ = req("/api/payslips/" + ids[2])
check("fiche restante -> 200", st == 200, str(st))

print("== 4) Cas limites ==")
st, j = req("/api/payslips/delete-many", {"ids": []}, method="POST")
check("ids vides -> 400", st == 400, str(st))
st, j = req("/api/payslips/delete-many", {"ids": "x"}, method="POST")
check("ids non tableau -> 400", st == 400, str(st))
st, j = req("/api/payslips/delete-many", {"ids": [ids[2], "id-inexistant-xyz"]}, method="POST")
check("mélange existant/inexistant -> deleted=1 + missing=1",
      st == 200 and j.get("deleted") == 1 and j.get("missing") == 1, str(j))
check("total = 107 (la fiche mixte a aussi été supprimée)", len(all_fiches()) == 107, str(len(all_fiches())))
st, j = req("/api/payslips/delete-many", {"ids": ["x"]}, method="POST", with_auth=False)
check("sans session -> 401", st == 401, str(st))

print("== 5) Régression : suppression UNITAIRE (inchangée) ==")
st, j = upload_file("/home/z/my-project/upload/fiche_avec_annexes_test.pdf",
                    "task29_single.pdf", "application/pdf")
res = (j.get("results") or [{}])[0] if isinstance(j, dict) else {}
sid = res.get("id")
check("upload 1 fiche -> SUCCESS", res.get("status") == "SUCCESS" and bool(sid), str(res.get("message", ""))[:80])
st, j = req("/api/payslips/" + sid, method="DELETE")
check("DELETE unitaire -> 200", st == 200, str(st))
check("base rendue à l'état initial (107 fiches)", len(all_fiches()) == 107, str(len(all_fiches())))

print("== 6) Affichage : carte « Employés » retirée de l'accueil admin ==")
# IMPORTANT : la page / est protégée — sans session on est redirigé vers
# /login (307). Il faut appeler la page AVEC le cookie de session admin
# pour obtenir le HTML du tableau de bord (rendu SSR du composant client).
st, html = req("/", with_auth=True)
html = html.decode("utf-8", "replace") if isinstance(html, bytes) else str(html)
check("page accueil (authentifié) accessible (200)", st == 200, str(st))
check("la carte « Employés / identifiés » N'EST PLUS affichée",
      "Employés" not in html and "identifiés" not in html, "")
check("les autres cartes restent affichées",
      "Fiches de paie" in html and "Dernier import" in html and "détectés" in html, "")

print("== 7) API /api/stats inchangée (champ employés toujours servi) ==")
st, j = req("/api/stats")
check("stats -> 200 avec champ employees", st == 200 and "employees" in (j or {}), str(j)[:120])

print("")
if FAILS:
    print("ÉCHEC :", len(FAILS), "vérification(s) en erreur ->", FAILS)
    sys.exit(1)
print("TOUS LES TESTS PASSENT (Task 29)")
