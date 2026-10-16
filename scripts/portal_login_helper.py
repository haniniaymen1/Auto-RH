#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Helper partagé (Task 18) : obtenir une session PORTAIL authentifiée pour les
scripts de vérification/régression.

Depuis Task 18, le portail exige une connexion CIN + code OTP (TOTP). Pour
pouvoir tester les comportements historiques (fiches, masquages Task 16/17),
ce helper :
  1. insère (upsert) une ligne PortalAccess avec un secret CONNU pour un CIN ;
  2. calcule le code TOTP courant (RFC 6238, hmac-sha1, 6 chiffres, 30 s) ;
  3. appelle POST /api/verify sur le portail et renvoie le cookie de session ;
  4. propose cleanup() pour supprimer la ligne de test (base rendue identique).

Usage :
    import portal_login_helper as plh
    cookie = plh.portal_login("07451236")   # ex. "portail_session=..."
    ...
    plh.cleanup()                            # supprime les accès de test
"""

import base64
import hashlib
import hmac
import json
import re
import struct
import time
import urllib.error
import urllib.request
import sqlite3
import os

PORTAL = os.environ.get("PORTAL_URL", "http://localhost:3001")
DB_PATH = "/home/z/my-project/db/custom.db"

_TEST_ROWS = []  # (cin, secret) créés par ce process -> nettoyés par cleanup()


def totp_code(secret_b32, at=None, offset=0):
    key = base64.b32decode(secret_b32, casefold=True)
    counter = int(at if at is not None else time.time()) // 30 + offset
    msg = struct.pack(">Q", counter)
    h = hmac.new(key, msg, hashlib.sha1).digest()
    o = h[-1] & 0x0F
    code = ((h[o] & 0x7F) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]
    return str(code % 1000000).zfill(6)


def _b32_secret(nbytes=20):
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
    raw = os.urandom(nbytes)
    out = ""
    bits = 0
    val = 0
    for byte in raw:
        val = (val << 8) | byte
        bits += 8
        while bits >= 5:
            out += alphabet[(val >> (bits - 5)) & 31]
            bits -= 5
    if bits:
        out += alphabet[(val << (5 - bits)) & 31]
    return out


def _upsert_access(cin, secret):
    """Insère/actualise la ligne PortalAccess du CIN (secret connu) via sqlite3."""
    con = sqlite3.connect(DB_PATH)
    try:
        now = time.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3] + "Z"
        con.execute("DELETE FROM PortalAccess WHERE cin = ?", (cin,))
        con.execute(
            "INSERT INTO PortalAccess (id, cin, totpSecret, isActive, failedAttempts, createdAt) "
            "VALUES (?, ?, ?, 1, 0, ?)",
            ("test" + hashlib.md5(cin.encode()).hexdigest()[:20], cin, secret, now),
        )
        con.commit()
    finally:
        con.close()


def portal_login(cin, ip="10.90.0.7"):
    """Retourne le cookie de session portail ('portail_session=...') ou lève une erreur."""
    secret = _b32_secret()
    _upsert_access(cin, secret)
    _TEST_ROWS.append(cin)

    body = json.dumps({"cin": cin, "code": totp_code(secret)}).encode()
    req = urllib.request.Request(
        PORTAL + "/api/verify", data=body, method="POST"
    )
    req.add_header("Content-Type", "application/json")
    req.add_header("X-Forwarded-For", ip)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            sc = r.headers.get("Set-Cookie", "")
            first = sc.split(";")[0]
            if not first.startswith("portail_session=") or not first.split("=", 1)[1]:
                raise RuntimeError("session portail non reçue : " + sc[:80])
            return first
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"/api/verify a échoué ({e.code}) : {e.read().decode()[:200]}")


def cleanup():
    """Supprime les lignes PortalAccess de test créées par ce process."""
    if not _TEST_ROWS:
        return
    con = sqlite3.connect(DB_PATH)
    try:
        for cin in _TEST_ROWS:
            con.execute("DELETE FROM PortalAccess WHERE cin = ?", (cin,))
        con.commit()
    finally:
        con.close()
    _TEST_ROWS.clear()
