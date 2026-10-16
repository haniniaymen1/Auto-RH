/**
 * ============================================================================
 *  APERÇU DES FICHES : « IMAGE CASSÉE » DANS LA VISIONNEUSE — Auto-RH
 *  (Task 15bis)
 * ============================================================================
 *  Demande utilisateur : la visionneuse affiche une ICÔNE D'IMAGE CASSÉE pour
 *  « Bulletin_de_Paie_….png » (période 01/08/26 → 31/08/26, CIN •••934).
 *
 *  CAUSES POSSIBLES couvertes par ce harnais (le fichier existe et la session
 *  est valide — l'import avait réussi, l'OCR avait trouvé CIN + période) :
 *    F1  Nominal         : PNG chiffré avec la clé ACTUELLE → servi tel quel,
 *                          octets IDENTIQUES, type image/png.
 *    F2  Mauvais étiquetage : contenu PDF stocké sous un nom « .png » → AVANT
 *                          le correctif le navigateur recevait image/png et
 *                          affichait l'icône cassée ; APRÈS, le type est
 *                          déduit des octets (application/pdf) → s'affiche.
 *    F3  Fichier VIDE    : 0 octet sur le disque (import interrompu :
 *                          antivirus, disque plein, synchronisation) →
 *                          message EXPLICITE « fichier vide » (au lieu d'une
 *                          image cassée muette).
 *    F4  Clé différente  : PNG chiffré avec une AUTRE clé (AUTH_SECRET /
 *                          AUTO_RH_STORAGE_KEY modifiée dans .env après
 *                          l'import) → message EXPLICITE « clé de
 *                          chiffrement » (au lieu du générique « introuvable »).
 *    F5  Historique      : PNG ancien NON chiffré (avant Task 21) → toujours
 *                          servi tel quel (compatibilité conservée).
 *    F6  TRONQUÉ (Task   : signature PNG valide mais données coupées avant
 *        15bis-2)          IEND → AVANT : servi image/png → icône cassée
 *                          MUETTE ; APRÈS : 422 avec cause exacte.
 *    F7  CORROMPU (Task  : octets des données IDAT abîmés (CRC invalide +
 *        15bis-2)          décompression impossible) → 422 explicite.
 *    F8  Inconnu (Task   : extension .png mais octets ni image ni PDF →
 *        15bis-2)          422 explicite (AVANT : servi image/png → icône
 *                          cassée muette).
 *
 *  AUTOPORTANT : démarre le site admin (port 4201), crée un compte IT de
 *  test, insère directement en base les fiches de test + leurs fichiers
 *  (même format de chiffrement que l'application), puis nettoie tout.
 *  RUN : node scripts/test-fiches-image.js
 * ============================================================================
 */
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORT_ADMIN = 4201;
const ADMIN = `http://127.0.0.1:${PORT_ADMIN}`;
const STORAGE = path.join(ROOT, "storage", "payslips");

/* Jumelle JS du chiffrement de la base (User.email déterministe). */
const cryptoBd = require("./lib-crypto-bd.js");

/* ------------- charge .env EN FORCE (immunité aux variables résiduelles) ------------- */
(function chargerEnv() {
  const fichier = path.join(ROOT, ".env");
  if (!fs.existsSync(fichier)) return;
  for (const ligne of fs.readFileSync(fichier, "utf8").split(/\r?\n/)) {
    const m = ligne.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
})();

const MDP_IT = "It2026!secret";
const EMAIL_IT = "it-fiches-test@autorh.local";

/** Hash identique à src/lib/auth.ts hashPassword (scrypt:salt:hash). */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

/* ------------- même chiffrement de stockage que src/lib/storage-crypto.ts ------------- */
const MAGIC = Buffer.from("PAIESAGE1", "utf8");
const NONCE_LEN = 12;
const TAG_LEN = 16;
const SALT = "autorh-storage-v1";

function keyMaterial() {
  return (
    process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY ||
    process.env.AUTH_SECRET ||
    "autorh-storage-local-a-changer-dans-env"
  );
}
function chiffrer(buf, materiel) {
  const cle = crypto.scryptSync(materiel ?? keyMaterial(), SALT, 32);
  const nonce = crypto.randomBytes(NONCE_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", cle, nonce);
  const ct = Buffer.concat([cipher.update(buf), cipher.final()]);
  return Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), ct]);
}

/* PNG 1×1 transparent (signature 89504e47 — valide, décodable par tout navigateur). */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);
/* Mini contenu PDF valide (signature %PDF-). */
const PDF_MIN = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
  "utf8"
);

