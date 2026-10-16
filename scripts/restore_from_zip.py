#!/usr/bin/env python3
"""Restaure depuis le ZIP tout fichier ABSENT du workspace (jamais écraser)."""
import zipfile, os

ZIP = "/home/z/my-project/download/auto-rh-scripts-site-web.zip"
BASE = "/home/z/my-project"
SKIP_DIRS = ("storage/payslips/", "db/", ".next/", "node_modules/")

restored, kept = [], 0
with zipfile.ZipFile(ZIP) as z:
    for name in z.namelist():
        if name.endswith("/"):
            continue
        if any(s in name for s in SKIP_DIRS):
            continue  # données, pas du code
        target = os.path.join(BASE, name)
        if os.path.exists(target):
            kept += 1
            continue
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "wb") as f:
            f.write(z.read(name))
        restored.append(name)

print(f"Déjà présents (conservés tels quels) : {kept}")
print(f"Restaurés (absents) : {len(restored)}")
for r in restored:
    print("  +", r)
