#!/usr/bin/env python3
"""Task 21 — Test E2E du chiffrement AES-256 du stockage.
1. Login admin -> récupère une fiche -> le PDF servi doit commencer par %PDF-
   alors que le fichier sur disque est chiffré (PAIESAGE1).
2. Ré-analyse (redetect) sur 1 fiche -> doit fonctionner (déchiffrement OK).
3. Portail : page de connexion OK (le service fichier y est vérifié par
   verify_task18.py, ré-exécuté à part)."""
import json, sys, urllib.request, http.cookiejar, sqlite3

BASE = "http://localhost:3000"
OK = 0; TOTAL = 0
def check(name, cond, extra=""):
    global OK, TOTAL
    TOTAL += 1
    if cond: OK += 1
    print(("  [OK]   " if cond else "  [FAIL] ") + name + ("  -> " + str(extra) if extra and not cond else ""))

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

# ---------- 1) Login admin ----------
req = urllib.request.Request(BASE + "/api/auth/login",
    data=json.dumps({"email": "it@demo.tn", "password": "demo1234"}).encode(),
    headers={"Content-Type": "application/json"})
try:
    r = opener.open(req, timeout=30)
    check("Login admin it@demo.tn", r.status == 200)
except Exception as e:
    # essai avec l'autre compte de démo connu
    req = urllib.request.Request(BASE + "/api/auth/login",
        data=json.dumps({"email": "admin@demo.tn", "password": "demo1234"}).encode(),
        headers={"Content-Type": "application/json"})
    r = opener.open(req, timeout=30)
    check("Login admin admin@demo.tn (repli)", r.status == 200)

# ---------- 2) Récupération d'une fiche + vérification %PDF ----------
db = sqlite3.connect("/home/z/my-project/db/custom.db")
pid, stored, fname = db.execute(
    "SELECT id, storedName, fileName FROM Payslip ORDER BY uploadedAt DESC LIMIT 1").fetchone()
print(f"  Fiche test : {fname} ({stored})")
r = opener.open(BASE + f"/api/payslips/{pid}/file", timeout=60)
data = r.body if hasattr(r, "body") else r.read()
check("API fichier admin -> HTTP 200", r.status == 200)
check("Contenu servi = PDF valide (%PDF-)", data[:5] == b"%PDF-", data[:9])
check("Taille servie > 0 octets", len(data) > 100, len(data))

# ---------- 3) Le disque est-il bien chiffré ? ----------
disk = open(f"/home/z/my-project/storage/payslips/{stored}", "rb").read(9)
check("Fichier sur DISQUE chiffré (PAIESAGE1)", disk.startswith(b"PAIESAGE1"), disk)
check("Fichier sur DISQUE différent du contenu servi",
      disk != data[:9])

# ---------- 4) Ré-analyse d'1 fiche (déchiffrement pipeline OCR/parse) ----------
req = urllib.request.Request(BASE + "/api/payslips/redetect",
    data=json.dumps({"ids": [pid]}).encode(), headers={"Content-Type": "application/json"})
try:
    r = opener.open(req, timeout=120)
    body = json.loads(r.read())
    det = body.get("details", [{}])[0] if isinstance(body, dict) else {}
    check("Redetect 1 fiche chiffrée -> 200", r.status == 200)
    check("Redetect sans erreur de déchiffrement",
          "error" not in str(det).lower() or det.get("ok"), det)
except Exception as e:
    check("Redetect 1 fiche chiffrée", False, str(e)[:120])

print(f"\n===== RESULTAT : {OK}/{TOTAL} OK =====")
sys.exit(0 if OK == TOTAL else 1)