/* --------------------------- utilitaires HTTP --------------------------- */
function attendre(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          buffer: Buffer.concat(chunks),
          body: Buffer.concat(chunks).toString("utf8"),
        })
      );
    });
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("timeout GET " + url)));
  });
}

async function attendreServeur(url, essais = 60) {
  for (let i = 0; i < essais; i++) {
    try {
      await httpGet(url);
      return;
    } catch {
      await attendre(500);
    }
  }
  throw new Error("Serveur injoignable : " + url);
}

/** Login : renvoie le cookie de session. */
async function login(email, motDePasse) {
  const data = JSON.stringify({ email, password: motDePasse });
  return new Promise((resolve, reject) => {
    const u = new URL(ADMIN + "/api/auth/login");
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let out = "";
        res.on("data", (c) => (out += c));
        res.on("end", () => {
          let cookie = "";
          const sc = res.headers["set-cookie"];
          if (Array.isArray(sc)) {
            for (const c of sc) {
              const m = c.match(/auto_rh_session=([^;]+)/);
              if (m) cookie = m[1];
            }
          }
          resolve({ status: res.statusCode, cookie, body: out });
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("timeout login")));
    req.write(data);
    req.end();
  });
}

/* ------------------------------ résultats ------------------------------ */
const resultats = [];

function verdict(id, ok, detail) {
  resultats.push({ id, ok });
  console.log(`  ${ok ? "✅" : "❌"} ${id} — ${detail}`);
}

/** Insère une fiche de test + son fichier sur disque. Renvoie l'id. */
async function creerFiche(prisma, { fileName, storedName, buffer }) {
  fs.mkdirSync(STORAGE, { recursive: true });
  fs.writeFileSync(path.join(STORAGE, storedName), buffer);
  const rec = await prisma.payslip.create({
    data: {
      fileName,
      storedName,
      fileSize: buffer.length,
      content: "FICHE TEST HARNAIS CIN 123456789099",
      normalizedContent: "FICHETESTHARNAISCIN123456789099",
      cin: "123456789099",
      employeeName: "Harnais Test",
      period: "du 01/08/26 au 31/08/26",
      pageNumber: 1,
    },
  });
  return rec.id;
}

