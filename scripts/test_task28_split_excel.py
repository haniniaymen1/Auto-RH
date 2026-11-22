#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 28 : E2E — découpage « 1 feuille = 1 fiche » du classeur Excel RÉEL
« Bulletins_de_paie_50_exemples (4) (1).xlsx » (50 feuilles, 1 bulletin
vertical par feuille, CIN SPEC-0001 .. SPEC-0050).

Avant le fix : chaque feuille-bulletin vertical était À TORTE explosée comme
un tableau « 1 bulletin par ligne » (pseudo-en-tête « Matricule | Nom et
Prénom | Fonction | Département ») -> 1000 fragments sans identité ->
groupMultiPayslips null -> repli mono-fiche : les 50 feuilles restaient
collées en UNE seule fiche (signalement : « les 50 pages dans le fichier
excel n'est pas séparé »).

Après le fix : 50 fiches individuelles, chacune avec son PROPRE fichier
Excel chiffré (1 feuille), bons CIN, isolation portail par CIN.
"""
import json, sys, urllib.request, http.cookiejar, io, os, zipfile, re

BASE = "http://localhost:3000"
PORTAL = "http://localhost:3001"
cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
FAILS = []

def check(name, cond, extra=""):
    print(("  [OK] " if cond else "  [!!] ") + name + (" — " + str(extra) if extra else ""))
    if not cond:
        FAILS.append(name)

def req(path, data=None, headers=None, method=None, absolute=None):
    body = None
    h = dict(headers or {})
    if data is not None:
        body = json.dumps(data).encode()
        h["Content-Type"] = "application/json"
    r = urllib.request.Request((absolute or BASE) + path, body, h, method=method)
    try:
        with opener.open(r, timeout=180) as resp:
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
    boundary = "----task28boundary"
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
    with opener.open(r, timeout=600) as resp:
        return resp.status, json.loads(resp.read())

def all_fiches():
    st, j = req("/api/payslips")
    return (j if isinstance(j, list) else (j.get("payslips") or j.get("items") or []))

PREFIX = "Bulletins_de_paie_50_exemples"

print("== 1) Login admin ==")
st, j = req("/api/auth/login", {"email": "it@demo.tn", "password": "demo1234"})
check("login admin -> 200", st == 200, str(st))

print("== 1-bis) État propre : suppression des résidus éventuels ==")
removed = 0
for x in all_fiches():
    if (x.get("fileName") or "").startswith(PREFIX):
        req("/api/payslips/" + x["id"], method="DELETE")
        removed += 1
check("résidus supprimés avant test", True, str(removed))

print("== 2) Import du CLASSEUR RÉEL (50 feuilles, 1 bulletin vertical par feuille) ==")
REAL = "/home/z/my-project/upload/Bulletins_de_paie_50_exemples (4) (1).xlsx"
st, j = upload_file(REAL, "Bulletins_de_paie_50_exemples.xlsx",
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
check("upload réel -> 200", st == 200, str(st))
# La route accepte PLUSIEURS fichiers : la réponse enveloppe les résultats
# par fichier dans « results » -> {processed, successCount, failed, results:[…]}
if isinstance(j, list):
    j = j[0] if j else {}
if isinstance(j, dict) and isinstance(j.get("results"), list) and j["results"]:
    j = j["results"][0]
created = j.get("created")
check("50 fiches créées (et non 1 mono-fiche)", created == 50, str(created) + " — " + str(j.get("message"))[:120])
items = j.get("items") or []
check("réponse : 50 items", len(items) == 50, str(len(items)))
cins = sorted([it.get("cin") for it in items if it.get("cin")])
check("50 CIN distincts SPEC-0001..SPEC-0050",
      len(set(cins)) == 50 and cins[0] == "SPEC-0001" and cins[-1] == "SPEC-0050",
      str(cins[:3]) + " ... " + str(cins[-2:]))

print("== 3) Vérification en base : 1 FICHIER PHYSIQUE PAR FICHE ==")
mine = [x for x in all_fiches() if (x.get("fileName") or "").startswith(PREFIX)]
check("base : 50 enregistrements", len(mine) == 50, str(len(mine)))
# storedName n'est PAS exposé par l'API liste (sécurité) -> vérification
# DIRECTE en base (sqlite) : 50 storedName distincts = 50 fichiers physiques.
import sqlite3
con = sqlite3.connect("/home/z/my-project/db/custom.db")
rows = con.execute(
    "SELECT storedName, COUNT(*) c FROM Payslip WHERE fileName LIKE ? GROUP BY storedName",
    (PREFIX + "%",)).fetchall()
con.close()
check("storedName TOUS DIFFÉRENTS (fichiers individuels)",
      len(rows) == 50 and all(r[1] == 1 for r in rows),
      str(len(rows)) + " fichiers distincts / 50")
names = [x.get("fileName") for x in mine]
check("noms individuels « (feuille N).xlsx »",
      all("(feuille " in n for n in names), str(names[:2]))
first = next(x for x in mine if x.get("cin") == "SPEC-0001")
check("fiche SPEC-0001 : 1 page (1 feuille)", first.get("pageNumber") == 1, str(first.get("pageNumber")))

print("== 4) Contenu du fichier individuel : 1 SEULE feuille, bon employé ==")
r = urllib.request.Request(BASE + "/api/payslips/" + first["id"] + "/file")
with opener.open(r, timeout=120) as resp:
    data = resp.read()
    disp = resp.headers.get("Content-Disposition", "")
check("téléchargement -> 200 + xlsx", data[:2] == b"PK" and "xlsx" in disp.lower(), str(len(data)) + " octets")
try:
    zf = zipfile.ZipFile(io.BytesIO(data))
    wbxml = zf.read("xl/workbook.xml").decode("utf-8", "replace")
    sheets = re.findall(r"<sheet[^>]*name=\"([^\"]+)\"", wbxml)
    shared = zf.read("xl/sharedStrings.xml").decode("utf-8", "replace") if "xl/sharedStrings.xml" in zf.namelist() else ""
    check("le fichier individuel contient EXACTEMENT 1 feuille", len(sheets) == 1, str(sheets))
    check("c'est la feuille 01_JLASSI (1er bulletin)", sheets and sheets[0] == "01_JLASSI", str(sheets))
    check("contient le CIN SPEC-0001", "SPEC-0001" in shared, "")
    check("ne contient AUCUN autre CIN (confidentialité)",
          not re.search(r"SPEC-00(0[2-9]|[1-4]\d|50)\b", shared), "")
except Exception as e:
    check("lecture xlsx individuel", False, str(e)[:160])

print("== 5) Portail : isolation par CIN (SPEC-0001) ==")
sys.path.insert(0, "/home/z/my-project/scripts")
import portal_login_helper as plh
try:
    expected_ids = {x["id"] for x in all_fiches() if x.get("cin") == "SPEC-0001"}
    check("base : exactement 1 fiche avec cin=SPEC-0001", len(expected_ids) == 1, str(len(expected_ids)))
    # Le portail NORMALISE le CIN saisi (majuscules, sans espaces/tirets/points)
    # -> l'accès de test doit être créé avec la FORME NORMALISÉE "SPEC0001"
    # (pour un vrai CIN — chiffres ou lettres+chiffres — la normalisation est
    # identitaire : comportement portail inchangé, artefact spécimen uniquement).
    cookie = plh.portal_login("SPEC0001")
    r3 = urllib.request.Request(PORTAL + "/api/my-fiches", headers={"Cookie": cookie})
    with urllib.request.build_opener().open(r3, timeout=60) as resp3:
        j3 = json.loads(resp3.read().decode())
    lst = j3.get("items") or []
    ids = {p.get("id") for p in lst}
    check("portail : renvoie EXACTEMENT la fiche du CIN SPEC-0001",
          ids == expected_ids, str(len(ids)) + " renvoyée(s)")
except Exception as e:
    check("portail accessible", False, str(e)[:160])
finally:
    try:
        plh.cleanup()
    except Exception:
        pass

print("== 6) Nettoyage : base rendue à l'état initial ==")
removed2 = 0
for x in all_fiches():
    if (x.get("fileName") or "").startswith(PREFIX):
        req("/api/payslips/" + x["id"], method="DELETE")
        removed2 += 1
check("50 fiches de test supprimées", removed2 == 50, str(removed2))
check("base rendue à l'état initial (107 fiches)", len(all_fiches()) == 107, str(len(all_fiches())))

print("")
if FAILS:
    print("ÉCHEC :", len(FAILS), "vérification(s) en erreur ->", FAILS)
    sys.exit(1)
print("TOUS LES TESTS PASSENT (Task 28)")
