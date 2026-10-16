#!/usr/bin/env python3
"""
Task 89 — Démarrage local SANS npx : plus aucun prompt bloquant
(« Need to install the following packages: prisma@8.0.0-rc.15 — Ok to proceed? (y) »).

SIGNALEMENT (v0.2.18) : le démarrage silencieux RESTAIT BLOQUÉ à l'étape [3/6]
« Dependances deja installees » : npx, ne trouvant PAS le CLI Prisma dans un
node_modules incomplet, PROPOSAIT de télécharger la dernière version publiée
(prisma@8.0.0-rc.15 au lieu de la 6.x figée par package.json) via un prompt
INTERACTIF — blocage définitif en mode silencieux (fenêtre cachée).

APRÈS (v0.2.19), LES 7 SCRIPTS DE DÉMARRAGE (4 Windows + 3 Linux/Mac) :
  1. vérif ROBUSTE des dépendances : node_modules + CLI Prisma local
     (node_modules/prisma/build/index.js) + Next local
     (node_modules/next/dist/bin/next) -> npm install relancé s'il manque ;
  2. appel du CLI LOCAL via « node <chemin> » : plus AUCUN npx exécutable —
     aucun téléchargement hors de contrôle, AUCUN prompt, AUCUN blocage ;
  3. garde-fou : si le CLI local manque encore après installation -> échec
     PROPRE avec message clair (jamais de question interactive).

CONTENU : contrôles statiques (7 fichiers) + E2E des commandes locales exactes
(db push + generate sur COPIE de base via harnais test89_harnais.sh ; next
--version pour le point d'entrée du build) + syntaxe bash des .sh + CRLF des .bat.
"""
import os
import re
import subprocess
import sys

RACINE = os.environ.get("RACINE") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_COPIE = os.environ.get("DB_COPIE") or os.path.join(RACINE, "sandbox-test89", "test89.db")
PKG = os.path.join(RACINE, "package.json")

BATS = [
    "PREPARER-AUTO-RH-SILENCIEUX.bat",
    "DEMARRER-WINDOWS.bat",
    "DEMARRER-PORTAIL-WINDOWS.bat",
    "DEMARRER-TOUT-WINDOWS.bat",
]
SHS = [
    "DEMARRER-LINUX-MAC.sh",
    "DEMARRER-PORTAIL-LINUX-MAC.sh",
    "DEMARRER-TOUT-LINUX-MAC.sh",
]
AVEC_BUILD = {"PREPARER-AUTO-RH-SILENCIEUX.bat", "DEMARRER-WINDOWS.bat", "DEMARRER-LINUX-MAC.sh"}
TOUS = BATS + SHS

CLI_PRISMA_WIN = 'node "node_modules\\prisma\\build\\index.js"'
CLI_NEXT_WIN = 'node "node_modules\\next\\dist\\bin\\next" build'
CLI_PRISMA_SH = "node node_modules/prisma/build/index.js"
CLI_NEXT_SH = "node node_modules/next/dist/bin/next build"
GARDE = "CLI Prisma local est introuvable"
MARQUEUR = "MODIFIE Task 89"

RESULTATS = []


def check(nom, cond, detail=""):
    RESULTATS.append(bool(cond))
    print(("OK  " if cond else "KO  ") + nom + ("" if cond else "  -> " + str(detail)[:220]))


def bilan(nom):
    total = len(RESULTATS)
    verts = sum(RESULTATS)
    print("=" * 76)
    print(f"{nom} : {verts}/{total}")
    print("=" * 76)
    return 0 if verts == total else 1


def lit(nom_fichier):
    with open(os.path.join(RACINE, nom_fichier), "r", encoding="utf-8", newline="") as f:
        return f.read()


def ligne_npx_executable(texte, prefixe_commentaire):
    """Renvoie (numero, ligne) de la 1re ligne EXECUTANT npx (commentaires ignorés)."""
    for numero, ligne in enumerate(texte.splitlines(), 1):
        epure = ligne.strip()
        if epure.startswith(prefixe_commentaire):
            continue
        if re.match(r"^(call\s+)?@?npx(\s|$)", epure):
            return (numero, ligne)
    return None