/* --------------------------------- MAIN --------------------------------- */
(async () => {
  let admin = null;
  let prisma = null;
  const fichesCrees = [];
  const fichiersCrees = [];
  try {
    /* --- Compte IT de test --- */
    const { PrismaClient } = require("@prisma/client");
    prisma = new PrismaClient();
    const tous = await prisma.user.findMany();
    const aPurger = [];
    for (const u of tous) {
      const lisible = cryptoBd.dechiffrerObjet("User", u);
      if (lisible.email === EMAIL_IT) aPurger.push(u.id);
    }
    if (aPurger.length) await prisma.user.deleteMany({ where: { id: { in: aPurger } } });
    await prisma.user.createMany({
      data: [
        cryptoBd.chiffrerObjet("User", {
          email: EMAIL_IT,
          name: "IT Fiches Test (Task 15bis)",
          passwordHash: hashPassword(MDP_IT),
          role: "IT",
          isActive: true,
          passwordChangedAt: new Date(),
        }),
      ],
    });

    console.log("=== Démarrage du site admin (port " + PORT_ADMIN + ") ===");
    admin = spawn(
      process.execPath,
      [path.join(ROOT, "scripts", "start-prod.js")],
      {
        cwd: ROOT,
        env: { ...process.env, PORT: String(PORT_ADMIN) },
        stdio: ["ignore", "ignore", "ignore"],
      }
    );
    await attendreServeur(`${ADMIN}/login`);
    await attendre(1500);

    const it = await login(EMAIL_IT, MDP_IT);
    if (it.status !== 200 || !it.cookie) throw new Error("Login IT impossible : " + it.status);
    const auth = { Cookie: `auto_rh_session=${it.cookie}` };
    console.log("=== Login IT OK — création des 5 fiches de test ===");

    /* F1 — nominal : PNG chiffré avec la clé ACTUELLE */
    const nomF1 = `harnais-${Date.now()}-f1.png`;
    fichiersCrees.push(nomF1);
    const idF1 = await creerFiche(prisma, {
      fileName: "Bulletin_de_Paie_Employe_Test.png",
      storedName: nomF1,
      buffer: chiffrer(PNG_1X1),
    });
    fichesCrees.push(idF1);

    /* F2 — mauvais étiquetage : contenu PDF sous un nom « .png » (non chiffré) */
    const nomF2 = `harnais-${Date.now()}-f2.png`;
    fichiersCrees.push(nomF2);
    const idF2 = await creerFiche(prisma, {
      fileName: "Bulletin_Mal_Etiquete.png",
      storedName: nomF2,
      buffer: PDF_MIN,
    });
    fichesCrees.push(idF2);

    /* F3 — fichier VIDE (0 octet) */
    const nomF3 = `harnais-${Date.now()}-f3.png`;
    fichiersCrees.push(nomF3);
    const idF3 = await creerFiche(prisma, {
      fileName: "Bulletin_Vide.png",
      storedName: nomF3,
      buffer: Buffer.alloc(0),
    });
    fichesCrees.push(idF3);

    /* F4 — PNG chiffré avec une AUTRE clé (clé modifiée après import) */
    const nomF4 = `harnais-${Date.now()}-f4.png`;
    fichiersCrees.push(nomF4);
    const idF4 = await creerFiche(prisma, {
      fileName: "Bulletin_Ancienne_Cle.png",
      storedName: nomF4,
      buffer: chiffrer(PNG_1X1, "cle-erronee-harnais"),
    });
    fichesCrees.push(idF4);

    /* F5 — historique : PNG ancien NON chiffré */
    const nomF5 = `harnais-${Date.now()}-f5.png`;
    fichiersCrees.push(nomF5);
    const idF5 = await creerFiche(prisma, {
      fileName: "Bulletin_Historique.png",
      storedName: nomF5,
      buffer: PNG_1X1,
    });
    fichesCrees.push(idF5);

    /* F6 — (Task 15bis-2) PNG TRONQUÉ : signature valide, données coupées
       avant la fin (au milieu des données IDAT, IEND absent) — copie ou
       import interrompu. C'est la cause résiduelle de l'icône cassée. */
    const nomF6 = `harnais-${Date.now()}-f6.png`;
    fichiersCrees.push(nomF6);
    const idF6 = await creerFiche(prisma, {
      fileName: "Bulletin_Tronque.png",
      storedName: nomF6,
      buffer: PNG_1X1.subarray(0, 50), // coupe EN PLEIN MILIEU des données IDAT
    });
    fichesCrees.push(idF6);

    /* F7 — (Task 15bis-2) PNG CORROMPU : octet des données IDAT abîmé
       (CRC invalide + décompression zlib impossible). */
    const nomF7 = `harnais-${Date.now()}-f7.png`;
    fichiersCrees.push(nomF7);
    const PNG_CORROMPU = Buffer.from(PNG_1X1);
    PNG_CORROMPU[45] ^= 0xff; // octet au milieu des données IDAT (octets 41–53)
    const idF7 = await creerFiche(prisma, {
      fileName: "Bulletin_Corrompu.png",
      storedName: nomF7,
      buffer: PNG_CORROMPU,
    });
    fichesCrees.push(idF7);

    /* F8 — (Task 15bis-2) extension .png mais contenu inconnu (ni image
       ni PDF) : servi avant en image/png → icône cassée muette. */
    const nomF8 = `harnais-${Date.now()}-f8.png`;
    fichiersCrees.push(nomF8);
    const idF8 = await creerFiche(prisma, {
      fileName: "Bulletin_Inconnu.png",
      storedName: nomF8,
      buffer: Buffer.from(
        "CECI N'EST NI UNE IMAGE NI UN PDF — OCTETS DE FORMAT INCONNU",
        "utf8"
      ),
    });
    fichesCrees.push(idF8);

    /* F1 — vérification nominale */
    const r1 = await httpGet(`${ADMIN}/api/payslips/${idF1}/file`, auth);
    verdict(
      "F1",
      r1.status === 200 &&
        (r1.headers["content-type"] || "").includes("image/png") &&
        r1.buffer.equals(PNG_1X1),
      `PNG nominal chiffré → ${r1.status}, type=${r1.headers["content-type"]}, octets identiques=${r1.buffer.equals(PNG_1X1)}`
    );

    /* F2 — le CONTENU (PDF) prime sur l'extension (.png) : plus d'image cassée */
    const r2 = await httpGet(`${ADMIN}/api/payslips/${idF2}/file`, auth);
    verdict(
      "F2",
      r2.status === 200 && (r2.headers["content-type"] || "").includes("application/pdf"),
      `Contenu PDF sous nom « .png » → ${r2.status}, type servi=${r2.headers["content-type"]} (AVANT : image/png → icône cassée)`
    );

    /* F3 — fichier vide : message EXPLICITE */
    const r3 = await httpGet(`${ADMIN}/api/payslips/${idF3}/file`, auth);
    const msg3 = (() => {
      try {
        return JSON.parse(r3.body).error || "";
      } catch {
        return "";
      }
    })();
    verdict(
      "F3",
      r3.status === 404 && msg3.includes("vide"),
      `Fichier 0 octet → ${r3.status}, message explicite « ${msg3.slice(0, 60)}… »`
    );

    /* F4 — clé différente : message EXPLICITE (au lieu du générique) */
    const r4 = await httpGet(`${ADMIN}/api/payslips/${idF4}/file`, auth);
    const msg4 = (() => {
      try {
        return JSON.parse(r4.body).error || "";
      } catch {
        return "";
      }
    })();
    verdict(
      "F4",
      r4.status === 500 && msg4.includes("clé de chiffrement"),
      `PNG chiffré avec une autre clé → ${r4.status}, message explicite « ${msg4.slice(0, 60)}… »`
    );

    /* F5 — compatibilité historique : PNG non chiffré toujours servi */
    const r5 = await httpGet(`${ADMIN}/api/payslips/${idF5}/file`, auth);
    verdict(
      "F5",
      r5.status === 200 &&
        (r5.headers["content-type"] || "").includes("image/png") &&
        r5.buffer.equals(PNG_1X1),
      `PNG historique non chiffré → ${r5.status}, type=${r5.headers["content-type"]}, octets identiques=${r5.buffer.equals(PNG_1X1)}`
    );

    /* F6 — (Task 15bis-2) PNG tronqué : message EXPLICITE (statut 422)
       au lieu des octets cassés servis en image/png (icône muette). */
    const r6 = await httpGet(`${ADMIN}/api/payslips/${idF6}/file`, auth);
    const msg6 = (() => {
      try {
        return JSON.parse(r6.body).error || "";
      } catch {
        return "";
      }
    })();
    verdict(
      "F6",
      r6.status === 422 && msg6.includes("tronqué"),
      `PNG tronqué (IEND absent) → ${r6.status}, message explicite « ${msg6.slice(0, 70)}… »`
    );

    /* F7 — (Task 15bis-2) PNG corrompu (IDAT indéchiffrables) : 422 explicite. */
    const r7 = await httpGet(`${ADMIN}/api/payslips/${idF7}/file`, auth);
    const msg7 = (() => {
      try {
        return JSON.parse(r7.body).error || "";
      } catch {
        return "";
      }
    })();
    verdict(
      "F7",
      r7.status === 422 && msg7.includes("corrompue"),
      `PNG corrompu (IDAT indéchiffrables) → ${r7.status}, message explicite « ${msg7.slice(0, 70)}… »`
    );

    /* F8 — (Task 15bis-2) contenu inconnu sous extension .png : 422 explicite. */
    const r8 = await httpGet(`${ADMIN}/api/payslips/${idF8}/file`, auth);
    const msg8 = (() => {
      try {
        return JSON.parse(r8.body).error || "";
      } catch {
        return "";
      }
    })();
    verdict(
      "F8",
      r8.status === 422 && msg8.includes("NI une image valide"),
      `Contenu inconnu sous nom « .png » → ${r8.status}, message explicite`
    );
  } catch (e) {
    console.error("\n[ERREUR HARNAIS]", e);
    resultats.push({ id: "EXCEPTION", ok: false });
  } finally {
    /* Nettoyage : fiches de test + fichiers + compte IT + serveur */
    if (prisma) {
      try {
        if (fichesCrees.length) {
          await prisma.payslip.deleteMany({ where: { id: { in: fichesCrees } } });
        }
        const tous = await prisma.user.findMany();
        const aPurger = [];
        for (const u of tous) {
          const lisible = cryptoBd.dechiffrerObjet("User", u);
          if (lisible.email === EMAIL_IT) aPurger.push(u.id);
        }
        if (aPurger.length) await prisma.user.deleteMany({ where: { id: { in: aPurger } } });
        await prisma.$disconnect();
      } catch {}
    }
    for (const nom of fichiersCrees) {
      try {
        fs.unlinkSync(path.join(STORAGE, nom));
      } catch {}
    }
    if (admin) {
      try {
        admin.kill("SIGTERM");
      } catch {}
      setTimeout(() => {
        try {
          admin.kill("SIGKILL");
        } catch {}
      }, 3000).unref();
    }
    const ok = resultats.filter((r) => r.ok).length;
    console.log(`\n=========== BILAN APERÇU FICHES : ${ok}/${resultats.length} réussis ===========`);
    resultats.forEach((r) => {
      if (!r.ok) console.log(`  ÉCHEC ${r.id}`);
    });
    setTimeout(() => process.exit(ok === resultats.length ? 0 : 1), 500).unref();
  }
})();
