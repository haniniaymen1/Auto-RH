#!/usr/bin/env python3
"""Compare auto-rh-scripts-site-web-v0.2.83.zip et v0.2.85.zip (contenu + fichiers differents)."""
import zipfile, hashlib, os, sys

V83 = "/home/z/my-project/download/auto-rh-scripts-site-web-v0.2.83.zip"
V84 = "/tmp/my-project/download/auto-rh-scripts-site-web-v0.2.84.zip"
V85 = "/tmp/my-project/download/auto-rh-scripts-site-web-v0.2.85.zip"

def charger(chemin):
    z = zipfile.ZipFile(chemin)
    infos = {}
    for i in z.infolist():
        if i.is_dir():
            continue
        infos[i.filename] = (i.CRC, i.file_size)
    return z, infos

def md5_fichier(z, nom):
    h = hashlib.md5()
    h.update(z.read(nom))
    return h.hexdigest()

def principal():
    z83, i83 = charger(V83)
    z85, i85 = charger(V85)
    z84, i84 = charger(V84)

    n83, n85 = set(i83), set(i85)
    communs = n83 & n85
    ajoutes = sorted(n85 - n83)   # présents dans 0.2.85 uniquement
    supprimes = sorted(n83 - n85) # présents dans 0.2.83 uniquement

    print("=" * 70)
    print("ENTRÉES : v0.2.83 =", len(n83), "| v0.2.85 =", len(n85), "| v0.2.84 =", len(i84))
    print("=" * 70)

    # Fichiers modifiés (communs mais contenu différent via CRC)
    diff_crc = sorted(n for n in communs if i83[n][0] != i85[n][0])
    print(f"\n### FICHIERS IDENTIQUES (CRC) : {len(communs) - len(diff_crc)} / {len(communs)} communs")
    print(f"\n### FICHIERS DIFFÉRENTS ({len(diff_crc)}) — présents dans les deux mais modifiés :")
    for n in diff_crc:
        print(f"  {n}  (83: {i83[n][1]} o / 85: {i85[n][1]} o)")

    print(f"\n### AJOUTS dans v0.2.85 absents de v0.2.83 ({len(ajoutes)}) :")
    for n in ajoutes:
        print(f"  + {n} ({i85[n][1]} o)")

    print(f"\n### RETRAITS dans v0.2.85 (absents, présents en v0.2.83) ({len(supprimes)}) :")
    for n in supprimes:
        print(f"  - {n} ({i83[n][1]} o)")

    # Version / package.json
    for nom in ("VERSION", "package.json", ".env.example"):
        if nom in n83 and nom in n85:
            c83, c85 = z83.read(nom), z85.read(nom)
            etat = "IDENTIQUE" if c83 == c85 else "DIFFÉRENT"
            print(f"\n--- {nom} : {etat}")
            if nom == "VERSION":
                print("    83 =", c83.decode(errors="replace").strip(), "| 85 =", c85.decode(errors="replace").strip())

    # Aperçu des diffs de quelques fichiers sources clés
    candidats = [n for n in diff_crc if n.endswith((".ts", ".tsx", ".prisma", ".js", ".json"))][:40]
    print("\n### DÉTAIL DIFF (extrait, premiers 300 o de contexte commun) :")
    for n in candidats[:12]:
        try:
            c83 = z83.read(n).decode("utf-8", errors="replace").splitlines()
            c85 = z85.read(n).decode("utf-8", errors="replace").splitlines()
            import difflib
            d = list(difflib.unified_diff(c83, c85, lineterm="", n=1))
            nb = len([l for l in d if (l.startswith("+") and not l.startswith("+++")) or (l.startswith("-") and not l.startswith("---"))])
            print(f"\n--- {n} : {nb} lignes modifiées")
            for l in d[2:16]:
                print("   ", l[:150])
        except Exception as e:
            print(f"\n--- {n} : erreur {e}")

if __name__ == "__main__":
    principal()
