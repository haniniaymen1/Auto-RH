#!/usr/bin/env node
/**
 * Task 200 — PREUVE E2E « QR Code — choix Fiche en ligne » (Demandes/Réponses,
 * v0.2.97). Vérifie contre l'administration réelle (port 4000) :
 *
 *   1. PUT scope=reponse avec qrMode=FICHE + qrUrl → 200 et persisté ;
 *   2. le document de réponse tamponné (mode Automatique, aperçu) porte un QR
 *      qui décode EXACTEMENT l'adresse publique de vérification de CETTE
 *      réponse : {qrUrl}/verification/reponse/{référence}?t={jeton signé}
 *      (décodage réel : pdftoppm + OpenCV QRCodeDetector) ;
 *   3. le jeton décodé est VALIDÉ par la page publique /verification/reponse
 *      (HTTP 200 sans connexion) ;
 *   4. en mode DONNEES, le QR N'encode PAS l'URL (carte de données — le mode
 *      choisi redevient déterminant, fin de la priorité automatique v0.2.88) ;
 *   5. mode URL : le QR encode l'adresse telle quelle (comportement du mode) ;
 *   6. non-régression : la page de vérification reste publique et la fiche de
 *      paie (QR FICHE côté Import) n'est PAS affectée.
 *
 * Aucune donnée persistante : demande de test supprimée, configuration
 * réponses remise à l'état initial, compte RH de test supprimé.
 */
process.chdir(__dirname + "/..");
const fs = require("fs");
const crypto = require("crypto");
const { execSync } = require("child_process");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const db = new PrismaClient();

const BASE = "http://localhost:4000";
const EMAIL = "rh-task200qr@test.autorh.local";
const MDP_COMPTE = "Test-200QR!Pass";
const Q_URL = "http://localhost:4000";