# ============ Contrôles statiques : 4 scripts Windows (.bat) ============
for bat in BATS:
    texte = lit(bat)
    check(f"[{bat}] aucune ligne exécutable npx (commentaires exclus)",
          ligne_npx_executable(texte, "REM") is None,
          ligne_npx_executable(texte, "REM"))
    check(f"[{bat}] fins de ligne CRLF (cmd.exe)", "\r\n" in texte)
    check(f"[{bat}] CLI Prisma LOCAL appelé via node", CLI_PRISMA_WIN in texte)
    check(f"[{bat}] déclencheur robuste : CLI Prisma local vérifié avant usage",
          'if not exist "node_modules\\prisma\\build\\index.js"' in texte)
    check(f"[{bat}] garde-fou échec PROPRE (jamais de prompt)", GARDE in texte)
    check(f"[{bat}] traçabilité Task 89", MARQUEUR in texte)
    if bat in AVEC_BUILD:
        check(f"[{bat}] build Next LOCAL via node", CLI_NEXT_WIN in texte)
        check(f"[{bat}] déclencheur robuste : Next local vérifié",
              'if not exist "node_modules\\next\\dist\\bin\\next"' in texte)

# ============ Contrôles statiques : 3 scripts Linux/Mac (.sh) ============
for sh in SHS:
    texte = lit(sh)
    check(f"[{sh}] aucune ligne exécutable npx (commentaires exclus)",
          ligne_npx_executable(texte, "#") is None,
          ligne_npx_executable(texte, "#"))
    check(f"[{sh}] CLI Prisma LOCAL appelé via node", CLI_PRISMA_SH in texte)
    check(f"[{sh}] déclencheur robuste : CLI Prisma local vérifié avant usage",
          '[ ! -f "node_modules/prisma/build/index.js" ]' in texte)
    check(f"[{sh}] garde-fou échec PROPRE (jamais de prompt)", GARDE in texte)
    check(f"[{sh}] traçabilité Task 89", MARQUEUR in texte)
    if sh in AVEC_BUILD:
        check(f"[{sh}] build Next LOCAL via node", CLI_NEXT_SH in texte)
        check(f"[{sh}] déclencheur robuste : Next local vérifié",
              '[ ! -f "node_modules/next/dist/bin/next" ]' in texte)

# ============ Balayage global anti-npx exécutable ============
fuyards = []
for fichier in TOUS:
    texte = lit(fichier)
    found = ligne_npx_executable(texte, "REM" if fichier.endswith(".bat") else "#")
    if found:
        fuyards.append((fichier, found))
check("[GLOBAL] zéro ligne exécutable npx dans les 7 scripts", not fuyards, fuyards)

# ============ Syntaxe bash des 3 .sh ============
for sh in SHS:
    r = subprocess.run(["bash", "-n", os.path.join(RACINE, sh)],
                       capture_output=True, text=True, timeout=60)
    check(f"[{sh}] syntaxe bash valide (bash -n)", r.returncode == 0, r.stderr)

# ============ E2E : les commandes LOCALES exactes fonctionnent ============
env = dict(os.environ)
env["DATABASE_URL"] = "file:" + DB_COPIE
env.pop("PORTAL_PORT", None)

r = subprocess.run(["node", "node_modules/prisma/build/index.js", "db", "push"],
                   cwd=RACINE, env=env, capture_output=True, text=True, timeout=300)
check("[E2E] db push via CLI Prisma LOCAL (COPIE de base) -> 0",
      r.returncode == 0, (r.stderr or r.stdout)[-300:])

r = subprocess.run(["node", "node_modules/prisma/build/index.js", "generate"],
                   cwd=RACINE, env=env, capture_output=True, text=True, timeout=300)
check("[E2E] generate via CLI Prisma LOCAL -> 0",
      r.returncode == 0, (r.stderr or r.stdout)[-300:])

r = subprocess.run(["node", "node_modules/next/dist/bin/next", "--version"],
                   cwd=RACINE, env=env, capture_output=True, text=True, timeout=120)
check("[E2E] point d'entrée Next LOCAL répond (--version)",
      r.returncode == 0 and "16." in (r.stdout or ""), (r.stderr or r.stdout)[-300:])

# ============ Version ============
with open(PKG, "r", encoding="utf-8") as f:
    pkg = f.read()
check("[VERSION] package.json en 0.2.23", '"version": "0.2.23"' in pkg)

sys.exit(bilan("TASK89 DEMARRAGE SANS NPX"))
