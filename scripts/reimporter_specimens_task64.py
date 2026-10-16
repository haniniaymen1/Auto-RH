#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 64 — ré-import du contenu de DÉMONSTRATION dans la base de développement
(les anciennes fiches étaient illisibles avec la clé actuelle).
Importe les 20 specimens PDF via l'API d'administration (port 4000)."""
import glob
import json
import sys
import uuid
import http.cookiejar
import urllib.request
import urllib.error

BASE = "http://localhost:4000"
SPECIMENS = sorted(glob.glob("/home/z/my-project/scripts/test-data/specimens/*.pdf"))

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def login():
    req = urllib.request.Request(
        BASE + "/api/auth/login",
        data=json.dumps({"email": "it@demo.tn", "password": "demo1234", "remember": False}).encode(),
        method="POST", headers={"Content-Type": "application/json"},
    )
    with opener.open(req, timeout=30) as rep:
        return rep.status


def upload(chemin):
    limite = "----Auto-RH" + uuid.uuid4().hex
    nom = chemin.split("/")[-1]
    with open(chemin, "rb") as f:
        contenu = f.read()
    corps = (
        f"--{limite}\r\n"
        f'Content-Disposition: form-data; name="files"; filename="{nom}"\r\n'
        f"Content-Type: application/pdf\r\n\r\n"
    ).encode() + contenu + f"\r\n--{limite}--\r\n".encode()
    req = urllib.request.Request(
        BASE + "/api/payslips/upload",
        data=corps, method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={limite}"},
    )
    with opener.open(req, timeout=120) as rep:
        return rep.status, json.loads(rep.read().decode() or "{}")


def main():
    st = login()
    print(f"connexion IT : {st}")
    if st != 200:
        return 1
    ok = echec = 0
    for chemin in SPECIMENS:
        try:
            st, js = upload(chemin)
            succes = js.get("success", 0)
            if st == 200 and succes >= 1:
                ok += 1
                print(f"  [ok] {chemin.split('/')[-1]} ({succes} fiche(s))")
            else:
                echec += 1
                print(f"  [KO] {chemin.split('/')[-1]} : {st} {json.dumps(js)[:120]}")
        except urllib.error.HTTPError as e:
            echec += 1
            print(f"  [KO] {chemin.split('/')[-1]} : HTTP {e.code}")
    print(f"IMPORT : {ok}/{len(SPECIMENS)} fichiers importés")
    return 0 if echec == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
