#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Applique le nouvel extracteur aux fiches déjà en base (redetect) puis
importe les 20 fiches fiche_de_paie_XX.pdf de l'utilisateur et vérifie que
Employé / Période / CIN / Net à payer sont bien renseignés."""
import json
import os
import urllib.request
import uuid

BASE = "http://localhost:3000"
USER_DIR = "/home/z/my-project/upload/user_slips"
COOKIE_FILE = "/home/z/my-project/scripts/cookies.txt"

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
    return json.loads(urllib.request.urlopen(req).read().decode())

def get_json(path, cookie):
    req = urllib.request.Request(BASE + path, headers={"Cookie": cookie})
    return json.loads(urllib.request.urlopen(req).read().decode())

def upload_files(cookie):
    boundary = uuid.uuid4().hex
    parts = []
    for i in range(1, 21):
        name = "fiche_de_paie_%02d.pdf" % i
        with open(os.path.join(USER_DIR, name), "rb") as f:
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
    print("\n--- REDETECT (nouvel extracteur sur fiches déjà importées) ---")
    r = post_json("/api/payslips/redetect", cookie)
    print("total=%(total)s updated=%(updated)s cinFound=%(cinFound)s periodFound=%(periodFound)s errors=%(errors)s" % r)

    print("\n--- IMPORT des 20 fiche_de_paie_XX.pdf ---")
    up = upload_files(cookie)
    print(json.dumps({k: v for k, v in up.items() if k != "details"}, ensure_ascii=False)[:300])

    print("\n--- VERIF : recherche CIN 07451236 ---")
    s = get_json("/api/payslips?cin=07451236&limit=100", cookie)
    print("total=%s exact=%s" % (s.get("total"), s.get("exact")))
    fiches = [it for it in s.get("items", []) if it["fileName"].startswith("fiche_de_paie_")]
    ok = 0
    for it in fiches:
        filled = all(it.get(k) for k in ("cin", "employeeName", "period", "netSalary"))
        ok += 1 if filled else 0
        print(("PASS" if filled else "ÉCHEC"), it["fileName"], "|",
              it.get("employeeName"), "|", it.get("period"), "|", it.get("netSalary"))
    print("\n→ %d/%d fiches utilisateur avec Employé+Période+CIN+Net renseignés" % (ok, len(fiches)))

if __name__ == "__main__":
    main()
