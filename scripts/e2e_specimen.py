#!/usr/bin/env python3
"""E2E : import des 4 artefacts specimen via l'API du site (comme l'utilisateur).
Vérifie les enregistrements créés + la recherche exacte par CIN + la redétection."""
import json, sys, time, urllib.request, http.cookiejar

BASE = "http://localhost:3000"
cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def req(path, data=None, headers=None, method=None, timeout=600):
    r = urllib.request.Request(BASE + path, data=data, method=method)
    for k, v in (headers or {}).items():
        r.add_header(k, v)
    try:
        resp = opener.open(r, timeout=timeout)
        return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

def multipart(files):
    b = "----Auto-RHE2E" + str(int(time.time() * 1000))
    body = b""
    for fname, fbytes, ctype in files:
        body += (f"--{b}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"{fname}\"\r\nContent-Type: {ctype}\r\n\r\n").encode() + fbytes + b"\r\n"
    body += f"--{b}--\r\n".encode()
    return body, {"Content-Type": f"multipart/form-data; boundary={b}"}

def main():
    # 1) login
    st, _ = req("/api/auth/login", data=json.dumps({"email": "it@demo.tn", "password": "demo1234"}).encode(),
                headers={"Content-Type": "application/json"})
    print("login:", st)
    if st != 200:
        sys.exit(1)

    UP = "/home/z/my-project/upload"
    results = {}

    # 2) ZIP des 50 PNG
    with open(f"{UP}/bulletins_specimen_50_PNG.zip", "rb") as f:
        body, h = multipart([("bulletins_specimen_50_PNG.zip", f.read(), "application/zip")])
    t0 = time.time()
    st, resp = req("/api/payslips/upload", data=body, headers=h, method="POST")
    j = json.loads(resp)
    results["zip_png"] = {"status": st, "msg": j["results"][0]["message"] if j.get("results") else j, "sec": round(time.time() - t0, 1)}
    print("ZIP PNG:", json.dumps(results["zip_png"], ensure_ascii=False)[:300])

    # 3) ZIP des 50 PDF image
    with open(f"{UP}/bulletins_specimen_50_PDF.zip", "rb") as f:
        body, h = multipart([("bulletins_specimen_50_PDF.zip", f.read(), "application/zip")])
    t0 = time.time()
    st, resp = req("/api/payslips/upload", data=body, headers=h, method="POST")
    j = json.loads(resp)
    results["zip_pdf"] = {"status": st, "msg": j["results"][0]["message"] if j.get("results") else j, "sec": round(time.time() - t0, 1)}
    print("ZIP PDF:", json.dumps(results["zip_pdf"], ensure_ascii=False)[:300])

    # 4) XLSX (50 bulletins en 1 classeur)
    with open(f"{UP}/bulletins_specimen_50.xlsx", "rb") as f:
        body, h = multipart([("bulletins_specimen_50.xlsx", f.read(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")])
    st, resp = req("/api/payslips/upload", data=body, headers=h, method="POST")
    j = json.loads(resp)
    results["xlsx"] = {"status": st, "msg": j["results"][0]["message"] if j.get("results") else j}
    print("XLSX:", json.dumps(results["xlsx"], ensure_ascii=False)[:300])

    # 5) PDF multi-fiches (50 bulletins, 50 pages)
    with open(f"{UP}/bulletins_specimen_50.pdf", "rb") as f:
        body, h = multipart([("bulletins_specimen_50.pdf", f.read(), "application/pdf")])
    st, resp = req("/api/payslips/upload", data=body, headers=h, method="POST")
    j = json.loads(resp)
    results["multipdf"] = {"status": st, "msg": j["results"][0]["message"][:120] if j.get("results") else j, "created": j["results"][0].get("created") if j.get("results") else None}
    print("PDF multi:", json.dumps(results["multipdf"], ensure_ascii=False)[:300])

    # 6) vérifications
    st, resp = req("/api/payslips?limit=500")
    j = json.loads(resp)
    items = j["items"]
    total = j["total"]
    spec = [i for i in items if i["fileName"].startswith("bulletins_specimen_50") or "bulletin_9" in i["fileName"]]
    with_cin = [i for i in spec if i["cin"]]
    with_all = [i for i in spec if i["cin"] and i["employeeName"] and i["period"] and i["netSalary"]]
    print(f"\nTOTAL base: {total} | fiches specimen: {len(spec)} | avec CIN: {len(with_cin)} | champs complets: {len(with_all)}")
    print("exemples:")
    for i in with_all[:3]:
        print("  ", i["fileName"][:45], "|", i["cin"], "|", i["employeeName"], "|", i["period"], "|", i["netSalary"])

    # 7) recherche exacte par CIN (comme le portail)
    for q in ["SPEC-0001", "SPEC0001", "SPECIMEN-001", "SPEC-0050"]:
        st, resp = req(f"/api/payslips?cin={urllib.parse.quote(q)}")
        j = json.loads(resp)
        found = j.get("total", 0)
        ok = found >= 1
        print(f"recherche {q}: {found} trouvé(s) {'OK' if ok else 'ÉCHEC'}")

    # garde les compteurs pour la suite
    with open("/home/z/my-project/scripts/e2e_results.json", "w") as f:
        json.dump({"total": total, "spec": len(spec), "withCin": len(with_cin), "complete": len(with_all)}, f)

if __name__ == "__main__":
    main()
