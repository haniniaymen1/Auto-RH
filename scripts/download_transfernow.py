#!/usr/bin/env python3
# Task 157 — Téléchargement du transfert TransferNow 20260924YAUvrhgw (22 fichiers)
import json, os, re, subprocess, sys, urllib.parse

BASE = "/home/z/my-project/tmp-transfernow"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36"
TRANSFER_ID = sys.argv[1] if len(sys.argv) > 1 else "20260924YAUvrhgw"
print(f"Transfert: {TRANSFER_ID}")
DEST = os.path.join(BASE, f"transfer_{TRANSFER_ID}")
os.makedirs(DEST, exist_ok=True)

data = json.load(open(os.path.join(BASE, "next_data.json")))
if len(sys.argv) > 1:
    import re as _re, urllib.request as _ur
    html = _ur.urlopen(_ur.Request(f"https://www.transfernow.net/dl/{TRANSFER_ID}",
                                   headers={"User-Agent": UA})).read().decode("utf-8", "replace")
    m = _re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, _re.S)
    data = json.loads(m.group(1))
files = data["props"]["pageProps"]["transferData"]["metadata"]["files"]
print(f"{len(files)} fichiers a telecharger, total prevu: {sum(f['size'] for f in files)} octets")

ok, fail = [], []
for f in files:
    fid, name = f["id"], f["name"]
    out = os.path.join(DEST, re.sub(r'\s+', '_', name))
    if os.path.exists(out) and os.path.getsize(out) == f["size"]:
        print(f"[SKIP] {name} deja present ({f['size']} o)")
        ok.append((name, f["size"]))
        continue
    # 1) demander le lien signe
    api = f"https://www.transfernow.net/api/transfer/downloads/link?transferId={TRANSFER_ID}&fileId={fid}"
    r = subprocess.run(["curl", "-s", "-m", "30", "-A", UA,
                        "-H", "Content-Type: application/json",
                        "-H", f"Referer: https://www.transfernow.net/en/cld?utm_source={TRANSFER_ID}",
                        api], capture_output=True, text=True)
    try:
        link = json.loads(r.stdout)["url"]
    except Exception as e:
        print(f"[FAIL-LINK] {name}: {r.stdout[:200]}")
        fail.append((name, "lien"))
        continue
    # 2) telecharger le fichier
    r2 = subprocess.run(["curl", "-sL", "-m", "300", "-A", UA, "--retry", "2", "-o", out, link],
                        capture_output=True, text=True)
    size = os.path.getsize(out) if os.path.exists(out) else 0
    if size == f["size"]:
        print(f"[OK] {name}: {size} o")
        ok.append((name, size))
    else:
        print(f"[FAIL-DL] {name}: {size} o (attendu {f['size']})")
        fail.append((name, f"{size}/{f['size']}"))

print()
print(f"Telecharges: {len(ok)}/{len(files)}")
if fail:
    print("ECHECS:")
    for n, why in fail:
        print(f"  - {n}: {why}")
sys.exit(0 if not fail else 1)
