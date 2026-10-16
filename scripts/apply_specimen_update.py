#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Applique le nouvel extracteur (redetect) puis importe les 20 fiches
SPECIMEN (fiche_paie_XX_specimen.pdf) et vérifie :
  1. redetect : CIN + période toujours détectés sur les anciennes fiches
  2. import des 20 specimens
  3. recherche exacte par CIN démo -> 20/20 fiches retrouvées
  4. champs Employé/Période/CIN/Net renseignés sur les 20 specimens
  5. régression : la recherche 07451236 (fiches utilisateur) renvoie toujours 20
"""
import json
import os
import sys
import urllib.request
import uuid

BASE = os.environ.get("AUTO_RH_BASE_URL", "http://localhost:3000")
# Dossier des fiches specimen : 1er argument, variable d'env, ou dossier local
SPECIMEN_DIR = (
    sys.argv[1] if len(sys.argv) > 1
    else os.environ.get("AUTO_RH_SPECIMEN_DIR",
                        os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                     "test-data", "specimens"))
)

# CIN démo compact attendu pour chaque fiche specimen
EXPECTED_CINS = {
    1: "DEMO001234", 2: "DEMO123456", 3: "XX003456", 4: "FICTIF004567",
    5: "000005678", 6: "CINDEMO006789", 7: "D007890", 8: "SPEC008901",
    9: "DEMO009012", 10: "FICTIF010123", 11: "XX011234", 12: "DEMO012345",
    13: "013456DEMO", 14: "XX014567", 15: "INVALIDE015678", 16: "D016789",
    17: "SPECIMEN017890", 18: "XX018901", 19: "DEMO019012", 20: "FICTIF020123",
}

def login():
    data = json.dumps({"email": "it@demo.tn", "password": "demo1234"}).encode()
    req = urllib.request.Request(BASE + "/api/auth/login", data=data,
                                 headers={"Content-Type": "application/json"})
    resp = urllib.request.urlopen(req)
    cookie = resp.headers["Set-Cookie"].split(";")[0]
    print("login:", resp.status)
    return cookie

def post_json(path, cookie):
    req = urllib.request.Request(BASE + path, data=b"", method="POST",
                                 headers={"Cookie": cookie})
    return json.loads(urllib.request.urlopen(req, timeout=300).read().decode())

def get_json(path, cookie):
    req = urllib.request.Request(BASE + path, headers={"Cookie": cookie})
    return json.loads(urllib.request.urlopen(req, timeout=120).read().decode())

def upload_dir(cookie, directory, names):
    boundary = uuid.uuid4().hex
    parts = []
    for name in names:
        with open(os.path.join(directory, name), "rb") as f:
            data = f.read()
        parts.append(("--%s\r\nContent-Disposition: form-data; name=\"files\"; filename=\"%s\"\r\n"
                      "Content-Type: application/pdf\r\n\r\n" % (boundary, name)).encode() + data + b"\r\n")
    parts.append(("--%s--\r\n" % boundary).encode())
    body = b"".join(parts)
    req = urllib.request.Request(BASE + "/api/payslips/upload", data=body, method="POST",
                                 headers={"Cookie": cookie,
                                          "Content-Type": "multipart/form-data; boundary=" + boundary})
    return json.loads(urllib.request.urlopen(req, timeout=300).read().decode())

def main():
    cookie = login()

    print("\n--- 1) REDETECT (nouvel extracteur sur fiches deja importees) ---")
    r = post_json("/api/payslips/redetect", cookie)
    print("total=%(total)s updated=%(updated)s cinFound=%(cinFound)s periodFound=%(periodFound)s errors=%(errors)s" % r)
    ok1 = r.get("errors") == 0

    print("\n--- 2) IMPORT des 20 fiches specimen (saute si deja importees) ---")
    lst0 = get_json("/api/payslips?limit=500", cookie)
    already = len([it for it in lst0.get("items", []) if "specimen" in it["fileName"]])
    if already >= 20:
        print("deja importees (%d) — import saute" % already)
        ok2 = True
    else:
        names = ["fiche_paie_%02d_specimen.pdf" % i for i in range(1, 21)]
        up = upload_dir(cookie, SPECIMEN_DIR, names)
        print(json.dumps({k: v for k, v in up.items() if k != "details"}, ensure_ascii=False)[:300])
        ok2 = up.get("success") == 20

    print("\n--- 3) Recherche exacte par CIN demo (20 requetes) ---")
    ok3 = 0
    for n in sorted(EXPECTED_CINS):
        cin = EXPECTED_CINS[n]
        s = get_json("/api/payslips?cin=%s&limit=50" % urllib.request.quote(cin), cookie)
        fname = "fiche_paie_%02d_specimen.pdf" % n
        hit = any(it["fileName"] == fname for it in s.get("items", []))
        ok3 += 1 if hit else 0
        print(("PASS" if hit else "ECHEC"), "cin=%-16s ->" % cin, "total=%d" % s.get("total", 0), fname)
    print("→ %d/20 recherches CIN demo retrouvent leur fiche" % ok3)

    print("\n--- 4) Champs renseignes sur les 20 specimens (mode liste) ---")
    lst = get_json("/api/payslips?limit=500", cookie)
    specs = [it for it in lst.get("items", []) if "specimen" in it["fileName"]]
    ok4 = 0
    for it in sorted(specs, key=lambda x: x["fileName"]):
        filled = all(it.get(k) for k in ("cin", "employeeName", "period", "netSalary", "matricule"))
        ok4 += 1 if filled else 0
        print(("PASS" if filled else "ECHEC"), it["fileName"], "|", it.get("cin"), "|",
              it.get("employeeName"), "|", it.get("period"), "|", it.get("netSalary"))
    print("→ %d/%d specimens avec Employé+Période+CIN+Net+Matricule renseignés" % (ok4, len(specs)))

    print("\n--- 5) REGRESSION : recherche 07451236 (fiches utilisateur) ---")
    s = get_json("/api/payslips?cin=07451236&limit=100", cookie)
    n_user = len([it for it in s.get("items", []) if it["fileName"].startswith("fiche_de_paie_")])
    print("total=%s  fiches utilisateur retrouvees=%d (>=20 attendu)" % (s.get("total"), n_user))
    ok5 = n_user >= 20

    print("\n================ BILAN ================")
    print("1) redetect sans erreur          :", "PASS" if ok1 else "ECHEC")
    print("2) import 20 specimens           :", "PASS" if ok2 else "ECHEC")
    print("3) recherche CIN demo            : %d/20" % ok3)
    print("4) champs specimens renseignes   : %d/20" % ok4)
    print("5) regression fiches utilisateur : %d (>=20)" % n_user)
    all_ok = ok1 and ok2 and ok3 == 20 and ok4 == 20 and ok5
    print("GLOBAL:", "PASS" if all_ok else "ECHEC")
    sys.exit(0 if all_ok else 1)

if __name__ == "__main__":
    main()
