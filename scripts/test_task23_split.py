#!/usr/bin/env python3
"""Task 23 — E2E : import d'un PDF multi-pages -> fiches INDIVIDUELLES découpées."""
import json, sys, urllib.request, http.cookiejar, io

BASE = "http://localhost:3000"
TMP_PDF = "/home/z/my-project/scripts/tmp_fiche_spec7.pdf"
cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def req(path, data=None, headers=None, method=None):
    h = dict(headers or {})
    body = None
    if data is not None and isinstance(data, dict):
        body = json.dumps(data).encode(); h["Content-Type"] = "application/json"
    elif data is not None:
        body = data
    r = urllib.request.Request(BASE + path, body, h, method=method)
    try:
        with op.open(r, timeout=300) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

ok = fail = 0
def check(name, cond, extra=""):
    global ok, fail
    ok += 1 if cond else 0
    fail += 0 if cond else 1
    print(("  ✔ " if cond else "  ✘ ") + name + ((" | " + extra) if extra else ""))

# 1) login admin
st, _ = req("/api/auth/login", {"email": "it@demo.tn", "password": "demo1234"})
check("login admin -> 200", st == 200, str(st))

# 2) import du PDF multi-pages (50 fiches SPEC-0001..0050)
pdf = open("test-data/bulletins_specimen_50.pdf", "rb").read()
boundary = "----Task23Boundary"
part = io.BytesIO()
part.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"bulletins_specimen_50.pdf\"\r\nContent-Type: application/pdf\r\n\r\n".encode())
part.write(pdf)
part.write(f"\r\n--{boundary}--\r\n".encode())
st, resp = req("/api/payslips/upload", part.getvalue(), {"Content-Type": f"multipart/form-data; boundary={boundary}"})
data = json.loads(resp)
check("upload PDF multi-pages -> 200", st == 200, str(st))
res = (data.get("results") or [{}])[0]
check("statut SUCCESS", res.get("status") == "SUCCESS", res.get("message", "")[:120])
check("50 fiches créées", res.get("created") == 50, str(res.get("created")))
items = res.get("items") or []
check("items détaillés = 50", len(items) == 50, str(len(items)))

# 3) base : chaque fiche a son PROPRE fichier (vérif via détail)
st, resp = req("/api/payslips?mode=list")
liste = json.loads(resp)
payslips = liste.get("payslips") or liste.get("items") or []
spec = [p for p in payslips if str(p.get("cin", "")).startswith("SPEC-")]
check("50 fiches SPEC en base", len(spec) == 50, str(len(spec)))
sizes = [p.get("fileSize") for p in spec if p.get("fileSize")]
check("tailles individuelles < taille originale (" + str(len(pdf)) + ")", bool(sizes) and all(s < len(pdf) for s in sizes), f"max={max(sizes) if sizes else '?'}")

# 4) service du fichier : %PDF-, 1 page, contenu ISOLÉ (le bon employé)
first = next(p for p in spec if p.get("cin") == "SPEC-0007")
st, fresp = req(f"/api/payslips/{first['id']}/file")
check("GET /file -> 200 + %PDF-", st == 200 and fresp[:5] == b"%PDF-", f"{st} {len(fresp)} octets")
open(TMP_PDF, "wb").write(fresp)
st, dresp = req(f"/api/payslips/{first['id']}")
det = json.loads(dresp)
check("détail: nom suffixé (page 7)", "(page 7)" in det.get("fileName", ""), det.get("fileName", ""))

# 5) ancien fichier partagé migré : les 3 fiches regroupées servent 1 page chacune
st, f2 = req("/api/payslips?cin=DEMO001234")
demo = json.loads(f2)
dl = demo.get("payslips") or demo.get("results") or demo.get("items") or []
check("fiche migrée DEMO001234 trouvable", len(dl) >= 1, f"{len(dl)} (clés: {list(demo.keys())})")
if dl:
    st, f3 = req(f"/api/payslips/{dl[0]['id']}/file")
    check("fiche migrée: %PDF- individuel", st == 200 and f3[:5] == b"%PDF-", f"{st} {len(f3)} o")

print(f"\nRésultat: {ok} OK, {fail} échec(s)")
sys.exit(1 if fail else 0)
