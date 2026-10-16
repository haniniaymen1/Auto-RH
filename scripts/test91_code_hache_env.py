#!/usr/bin/env python3
"""Task 91 — « Je veux que ces deux lignes soient hachées » (19/09/2026).

Vérifie que le code d'inscription n'est JAMAIS stocké en clair dans .env :

  A. CONVERSION AUTOMATIQUE : un .env contenant SIGNUP_CODE=... en clair
     (cas EXACT de l'utilisateur : SERVICE RH-8C5T-VGTL) est converti au
     démarrage en SIGNUP_CODE_HASH=scrypt:... — ligne en clair retirée,
     hash scrypt valide, LE CODE NE CHANGE PAS, message de confirmation,
     sauvegarde .env créée, code NON réimprimé ;
  B. GÉNÉRATION : un .env vierge reçoit un code fort ALÉATOIRE affiché
     UNE SEULE FOIS et stocké UNIQUEMENT en hash (aucune ligne en clair) ;
  C. IDEMPOTENCE : un .env déjà en hash reste strictement inchangé ;
  D. DÉSACTIVATION : SIGNUP_ENABLED=false n'est jamais touché ;
  E. STATUT : le mode hash est rapporté « HASH scrypt (sécurisé) », et un
     ancien mode clair annonce la conversion automatique (Task 91) ;
  F. STATIQUE : plus aucune écriture en clair dans gen-signup-code.js,
     plus de SIGNUP_CODE=PAIESAGE-2026 dans les scripts de démarrage
     (Windows CRLF + Linux/Mac), version 0.2.21, README §55 + §56.

Aucun serveur démarré : tout se joue sur des .env temporaires (AUTO_RH_DOTENV).
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

RACINE = "/home/z/my-project"
OUTIL = os.path.join(RACINE, "scripts", "gen-signup-code.js")
OK = []
KO = []


def check(nom, cond, detail=""):
    if cond:
        OK.append(nom)
        print(f"  [OK]   {nom}")
    else:
        KO.append(nom)
        print(f"  [FAIL] {nom} {detail}")


def lancer(outil_arg, env_path):
    env = dict(os.environ)
    env["AUTO_RH_DOTENV"] = env_path
    return subprocess.run(
        ["node", OUTIL, outil_arg],
        cwd=RACINE, env=env, capture_output=True, text=True, timeout=60,
    )


def ligne_de(texte, cle):
    """Retourne la valeur de CLE=... (ligne exacte, pas un préfixe d'une autre clé)."""
    for l in texte.splitlines():
        m = re.match(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$", l)
        if m and m[1] == cle:
            return m[2].strip()
    return None


def verifier_hash_scrypt(hash_complet, code):
    """Vérifie le hash avec le MÊME algorithme que src/lib/auth.ts (scrypt natif)."""
    script = (
        "const crypto=require('crypto');"
        "const [scheme,salt,hash]=process.argv[1].split(':');"
        "const cand=crypto.scryptSync(process.argv[2].trim().toUpperCase(),salt,64).toString('hex');"
        "console.log(scheme==='scrypt' && cand===hash.toLowerCase()?'HASH_VALIDE':'HASH_INVALIDE');"
    )
    r = subprocess.run(["node", "-e", script, hash_complet, code],
                       capture_output=True, text=True, timeout=60)
    return r.stdout.strip() == "HASH_VALIDE"


tmpdir = tempfile.mkdtemp(prefix="test91-")

# ==================================================================
print("=== A. CONVERSION AUTOMATIQUE d'un ancien .env en clair (cas de l'utilisateur) ===")
env_a = os.path.join(tmpdir, "env-a")
CODE_USER = "SERVICE RH-8C5T-VGTL"  # valeur EXACTE montrée dans la capture de l'utilisateur
with open(env_a, "w", encoding="utf-8") as f:
    f.write("DATABASE_URL=file:/installation/db/custom.db\n")
    f.write("AUTH_SECRET=1014840c77a7decd89a62e2a4478a02e79597556a3315e9c90d80913687fcb70\n")
    f.write("SIGNUP_CODE=" + CODE_USER + "\n")

r = lancer("--assurer", env_a)
check("conversion : exit 0", r.returncode == 0, f"(code {r.returncode})")
contenu = open(env_a, encoding="utf-8").read()
hash_a = ligne_de(contenu, "SIGNUP_CODE_HASH")
check("conversion : ligne SIGNUP_CODE_HASH=scrypt:... présente",
      bool(hash_a) and hash_a.startswith("scrypt:"), str(hash_a)[:60])
check("conversion : ligne SIGNUP_CODE=... en clair RETIRÉE", ligne_de(contenu, "SIGNUP_CODE") is None)
check("conversion : message « SÉCURISATION AUTOMATIQUE » affiché",
      "SÉCURISATION AUTOMATIQUE" in r.stdout)
check("conversion : le code n'est PAS réimprimé (il reste secret)",
      CODE_USER not in r.stdout)
check("conversion : le code lui-même ne change pas (message)",
      "NE CHANGE PAS" in r.stdout)
check("conversion : AUTH_SECRET conservée intacte",
      ligne_de(contenu, "AUTH_SECRET") == "1014840c77a7decd89a62e2a4478a02e79597556a3315e9c90d80913687fcb70")
check("conversion : DATABASE_URL conservée intacte",
      ligne_de(contenu, "DATABASE_URL") == "file:/installation/db/custom.db")
check("conversion : hash scrypt VALIDE pour le code d'origine",
      verifier_hash_scrypt(hash_a, CODE_USER))
sauvegardes = [f for f in os.listdir(tmpdir) if f.startswith("env-a.sauvegarde-code-")]
check("conversion : sauvegarde automatique du .env créée", len(sauvegardes) == 1)

# ==================================================================
print("=== B. GÉNÉRATION : .env vierge -> code fort, hash uniquement, imprimé UNE FOIS ===")
env_b = os.path.join(tmpdir, "env-b")
with open(env_b, "w", encoding="utf-8") as f:
    f.write("DATABASE_URL=file:/installation/db/custom.db\n")
r = lancer("--assurer", env_b)
check("génération : exit 0", r.returncode == 0, f"(code {r.returncode})")
contenu_b = open(env_b, encoding="utf-8").read()
hash_b = ligne_de(contenu_b, "SIGNUP_CODE_HASH")
check("génération : SIGNUP_CODE_HASH=scrypt:... présente",
      bool(hash_b) and hash_b.startswith("scrypt:"))
check("génération : AUCUNE ligne SIGNUP_CODE= en clair", ligne_de(contenu_b, "SIGNUP_CODE") is None)
affiches = re.findall(r"SERVICE RH-[A-Z2-9]{4}-[A-Z2-9]{4}", r.stdout)
check("génération : code fort affiché UNE FOIS à l'écran", len(affiches) == 1, str(affiches))
check("génération : le code affiché n'apparaît NULLE PART dans le fichier",
      bool(affiches) and affiches[0] not in contenu_b)
check("génération : message « stocké UNIQUEMENT en HASH »",
      "UNIQUEMENT en HASH" in r.stdout)
check("génération : hash scrypt VALIDE pour le code affiché",
      bool(affiches) and verifier_hash_scrypt(hash_b, affiches[0]))

# ==================================================================
print("=== C. IDEMPOTENCE : un .env déjà en hash n'est jamais modifié ===")
env_c = os.path.join(tmpdir, "env-c")
with open(env_c, "w", encoding="utf-8") as f:
    f.write("DATABASE_URL=file:/x/db/custom.db\n")
    f.write("SIGNUP_CODE_HASH=scrypt:aabbccdd:00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff\n")
avant_c = open(env_c, "rb").read()
r = lancer("--assurer", env_c)
check("idempotence : exit 0", r.returncode == 0)
check("idempotence : fichier STRICTEMENT inchangé", open(env_c, "rb").read() == avant_c)

print("=== D. DÉSACTIVATION : SIGNUP_ENABLED=false n'est jamais touché ===")
env_d = os.path.join(tmpdir, "env-d")
with open(env_d, "w", encoding="utf-8") as f:
    f.write("DATABASE_URL=file:/x/db/custom.db\n")
    f.write("SIGNUP_ENABLED=false\n")
avant_d = open(env_d, "rb").read()
r = lancer("--assurer", env_d)
check("désactivée : exit 0", r.returncode == 0)
check("désactivée : fichier STRICTEMENT inchangé (aucun code généré)",
      open(env_d, "rb").read() == avant_d)

env_d2 = os.path.join(tmpdir, "env-d2")
with open(env_d2, "w", encoding="utf-8") as f:
    f.write("DATABASE_URL=file:/x/db/custom.db\n")
    f.write("SIGNUP_CODE=MONANCIENCODE-2026\n")
    f.write("SIGNUP_ENABLED=false\n")
r = lancer("--assurer", env_d2)
contenu_d2 = open(env_d2, encoding="utf-8").read()
check("désactivée + code clair : la CONVERSION a quand même lieu (sécurisation prioritaire)",
      ligne_de(contenu_d2, "SIGNUP_CODE") is None and bool(ligne_de(contenu_d2, "SIGNUP_CODE_HASH")))
check("désactivée + code clair : SIGNUP_ENABLED=false conservé",
      ligne_de(contenu_d2, "SIGNUP_ENABLED") == "false")

# ==================================================================
print("=== E. STATUT : modes rapportés correctement ===")
r = lancer("--statut", env_a)
check("statut après conversion : « HASH scrypt (sécurisé) »",
      "HASH scrypt (sécurisé)" in r.stdout)
env_e2 = os.path.join(tmpdir, "env-e2")
with open(env_e2, "w", encoding="utf-8") as f:
    f.write("SIGNUP_CODE=CODEENCORECLAIR-2026\n")
r = lancer("--statut", env_e2)
check("statut en clair : annonce la conversion automatique (Task 91)",
      "CONVERTI AUTOMATIQUEMENT" in r.stdout)

# ==================================================================
print("=== F. STATIQUE : plus aucune écriture en clair possible ===")
outil = open(OUTIL, encoding="utf-8").read()
check("gen-signup-code.js : PLUS AUCUN appel ajouterCle(... \"SIGNUP_CODE\" ...) (écriture en clair supprimée)",
      'ajouterCle(lignes, "SIGNUP_CODE"' not in outil)
check("gen-signup-code.js : marqueur Task 91 présent",
      "Task 91" in outil and "hachées" in outil)
check("gen-signup-code.js : la conversion écrit bien SIGNUP_CODE_HASH",
      'ajouterCle(lignes, "SIGNUP_CODE_HASH"' in outil)

sh_linux = open(os.path.join(RACINE, "DEMARRER-LINUX-MAC.sh"), encoding="utf-8").read()
check("DEMARRER-LINUX-MAC.sh : appelle gen-signup-code.js --assurer",
      "gen-signup-code.js --assurer" in sh_linux)
check("DEMARRER-LINUX-MAC.sh : plus de SIGNUP_CODE=PAIESAGE-2026",
      "SIGNUP_CODE=PAIESAGE-2026" not in sh_linux)
sh_win = open(os.path.join(RACINE, "DEMARRER-WINDOWS.bat"), encoding="utf-8").read()
check("DEMARRER-WINDOWS.bat : message « stocké en HASH, jamais en clair »",
      "stocke en HASH, jamais en clair" in sh_win)
check("DEMARRER-WINDOWS.bat : plus d'invitation à lire le code dans .env",
      "voir .env" not in sh_win)
check("DEMARRER-WINDOWS.bat : CRLF conservés",
      open(os.path.join(RACINE, "DEMARRER-WINDOWS.bat"), "rb").read().count(b"\r\n") > 100)

exemple = open(os.path.join(RACINE, ".env.example"), encoding="utf-8").read()
check(".env.example : plus AUCUN code en clair en exemple (pas de ligne SIGNUP_CODE=)",
      not any(l.strip().startswith("SIGNUP_CODE=") for l in exemple.splitlines()))
check(".env.example : repère Task 91 + modèle SIGNUP_CODE_HASH documenté",
      "Task 91" in exemple and "SIGNUP_CODE_HASH=scrypt:<sel>:<empreinte>" in exemple)

pkg = json.load(open(os.path.join(RACINE, "package.json")))
check("package.json : version 0.2.23", pkg.get("version") == "0.2.23", pkg.get("version"))

readm = open(os.path.join(RACINE, "README-DEPLOIEMENT-LOCAL.md"), encoding="utf-8").read()
check("README : section 56 présente (deux lignes hachées)",
      "## 56. Les deux lignes sensibles du `.env`" in readm)
check("README : sections 54 et 55 intactes",
      "## 54. Démarrage local bloqué" in readm
      and "## 55. Portail employés : après le scan du QR code, retour à la fenêtre initiale de connexion" in readm)
check("README : explication AUTH_SECRET (clé racine, non hachable) documentée",
      "clé racine symétrique" in readm and "NE PEUT PAS être hachée" in readm)

# ==================================================================
shutil.rmtree(tmpdir, ignore_errors=True)

print("")
print("=" * 60)
print(f"RÉSULTAT : {len(OK)} OK / {len(KO)} FAIL")
if KO:
    print("ÉCHECS :", KO)
sys.exit(1 if KO else 0)
