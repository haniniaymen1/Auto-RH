#!/usr/bin/env python3
"""Restauration de l'état post-Task-28 depuis le miroir /tmp/my-project
(cause : restauration d'environnement en arrière au changement de session).

- Copie miroir -> disque pour TOUT sauf : db/, storage/, node_modules/,
  .next/, tool-results/, worklog.md (gérés séparément) et les fichiers
  Task 29 du disque à préserver (page.tsx, all-tab.tsx, delete-many/,
  test_task29_bulk_delete.py).
- db/custom.db : sauvegarde disque puis remplacement par le miroir (00:19,
  post-Task-28, 107 fiches) — le disque restauré datait de 13:54.
- storage/payslips : rsync ADDITIF (le miroir a 336 fichiers, le disque
  restauré 314 — les 22 manquants sont ramenés).
- .env : miroir (contient AUTO_RH_STORAGE_KEY, Task 21).
- Sauvegardes préalables : /tmp/backup-disk-YYYYMMDD-HHMMSS.tar.gz (disque)
  et /tmp/mirror-backup-task28.tar.gz (miroir, hors node_modules/.next).
"""
import os, shutil, tarfile, time, sys

MIRROR = "/tmp/my-project"
DISK = "/home/z/my-project"
STAMP = time.strftime("%Y%m%d-%H%M%S")

# Fichiers Task 29 du disque à NE PAS écraser par le miroir
PRESERVE = {
    "src/app/page.tsx",
    "src/components/payslip/all-tab.tsx",
    "src/app/api/payslips/delete-many/route.ts",
    "scripts/test_task29_bulk_delete.py",
}
# Dossiers/fichiers exclus de la copie miroir -> disque
EXCLUDE_DIRS = {"node_modules", ".next", "tool-results", "storage", "db", ".git"}
EXCLUDE_FILES = {"worklog.md", "dev.log"} | PRESERVE

def tar_backup(src_dir, out, excludes=()):
    with tarfile.open(out, "w:gz") as tf:
        for root, dirs, files in os.walk(src_dir):
            rel = os.path.relpath(root, src_dir)
            if any(rel == e or rel.startswith(e + os.sep) for e in excludes):
                dirs[:] = []
                continue
            dirs[:] = [d for d in dirs
                       if not any(os.path.join(rel, d).strip(os.sep) == e
                                  or os.path.join(rel, d).startswith(e + os.sep)
                                  for e in excludes)]
            for f in files:
                p = os.path.join(root, f)
                r = os.path.relpath(p, src_dir)
                if any(r == e or r.startswith(e + os.sep) for e in excludes):
                    continue
                try:
                    tf.add(p, arcname=r)
                except OSError:
                    pass

print("1) Sauvegarde du disque actuel...")
tar_backup(DISK, f"/tmp/backup-disk-{STAMP}.tar.gz",
           excludes=("node_modules", ".next", "storage", "download"))
print("   OK /tmp/backup-disk-%s.tar.gz" % STAMP)

print("2) Sauvegarde du miroir (hors node_modules/.next/storage)...")
tar_backup(MIRROR, "/tmp/mirror-backup-task28.tar.gz",
           excludes=("node_modules", ".next", "storage", "tool-results"))
print("   OK /tmp/mirror-backup-task28.tar.gz")

print("3) Copie miroir -> disque (fichiers modifiés/nouveaux uniquement)...")
copied, skipped_preserve = 0, 0
for root, dirs, files in os.walk(MIRROR):
    rel = os.path.relpath(root, MIRROR)
    top = rel.split(os.sep)[0] if rel != "." else ""
    if top in EXCLUDE_DIRS:
        dirs[:] = []
        continue
    dirs[:] = [d for d in dirs if d not in (".next", "node_modules", "tool-results")]
    for f in files:
        src = os.path.join(root, f)
        r = os.path.normpath(os.path.join(rel, f))
        if r in EXCLUDE_FILES or r in PRESERVE:
            skipped_preserve += 1
            continue
        if r.startswith("storage" + os.sep) or r.startswith("db" + os.sep):
            continue
        dst = os.path.join(DISK, r)
        try:
            if os.path.exists(dst) and os.path.getsize(src) == os.path.getsize(dst):
                continue  # identique -> ne pas retoucher le mtime
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
            copied += 1
        except OSError as e:
            print("   ! échec", r, e)
print("   %d fichiers copiés, %d préservés (Task 29)" % (copied, skipped_preserve))

print("4) storage/payslips : rsync ADDITIF miroir -> disque (récursif)...")
added = 0
src_dir = os.path.join(MIRROR, "storage", "payslips")
dst_dir = os.path.join(DISK, "storage", "payslips")
os.makedirs(dst_dir, exist_ok=True)
for root, dirs, files in os.walk(src_dir):
    rel = os.path.relpath(root, src_dir)
    target = dst_dir if rel == "." else os.path.join(dst_dir, rel)
    os.makedirs(target, exist_ok=True)
    for f in files:
        s = os.path.join(root, f)
        d = os.path.join(target, f)
        if os.path.isdir(s):
            continue
        if not os.path.exists(d):
            shutil.copy2(s, d)
            added += 1
print("   %d fichiers de fiches rajoutés" % added)

print("5) db/custom.db : remplacement par le miroir (backup préalable)...")
db_disk = os.path.join(DISK, "db", "custom.db")
db_mirror = os.path.join(MIRROR, "db", "custom.db")
shutil.copy2(db_disk, db_disk + ".bak-" + STAMP)
shutil.copy2(db_mirror, db_disk)
print("   OK (ancien -> custom.db.bak-%s)" % STAMP)

print("6) .env (clé AUTO_RH_STORAGE_KEY)...")
shutil.copy2(os.path.join(MIRROR, ".env"), os.path.join(DISK, ".env"))
print("   OK")

print("RESTAURATION TERMINÉE.")
