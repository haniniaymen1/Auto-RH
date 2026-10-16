#!/usr/bin/env node
/**
 * Task 202 — PREUVE E2E « QR Code — Fiche en ligne ne fonctionne pas
 * correctement » (Demandes/Réponses, v0.2.98). Signalement : « lorsque cette
 * option est sélectionnée, le QR Code se comporte comme l'option "Données de
 * la réponse" ».
 *
 * CAUSE (corrigée) : POST /api/signature-config (action=apercu, scope=reponse)
 * filtrait qrMode SANS « FICHE » — l'APERÇU de la section Demandes/Réponses
 * dégradait silencieusement le mode « Fiche en ligne » en « Données ».
 *
 * Vérifié contre l'administration réelle (port 4000) :
 *   1. PUT scope=reponse qrMode=FICHE + qrUrl → 200 et persisté ;
 *   2. APERÇU du PANNEAU (POST action=apercu scope=reponse) en mode FICHE →
 *      le QR du PDF décode EXACTEMENT
 *      {qrUrl}/verification/reponse/DEM-2026-00042?t={jeton signé}
 *      (AVANT correctif : décodait la carte « Données de la réponse ») ;
 *   3. même aperçu en mode DONNEES → le QR décode la carte de données (le
 *      mode choisi redevient déterminant) ;
 *   4. même aperçu en mode URL → le QR encode l'adresse + paramètres ;
 *   5. NON-RÉGRESSION tamponnage réel : repondre (auto, FICHE) → le QR du
 *      PDF décode l'URL de vérification de CETTE réponse ;
 *   6. non-régression : page /verification/reponse publique 200.
 *
 * Aucune donnée persistante : configuration réponses remise à l'état initial,
 * demande de test supprimée, compte RH de test supprimé.
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
const EMAIL = "rh-task202qr@test.autorh.local";
const MDP_COMPTE = "Test-202QR!Pass";
const Q_URL = "http://localhost:4000";
const REF_APERCU = "DEM-2026-00042"; // référence de l'exemple synthétique (apercuReponseTampon)

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
    async req(method, p, body, brut) {
      const multipart = body instanceof FormData;
      const res = await fetch(BASE + p, {
        method,
        headers: {
          ...(multipart ? {} : brut ? { "Content-Type": brut.mime } : { "Content-Type": "application/json" }),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: multipart ? body : brut ? brut.corps : body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
      });
      const setC = res.headers.get("set-cookie");
      if (setC) cookie = setC.split(";")[0];
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
    put(p, b) { return this.req("PUT", p, b); },
  };
}

async function main() {
  const pdfTest = fs.readFileSync("test-data/payslips/Fiche_Paie_01_2025_EMP002.pdf");

  const repAvant = await db.signatureConfigReponse.findUnique({ where: { id: "signature-reponse" } });

  // 0) Compte RH temporaire + demande de test
  await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp(EMAIL, true) } });
  await db.user.create({
    data: {
      email: cryptoBd.chiffrerChamp(EMAIL, true),
      name: cryptoBd.chiffrerChamp("RH Task202QR", true),
      role: "RH", isActive: true,
      passwordHash: hashScrypt(MDP_COMPTE), passwordChangedAt: new Date(),
    },
  });
  const reference = "DEM-TEST-202QR";
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

  // 2) ★ LE BUG SIGNALÉ — APERÇU du PANNEAU (POST action=apercu scope=reponse)
  //    en mode FICHE : le QR doit encoder l'URL publique de la réponse
  //    d'exemple (avant correctif : carte « Données de la réponse »).
  const urlAttendueApercu = `${Q_URL}/verification/reponse/${REF_APERCU}?t=${jetonReponse(REF_APERCU)}`;
  const apFiche = await c.post("/api/signature-config", {
    action: "apercu", scope: "reponse",
    actif: true, sigActif: false, qrActif: true, qrMode: "FICHE", qrUrl: Q_URL,
  });
  check("POST apercu scope=reponse FICHE → 200 PDF", apFiche.status === 200 &&
      Buffer.isBuffer(apFiche.octets) && apFiche.octets.subarray(0, 4).toString() === "%PDF",
    `status=${apFiche.status}`);
  const qrFiche = decoderQr(apFiche.octets ?? Buffer.alloc(0), "/tmp/task202qr", "apercu-fiche");
  check("APERÇU FICHE : QR = URL publique de la réponse d'exemple", qrFiche === urlAttendueApercu,
    `décodé="${qrFiche.slice(0, 90)}" attendu="${urlAttendueApercu.slice(0, 90)}"`);
  check("APERÇU FICHE : le QR n'est PLUS la carte de données", !qrFiche.startsWith("Auto-RH — Document officiel"),
    `décodé="${qrFiche.slice(0, 60).replace(/\n/g, " / ")}"`);

  // 3) APERÇU en mode DONNEES → carte de données (contenu propre du mode)
  const apDonnees = await c.post("/api/signature-config", {
    action: "apercu", scope: "reponse",
    actif: true, sigActif: false, qrActif: true, qrMode: "DONNEES", qrUrl: Q_URL,
  });
  const qrDonnees = decoderQr(apDonnees.octets ?? Buffer.alloc(0), "/tmp/task202qr", "apercu-donnees");
  check("APERÇU DONNEES : QR = carte de données", qrDonnees.startsWith("Auto-RH — Document officiel") &&
      qrDonnees.includes("Réf : " + REF_APERCU),
    `décodé="${qrDonnees.slice(0, 60).replace(/\n/g, " / ")}"`);

  // 4) APERÇU en mode URL → adresse + paramètres (contenu propre du mode)
  const apUrl = await c.post("/api/signature-config", {
    action: "apercu", scope: "reponse",
    actif: true, sigActif: false, qrActif: true, qrMode: "URL", qrUrl: Q_URL + "/verification",
  });
  const qrUrl = decoderQr(apUrl.octets ?? Buffer.alloc(0), "/tmp/task202qr", "apercu-url");
  check("APERÇU URL : QR = adresse renseignée + paramètres", qrUrl.startsWith(Q_URL + "/verification?"),
    `décodé="${qrUrl.slice(0, 80)}"`);

  // 5) NON-RÉGRESSION tamponnage réel : repondre (auto) en FICHE → URL de CETTE réponse
  await c.put("/api/signature-config?scope=reponse", {
    actif: true, sigActif: false, qrActif: true, qrMode: "FICHE", qrUrl: Q_URL,
    mentionActif: true, mentionTexte: "Document signé électroniquement — Auto-RH — {DATE}",
  });
  const form = new FormData();
  form.append("document", new Blob([pdfTest], { type: "application/pdf" }), "reponse.pdf");
  form.append("mode", "apercu");
  form.append("tampon", "auto");
  const rep = await c.post(`/api/demandes/${demande.id}/repondre`, form);
  check("repondre (aperçu, auto, FICHE) → 200 PDF", rep.status === 200 &&
      Buffer.isBuffer(rep.octets) && rep.octets.subarray(0, 4).toString() === "%PDF",
    `status=${rep.status}`);
  const urlAttendueReelle = `${Q_URL}/verification/reponse/${reference}?t=${jetonReponse(reference)}`;
  const qrReel = decoderQr(rep.octets ?? Buffer.alloc(0), "/tmp/task202qr", "reel-fiche");
  check("TAMPON RÉEL FICHE : QR = URL publique de CETTE réponse", qrReel === urlAttendueReelle,
    `décodé="${qrReel.slice(0, 90)}" attendu="${urlAttendueReelle.slice(0, 90)}"`);

  // 6) La page publique de vérification valide le jeton (sans connexion)
  const page = await fetch(urlAttendueReelle);
  const corps = await page.text();
  check("page /verification/reponse → 200 publique", page.status === 200, "status=" + page.status);
  check("page affiche la référence", corps.includes(reference), "");

  // Nettoyage complet
  if (repAvant) {
    await db.signatureConfigReponse.update({ where: { id: "signature-reponse" }, data: repAvant });
  } else {
    await db.signatureConfigReponse.deleteMany({ where: { id: "signature-reponse" } });
  }
  await db.demandeAdministrative.deleteMany({ where: { reference } });
  await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp(EMAIL, true) } });
  fs.rmSync("/tmp/task202qr", { recursive: true, force: true });
  console.log("(nettoyage : demande, config réponses et compte de test supprimés)");

  console.log(`\n== RÉSULTAT : ${OK} OK / ${KO} FAIL ==`);
  await db.$disconnect();
  process.exit(KO ? 1 : 0);
}

main().catch(async (e) => {
  console.error("ERREUR FATALE:", e);
  try {
    await db.demandeAdministrative.deleteMany({ where: { reference: "DEM-TEST-202QR" } });
    await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp(EMAIL, true) } });
  } catch {}
  await db.$disconnect();
  process.exit(2);
});