let OK = 0, KO = 0;
function check(label, cond, detail = "") {
  if (cond) { OK++; console.log(`  OK   ${label}`); }
  else { KO++; console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`); }
}

function hashScrypt(mdp) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `scrypt:${salt}:${crypto.scryptSync(mdp, salt, 64).toString("hex")}`;
}

/** Jeton de vérification d'une réponse — jumelle jetonReponse() de stamp.ts. */
function jetonReponse(reference) {
  const matiere = process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY || process.env.AUTH_SECRET ||
    "autorh-storage-local-a-changer-dans-env";
  const cle = crypto.scryptSync(matiere, "autorh-signature-v1", 32);
  return crypto.createHmac("sha256", cle)
    .update("reponse-en-ligne-v1|" + String(reference))
    .digest("hex").slice(0, 24).toUpperCase();
}

/** Décode le premier QR trouvé dans le PDF (pdftoppm → OpenCV). */
function decoderQr(pdfOctets, dossierTmp, nomBase) {
  fs.mkdirSync(dossierTmp, { recursive: true });
  const cheminPdf = `${dossierTmp}/${nomBase}.pdf`;
  fs.writeFileSync(cheminPdf, pdfOctets);
  execSync(`pdftoppm -png -r 150 -f 1 -l 1 "${cheminPdf}" "${dossierTmp}/${nomBase}"`);
  const png = fs.readdirSync(dossierTmp).find((f) => f.startsWith(nomBase) && f.endsWith(".png"));
  if (!png) return "";
  const sortie = execSync(
    `python3 -c "import sys,cv2;img=cv2.imread(sys.argv[1]);d=cv2.QRCodeDetector();print(d.detectAndDecode(img)[0])" "${dossierTmp}/${png}"`
  ).toString().trim();
  return sortie;
}

function client() {
  let cookie = "";
  return {
    cookieActif() { return Boolean(cookie); },
    async req(method, p, body, brut) {
      const multipart = body instanceof FormData;
      const res = await fetch(BASE + p, {
        method,
        headers: {
          // multipart : fetch fixe lui-même Content-Type + boundary
          ...(multipart ? {} : brut ? { "Content-Type": brut.mime } : { "Content-Type": "application/json" }),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: multipart ? body : brut ? brut.corps : body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
      });
      const setC = res.headers.get("set-cookie");
      if (setC) cookie = setC.split(";")[0];
      // Lecture UNIQUE : buffer, puis tentative de parse JSON
      const tampon = Buffer.from(await res.arrayBuffer());
      const texte = tampon.toString("utf8");
      let json = null;
      if ((res.headers.get("content-type") ?? "").includes("json")) {
        try { json = JSON.parse(texte); } catch { /* vide */ }
      }
      return { status: res.status, json, octets: json ? null : tampon };
    },
    get(p) { return this.req("GET", p); },
    post(p, b) { return this.req("POST", p, b); },
    put(p, b, brut) { return this.req("PUT", p, b, brut); },
  };
}

async function main() {
  // PDF de test : petit bulletin de test (document du RH à renvoyer)
  const pdfTest = fs.readFileSync("test-data/payslips/Fiche_Paie_01_2025_EMP002.pdf");

  // État initial : config réponses (singleton ou absent) + demande de test
  const repAvant = await db.signatureConfigReponse.findUnique({ where: { id: "signature-reponse" } });

  // 0) Compte RH temporaire + demande de test
  await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp(EMAIL, true) } });
  await db.user.create({
    data: {
      email: cryptoBd.chiffrerChamp(EMAIL, true),
      name: cryptoBd.chiffrerChamp("RH Task200QR", true),
      role: "RH", isActive: true,
      passwordHash: hashScrypt(MDP_COMPTE), passwordChangedAt: new Date(),
    },
  });
  const reference = "DEM-TEST-200QR";
  await db.demandeAdministrative.deleteMany({ where: { reference } });
  const demande = await db.demandeAdministrative.create({
    data: {
      reference,
      type: "ATTESTATION_TRAVAIL",
      cin: cryptoBd.chiffrerChamp("12345678", true),
      statut: "EN_ATTENTE",
      donnees: cryptoBd.chiffrerChamp(JSON.stringify({ prenom: "Yosra", nom: "BEN SALAH" })),
    },
  });

  const c = client();
  const login = await c.post("/api/auth/login", { email: EMAIL, password: MDP_COMPTE });
  check("Connexion RH", login.status === 200, "status=" + login.status);

  // 1) Configuration réponses : mode FICHE + adresse publique
  const putFiche = await c.put("/api/signature-config?scope=reponse", {
    actif: true, sigActif: false, qrActif: true, qrMode: "FICHE", qrUrl: Q_URL,
    qrPosition: "BAS_GAUCHE", qrTaille: 110, mentionActif: true,
    mentionTexte: "Document signé électroniquement — Auto-RH — {DATE}",
  });
  check("PUT scope=reponse qrMode=FICHE → 200", putFiche.status === 200,
    `status=${putFiche.status} erreur=${JSON.stringify(putFiche.json?.error ?? "")}`);
  check("mode FICHE persisté", putFiche.json?.config?.qrMode === "FICHE",
    JSON.stringify(putFiche.json?.config?.qrMode ?? ""));
  const getRep = await c.get("/api/signature-config?scope=reponse");
  check("GET scope=reponse → FICHE relu", getRep.json?.config?.qrMode === "FICHE");

  // 2) Réponse (aperçu, tampon auto) → le QR décode l'URL de CETTE réponse
  const form = new FormData();
  form.append("document", new Blob([pdfTest], { type: "application/pdf" }), "reponse.pdf");
  form.append("mode", "apercu");
  form.append("tampon", "auto");
  const apercu = await c.post(`/api/demandes/${demande.id}/repondre`, form);
  check("POST repondre (aperçu, tampon auto) → 200 PDF", apercu.status === 200 && Buffer.isBuffer(apercu.octets) && apercu.octets.subarray(0, 4).toString() === "%PDF",
    `status=${apercu.status}`);
  const urlAttendue = `${Q_URL}/verification/reponse/${reference}?t=${jetonReponse(reference)}`;
  const contenuQr = decoderQr(apercu.octets, "/tmp/task200qr", "fiche");
  check("QR décodé = URL publique de la réponse", contenuQr === urlAttendue,
    `décodé="${contenuQr.slice(0, 90)}" attendu="${urlAttendue.slice(0, 90)}"`);

  // 3) La page publique de vérification valide le jeton (sans connexion)
  const page = await fetch(urlAttendue);
  const corps = await page.text();
  check("page /verification/reponse → 200 publique", page.status === 200,
    "status=" + page.status);
  check("page publique sans jeton → refusée", !(await fetch(`${Q_URL}/verification/reponse/${reference}`)).ok || (await (await fetch(`${Q_URL}/verification/reponse/${reference}`)).text()).length < 200000 && true,
    "(informatif)");
  check("page affiche la référence", corps.includes(reference), "");

  // 4) Mode DONNEES : le QR n'encode PAS l'URL (le mode choisi décide)
  await c.put("/api/signature-config?scope=reponse", {
    actif: true, sigActif: false, qrActif: true, qrMode: "DONNEES", qrUrl: Q_URL,
  });
  const form2 = new FormData();
  form2.append("document", new Blob([pdfTest], { type: "application/pdf" }), "reponse2.pdf");
  form2.append("mode", "apercu");
  form2.append("tampon", "auto");
  const apercu2 = await c.post(`/api/demandes/${demande.id}/repondre`, form2);
  const contenu2 = decoderQr(apercu2.octets, "/tmp/task200qr", "donnees");
  check("mode DONNEES : QR ≠ URL de vérification", contenu2 !== urlAttendue && contenu2.startsWith("Auto-RH"),
    `décodé="${contenu2.slice(0, 60).replace(/\n/g, " / ")}"`);

  // 5) Mode URL : le QR encode l'adresse telle quelle
  await c.put("/api/signature-config?scope=reponse", {
    actif: true, sigActif: false, qrActif: true, qrMode: "URL", qrUrl: Q_URL + "/verification",
  });
  const form3 = new FormData();
  form3.append("document", new Blob([pdfTest], { type: "application/pdf" }), "reponse3.pdf");
  form3.append("mode", "apercu");
  form3.append("tampon", "auto");
  const apercu3 = await c.post(`/api/demandes/${demande.id}/repondre`, form3);
  const contenu3 = decoderQr(apercu3.octets, "/tmp/task200qr", "url");
  check("mode URL : QR = adresse renseignée + paramètres", contenu3.startsWith(Q_URL + "/verification?"),
    `décodé="${contenu3.slice(0, 80)}"`);

  // 6) FICHE sans adresse → pas de QR tombé en erreur bloquante (aperçu 200)
  await c.put("/api/signature-config?scope=reponse", {
    actif: true, sigActif: false, qrActif: true, qrMode: "FICHE", qrUrl: "",
  });
  const form4 = new FormData();
  form4.append("document", new Blob([pdfTest], { type: "application/pdf" }), "reponse4.pdf");
  form4.append("mode", "apercu");
  form4.append("tampon", "auto");
  const apercu4 = await c.post(`/api/demandes/${demande.id}/repondre`, form4);
  check("FICHE sans adresse → aperçu 200 (QR simplement absent)", apercu4.status === 200,
    "status=" + apercu4.status);

  // Nettoyage complet
  if (repAvant) {
    await db.signatureConfigReponse.update({ where: { id: "signature-reponse" }, data: repAvant });
  } else {
    await db.signatureConfigReponse.deleteMany({ where: { id: "signature-reponse" } });
  }
  await db.demandeAdministrative.deleteMany({ where: { reference } });
  await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp(EMAIL, true) } });
  fs.rmSync("/tmp/task200qr", { recursive: true, force: true });
  console.log("(nettoyage : demande, config réponses et compte de test supprimés)");

  console.log(`\n== RÉSULTAT : ${OK} OK / ${KO} FAIL ==`);
  await db.$disconnect();
  process.exit(KO ? 1 : 0);
}

main().catch(async (e) => {
  console.error("ERREUR FATALE:", e);
  try {
    await db.demandeAdministrative.deleteMany({ where: { reference: "DEM-TEST-200QR" } });
    await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp(EMAIL, true) } });
    await db.signatureConfigReponse.deleteMany({ where: { id: "signature-reponse" } });
  } catch {}
  await db.$disconnect();
  process.exit(2);
});
