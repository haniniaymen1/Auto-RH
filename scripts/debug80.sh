#!/usr/bin/env bash
# DEBUG Task 80 — le portail accepte-t-il un TOTP depuis un secret généré
# par l'encodeur TS (route admin) ? Isolation complète.
set -e
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RACINE"
SB="$RACINE/sandbox-dbg80"
rm -rf "$SB"; mkdir -p "$SB"
cp db/custom.db "$SB/dbg.db"
set -a; . ./.env; set +a
export DATABASE_URL="file:$SB/dbg.db"
export HOSTNAME=127.0.0.1
export PORTAL_PORT=4231
node scripts/test74_inserer.js inserer
node scripts/portail-server.js > "$SB/portail.log" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4231/ || true)
  [ "$code" = "200" ] && break; sleep 1
done

# Scénario :
#  A) 1re connexion → QR (secret1 du portail) ; reconnexion ; TOTP secret1 → attendu 200
#  B) reset DIRECT du secret en base via l'encodeur TS ; reconnexion ; TOTP nouveau → attendu 200
python3 - <<'PY'
import base64, hashlib, hmac, json, re, struct, subprocess, time, urllib.request, urllib.error, urllib.parse, os

class NR(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None
OP = urllib.request.build_opener(NR)
P = "http://127.0.0.1:4231"

def req(chemin, corps=None, cookie=None):
    data = json.dumps(corps).encode() if corps is not None else None
    r = urllib.request.Request(P + chemin, data=data)
    if data: r.add_header("Content-Type", "application/json")
    if cookie: r.add_header("Cookie", "portail_session=" + cookie)
    try:
        with OP.open(r, timeout=15) as rep:
            return rep.status, rep.read().decode(), rep.headers.get_all("Set-Cookie") or []
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(), e.headers.get_all("Set-Cookie") or []

def ck(sc):
    m = re.match(r"portail_session=([^;]+)", sc[0]) if sc else None
    return m.group(1) if m else None

def totp(secret, fenetre=None):
    f = int(time.time()) // 30 if fenetre is None else fenetre
    cle = base64.b32decode(secret + "=" * ((8 - len(secret) % 8) % 8), casefold=True)
    h = hmac.new(cle, struct.pack(">Q", f), hashlib.sha1).digest()
    o = h[-1] & 0xF
    return str(((h[o] & 0x7F) << 24 | h[o+1] << 16 | h[o+2] << 8 | h[o+3]) % 10**6).zfill(6)

def lire_secret(cin):
    # lit le secret EN CLAIR via le portail : on passe par un QR admin ? Non :
    # on lit la base directement avec le même déchiffrement que test74_inserer.
    r = subprocess.run(["node", "-e", """
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./scripts/lib-crypto-bd.js");
const prisma = new PrismaClient({ log: ["error"] });
(async () => {
  const acc = await prisma.portalAccess.findUnique({
    where: { cin: cryptoBd.chiffrerChamp(process.argv[1], true) },
    select: { totpSecret: true },
  });
  console.log("SECRET=" + (acc ? (acc.totpSecret || "") : "ABSENT"));
  await prisma.$disconnect();
})();
""", cin], cwd="/home/z/my-project", capture_output=True, text=True, timeout=30)
    m = re.search(r"SECRET=(.*)", r.stdout)
    return m.group(1) if m else ""

# A) parcours complet avec le secret du portail
st, rep, sc = req("/api/verify", {"cin": "TEST74EXPIRE", "password": "Expire74x"})
c1 = ck(sc)
st, page, _ = req("/otp", cookie=c1)
uri = urllib.parse.unquote(re.search(r'data-payload="([^"]*)"', page).group(1))
secret_qr = urllib.parse.parse_qs(urllib.parse.urlsplit(uri).query)["secret"][0]
print("A) secret du QR portail :", secret_qr)
print("A) secret lu en base    :", lire_secret("TEST74EXPIRE"))
st, rep, sc = req("/api/verify", {"cin": "TEST74EXPIRE", "password": "Expire74x"})
c2 = ck(sc)
st, page2, _ = req("/otp", cookie=c2)
m = re.search(r'id="otp-affiche">\s*(\d{3})\s*(\d{3})\s*<', page2)
code_ecran = m.group(1) + m.group(2)
st, rep, _ = req("/api/otp/verify", {"otp": code_ecran}, cookie=c2)
print("A) confirmation code écran:", st, "(session ouverte)")

# B) reset DIRECT en base avec l'encodeur TS + TOTP du nouveau secret
r = subprocess.run(["node", "-e", """
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./scripts/lib-crypto-bd.js");
const crypto = require("crypto");
const prisma = new PrismaClient({ log: ["error"] });
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function genererTS() {
  const octets = crypto.randomBytes(20);
  let sortie = "", tampon = 0, bits = 0;
  for (const octet of octets) {
    tampon = (tampon << 8) | octet; bits += 8;
    while (bits >= 5) { sortie += alphabet[(tampon >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) sortie += alphabet[(tampon << (5 - bits)) & 31];
  return sortie;
}
(async () => {
  const acc = await prisma.portalAccess.findUnique({
    where: { cin: cryptoBd.chiffrerChamp("TEST74EXPIRE", true) }, select: { id: true },
  });
  const nouveau = genererTS();
  await prisma.portalAccess.update({ where: { id: acc.id },
    data: { totpSecret: nouveau, qrPresente: false, lastUsedWindow: null } });
  console.log("NOUVEAU=" + nouveau);
  await prisma.$disconnect();
})();
"""], cwd="/home/z/my-project", capture_output=True, text=True, timeout=30)
nouveau = re.search(r"NOUVEAU=(.+)", r.stdout).group(1).strip()
print("B) nouveau secret (TS) :", nouveau)
print("B) secret relu en base :", lire_secret("TEST74EXPIRE"))

st, rep, sc = req("/api/verify", {"cin": "TEST74EXPIRE", "password": "Expire74x"})
c3 = ck(sc)
st, rep, _ = req("/api/otp/verify", {"otp": totp(nouveau)}, cookie=c3)
print("B) TOTP du nouveau secret (encodeur TS) →", st, rep[:120])

# C) reset avec l'encodeur du PORTAIL + TOTP → attendu 200
r = subprocess.run(["node", "-e", """
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./scripts/lib-crypto-bd.js");
const crypto = require("crypto");
const prisma = new PrismaClient({ log: ["error"] });
(async () => {
  const acc = await prisma.portalAccess.findUnique({
    where: { cin: cryptoBd.chiffrerChamp("TEST74EXPIRE", true) }, select: { id: true },
  });
  const s = base32EncodeSafe();
  function base32EncodeSafe() {
    const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const buf = crypto.randomBytes(20);
    let bits = 0, value = 0, out = "";
    for (const b of buf) { value = (value << 8) | b; bits += 8;
      while (bits >= 5) { out += A[(value >>> (bits - 5)) & 31]; bits -= 5; } }
    if (bits > 0) out += A[(value << (5 - bits)) & 31];
    return out;
  }
  await prisma.portalAccess.update({ where: { id: acc.id },
    data: { totpSecret: s, qrPresente: false, lastUsedWindow: null } });
  console.log("NOUVEAU=" + s);
  await prisma.$disconnect();
})();
"""], cwd="/home/z/my-project", capture_output=True, text=True, timeout=30)
nouveau2 = re.search(r"NOUVEAU=(.+)", r.stdout).group(1).strip()
print("C) nouveau secret (portail-like) :", nouveau2)
st, rep, sc = req("/api/verify", {"cin": "TEST74EXPIRE", "password": "Expire74x"})
c4 = ck(sc)
st, rep, _ = req("/api/otp/verify", {"otp": totp(nouveau2)}, cookie=c4)
print("C) TOTP du secret portail-like →", st, rep[:120])
PY
echo "— fin debug —"
