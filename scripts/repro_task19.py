#!/usr/bin/env python3
"""
Reproduction du problème utilisateur (Task 19) :
1. Login admin (3000)
2. Upload de bulletins_specimen_50_PDF.zip (le fichier de l'utilisateur)
3. Inspection des fiches créées (cin, content, normalizedContent)
4. Login portail pour un CIN des PDF + /api/my-fiches
"""
import io, json, sys, urllib.request, sqlite3, os

BASE = "http://localhost:3000"
DB = "/home/z/my-project/db/custom.db"
ZIP_PATH = "/home/z/my-project/upload/bulletins_specimen_50_PDF.zip"

def http(method, url, data=None, headers=None, timeout=120):
    req = urllib.request.Request(url, data=data, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

def boundary_body(filepath, field="files"):
    fn = os.path.basename(filepath)
    with open(filepath, "rb") as f:
        content = f.read()
    b = "----Task19Boundary" + "x" * 10
    part = (
        f"--{b}\r\n"
        f'Content-Disposition: form-data; name="{field}"; filename="{fn}"\r\n'
        f"Content-Type: application/zip\r\n\r\n"
    ).encode() + content + f"\r\n--{b}--\r\n".encode()
    return part, f"multipart/form-data; boundary={b}"

st, body = http("POST", BASE + "/api/auth/login",
                data=json.dumps({"email": "it@demo.tn", "password": "demo1234"}).encode(),
                headers={"Content-Type": "application/json"})
print("1) login admin:", st)
setc = None
for line in body.decode(errors="replace").splitlines()[:0]:
    pass
# cookie depuis les headers: urlopen ne expose pas set-cookie facilement via HTTPError; repasser
import urllib.request as ur
req = ur.Request(BASE + "/api/auth/login",
                 data=json.dumps({"email": "it@demo.tn", "password": "demo1234"}).encode(),
                 method="POST")
req.add_header("Content-Type", "application/json")
with ur.urlopen(req) as r:
    sc = r.headers.get_all("Set-Cookie") or []
print("   cookies:", [c.split(";")[0] for c in sc])
cookie = "; ".join(c.split(";")[0] for c in sc)

part, ctype = boundary_body(ZIP_PATH)
st, body = http("POST", BASE + "/api/payslips/upload", data=part,
                headers={"Cookie": cookie, "Content-Type": ctype})
print("2) upload ZIP:", st, "->", body.decode(errors="replace")[:300])

# 3) inspection DB
con = sqlite3.connect(DB)
cur = con.cursor()
n = cur.execute("SELECT COUNT(*) FROM Payslip").fetchone()[0]
print("3) TOTAL fiches apres upload:", n)
rows = cur.execute("""
  SELECT fileName, cin, employeeName, length(content), length(normalizedContent)
  FROM Payslip WHERE fileName LIKE '%900001%' OR fileName LIKE '%900002%' OR fileName LIKE '%AMRI%'
  ORDER BY uploadedAt DESC LIMIT 10""").fetchall()
for r in rows:
    print("   ", r)
pdfs = cur.execute("SELECT COUNT(*) FROM Payslip WHERE fileName LIKE 'bulletin_9%'").fetchone()[0]
print("   fiches bulletin_9*:", pdfs)
# exemple contenu d'un PDF importé
row = cur.execute("""
  SELECT fileName, cin, substr(content,1,400) FROM Payslip
  WHERE fileName LIKE 'bulletin_900001%' ORDER BY uploadedAt DESC LIMIT 1""").fetchone()
if row:
    print("   contenu 900001:", json.dumps(row, ensure_ascii=False)[:600])
con.close()
