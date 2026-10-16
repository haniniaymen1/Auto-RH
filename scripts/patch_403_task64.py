#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 64 — insertion du garde-fou « mot de passe expiré » (403) dans toutes
les API de données de l'administration.

Après chaque `const X = await getSessionUser(); if (!X) return unauthorized();`
insère :
    // NOUVEAU (Task 64) : mot de passe expiré -> seul le changement est autorisé
    if (X.mustChangePassword) return motDePasseExpire();

et ajoute `motDePasseExpire` à l'import existant de "@/lib/auth".
Idempotent : un fichier déjà patché est laissé tel quel.
"""
import io
import re
import sys

BASE = "/home/z/my-project/src/app/api"

CIBLES = [
    "stats/route.ts",
    "payslips/route.ts",
    "payslips/[id]/route.ts",
    "payslips/[id]/file/route.ts",
    "payslips/delete-many/route.ts",
    "payslips/redetect/route.ts",
    "users/route.ts",
    "users/[id]/route.ts",
    "users/[id]/role/route.ts",
    "users/[id]/password/route.ts",
]

# Motif : const VAR = await getSessionUser();\n  if (!VAR) return unauthorized();
PAT_SESSION = re.compile(
    r"(const (\w+) = await getSessionUser\(\);\n  if \(!\2\) return unauthorized\(\);)"
)

BLOC = (
    "\n  // NOUVEAU (Task 64) : mot de passe expiré — politique 15 jours, "
    "TOUS les comptes :\n  // seul le changement de mot de passe reste "
    "autorisé, toute autre API répond 403.\n"
    "  if ({var}.mustChangePassword) return motDePasseExpire();"
)

# Import : trouve `import { ... } from "@/lib/auth";` (multi-lignes possible)
PAT_IMPORT = re.compile(r'import\s*\{([^}]*)\}\s*from\s*"@/lib/auth";', re.S)


def patch_import(texte: str) -> tuple[str, bool]:
    m = PAT_IMPORT.search(texte)
    if not m:
        return texte, False
    noms = [x.strip() for x in m.group(1).split(",") if x.strip()]
    if "motDePasseExpire" in noms:
        return texte, False
    noms.insert(0, "motDePasseExpire")
    nouveau = 'import {\n  ' + ",\n  ".join(noms) + ',\n} from "@/lib/auth";'
    return texte[: m.start()] + nouveau + texte[m.end():], True


def main() -> int:
    ok = 0
    for rel in CIBLES:
        chemin = f"{BASE}/{rel}"
        with io.open(chemin, "r", encoding="utf-8") as f:
            texte = f.read()
        if "motDePasseExpire()" in texte:
            print(f"  [skip] {rel} (déjà patché)")
            ok += 1
            continue
        texte, imp_ok = patch_import(texte)
        n = 0

        def _sub(m: re.Match) -> str:
            nonlocal n
            n += 1
            return m.group(1) + BLOC.format(var=m.group(2))

        texte = PAT_SESSION.sub(_sub, texte)
        if n == 0 or not imp_ok:
            print(f"  [ERREUR] {rel} : occurrences={n}, import={imp_ok}")
            return 1
        with io.open(chemin, "w", encoding="utf-8") as f:
            f.write(texte)
        print(f"  [ok] {rel} : {n} handler(s) protégé(s)")
        ok += 1
    print(f"Terminé : {ok}/{len(CIBLES)} fichiers")
    return 0 if ok == len(CIBLES) else 1


if __name__ == "__main__":
    sys.exit(main())
