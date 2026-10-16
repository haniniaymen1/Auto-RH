/**
 * ============================================================================
 *  SÉPARATION RH / CONFIGURATION SMTP — Auto-RH (Task 13)
 * ============================================================================
 *  Demande : « Vérifier que la section RH ne contient aucune configuration de
 *  messagerie (SMTP) et qu'elle est uniquement utilisée pour l'envoi des
 *  e-mails. »
 *
 *  Vérification bout-en-bout (server démarré réellement) :
 *   S1  Login RH → session + rôle RH
 *   S2  Login IT → session + rôle IT
 *   S3  IT enregistre la configuration SMTP → 200 (l'informatique configure)
 *   S4  IT lit la configuration → hôte/port/compte complets
 *   S5  RH lit la configuration → SEULEMENT « configuree » (aucun hôte, port,
 *       compte, expéditeur, aucun défaut de pré-remplissage)
 *   S6  RH enregistre la configuration → 403 REFUSÉ
 *   S7  RH e-mail de test SMTP → 403 REFUSÉ
 *   S8  RH crée un accès portail → 200 (le RH gère les accès)
 *   S9  RH « Envoyer l'e-mail » → 200 + message RÉEL capté par le serveur
 *       SMTP de capture (AUTH, destinataire, objet) — le RH UTILISE le
 *       service d'envoi, il ne le configure pas.
 *
 *  AUTOPORTANT : démarre le site admin (port 4200) + un serveur SMTP de
 *  capture (port 2526), crée les comptes de test RH/IT en base, puis
 *  nettoie tout (utilisateurs, serveurs) à la fin.
 *  RUN : node scripts/test-separation-rh-smtp.js
 * ============================================================================
 */
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORT_ADMIN = 4200;
const PORT_SMTP = 2526;
const ADMIN = `http://127.0.0.1:${PORT_ADMIN}`;

/* Jumelle JS du chiffrement de la base (User.email déterministe, name aléatoire) :
   les comptes de test doivent être écrits COMME L'APPLICATION les écrit,
   sinon le serveur (qui cherche l'email CHIFFRÉ) ne les trouve pas. */
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

const MDP_RH = "Rh2026!secret";
const MDP_IT = "It2026!secret";
const EMAIL_RH = "rh-test@autorh.local";
const EMAIL_IT = "it-test@autorh.local";

/** Hash identique à src/lib/auth.ts hashPassword (scrypt:salt:hash). */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

/* ---------------------- serveur SMTP de capture ---------------------- */
const AUTH_ATTENDU = Buffer.from("service_rh_mail:P@ieSage2026!").toString("base64");
const capture = { auth: false, mailFrom: null, rcptTos: [], data: null };

function serveurSmtp() {
  return new Promise((resolve) => {
    const srv = net.createServer((socket) => {
      let etape = 0;
      let tampon = "";
      const envoyer = (l) => socket.write(l + "\r\n");
      envoyer("220 capture.local ESMTP test-separation-rh");
      socket.on("data", (chunk) => {
        tampon += chunk.toString("utf8");
        let idx;
        while ((idx = tampon.indexOf("\r\n")) >= 0) {
          const ligne = tampon.slice(0, idx);
          tampon = tampon.slice(idx + 2);
          if (etape === 4) {
            if (ligne === ".") {
              etape = 5;
              envoyer("250 OK message accepté");
              socket.end();
            } else {
              capture.data = (capture.data || "") + ligne + "\n";
            }
            continue;
          }
          const cmd = ligne.toUpperCase();
          if (cmd.startsWith("EHLO") || cmd.startsWith("HELO")) {
            envoyer("250-capture.local");
            envoyer("250-AUTH LOGIN"); // LOGIN seulement : mécanisme vérifié par le captureur
            envoyer("250 OK");
          } else if (cmd.startsWith("AUTH LOGIN")) {
            envoyer("334 " + Buffer.from("Username:").toString("base64"));
            etape = 10;
          } else if (etape === 10) {
            capture.userB64 = ligne.trim();
            envoyer("334 " + Buffer.from("Password:").toString("base64"));
            etape = 11;
          } else if (etape === 11) {
            capture.passB64 = ligne.trim();
            capture.auth =
              capture.userB64 === Buffer.from("service_rh_mail").toString("base64") &&
              capture.passB64 === Buffer.from("P@ieSage2026!").toString("base64");
            envoyer(capture.auth ? "235 authentification réussie" : "535 échec authentification");
            etape = 0;
          } else if (cmd.startsWith("MAIL FROM:")) {
            capture.mailFrom = ligne.slice(10).trim().replace(/[<>]/g, "");
            envoyer("250 OK");
          } else if (cmd.startsWith("RCPT TO:")) {
            capture.rcptTos.push(ligne.slice(8).trim().replace(/[<>]/g, ""));
            envoyer("250 OK");
          } else if (cmd.startsWith("DATA")) {
            envoyer("354 finir par .");
            etape = 4;
          } else if (cmd.startsWith("QUIT")) {
            envoyer("221 au revoir");
            socket.end();
          } else {
            envoyer("250 OK");
          }
        }
      });
      socket.on("error", () => {});
    });
    srv.listen(PORT_SMTP, "127.0.0.1", () => resolve(srv));
  });
}

/** Extrait l'objet du message capté (Sujet: éventuellement encodé MIME-Q). */
function extraireSujet(dataBrute) {
  const m = dataBrute.match(/^Subject:\s*(.+?)\s*$/m);
  if (!m) return null;
  let s = m[1];
  const mQ = s.match(/=\?([^?]+)\?([QqBb])\?([^?]*)\?=/);
  if (mQ) {
    try {
      if (mQ[2].toLowerCase() === "q") {
        s = mQ[3].replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (_, h) =>
          Buffer.from(h, "hex").toString("utf8")
        );
      } else {
        s = Buffer.from(mQ[3], "base64").toString("utf8");
      }
    } catch {}
  }
  return s;
}

/* --------------------------- utilitaires HTTP --------------------------- */
function attendre(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("timeout GET " + url)));
  });
}

function httpRequete(method, url, body, headers = {}, essais = 3) {
  const tenter = () =>
    new Promise((resolve, reject) => {
      const data = body == null ? null : JSON.stringify(body);
      const u = new URL(url);
      const h = { ...headers };
      if (data != null) {
        h["Content-Type"] = "application/json";
        h["Content-Length"] = Buffer.byteLength(data);
      }
      const req = http.request(
        { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: h },
        (res) => {
          let out = "";
          res.on("data", (c) => (out += c));
          res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: out }));
        }
      );
      req.on("error", reject);
      req.setTimeout(30000, () => req.destroy(new Error("timeout " + method + " " + url)));
      if (data != null) req.write(data);
      req.end();
    });
  return tenter().catch(async (e) => {
    if (essais > 1) {
      await attendre(1200);
      return httpRequete(method, url, body, headers, essais - 1);
    }
    throw e;
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

/** Login : renvoie { status, cookie, role }. */
async function login(email, motDePasse) {
  const r = await httpRequete("POST", `${ADMIN}/api/auth/login`, { email, password: motDePasse });
  let cookie = "";
  const sc = r.headers["set-cookie"];
  if (Array.isArray(sc)) {
    for (const c of sc) {
      const m = c.match(/auto_rh_session=([^;]+)/);
      if (m) cookie = m[1];
    }
  }
  let role = "?";
  try {
    role = JSON.parse(r.body).user.role;
  } catch {}
  return { status: r.status, cookie, role };
}

/* ------------------------------ résultats ------------------------------ */
const resultats = [];

/** Purge robuste des comptes de test : cherche PARMI TOUS les utilisateurs
 *  ceux dont l'email (déchiffré via la jumelle JS) correspond — supprime
 *  aussi bien les lignes chiffrées que les vestiges en clair d'anciens runs. */
async function purgerUtilisateursTest(prisma) {
  const tous = await prisma.user.findMany();
  const ids = [];
  for (const u of tous) {
    const lisible = cryptoBd.dechiffrerObjet("User", u);
    if (lisible.email === EMAIL_RH || lisible.email === EMAIL_IT) ids.push(u.id);
  }
  if (ids.length) {
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
}

function verdict(id, ok, detail) {
  resultats.push({ id, ok });
  console.log(`  ${ok ? "✅" : "❌"} ${id} — ${detail}`);
}

/* --------------------------------- MAIN --------------------------------- */
(async () => {
  let admin = null;
  let smtpSrv = null;
  let prisma = null;
  try {
    /* --- Comptes de test RH/IT (créés comme l'application : champs chiffrés) --- */
    const { PrismaClient } = require("@prisma/client");
    prisma = new PrismaClient();
    await purgerUtilisateursTest(prisma); // idempotence (runs précédents, clair OU chiffré)
    await prisma.user.createMany({
      data: [
        cryptoBd.chiffrerObjet("User", {
          email: EMAIL_RH,
          name: "RH Test (Task 13)",
          passwordHash: hashPassword(MDP_RH),
          role: "RH",
          isActive: true,
          passwordChangedAt: new Date(), // pas de changement forcé à la connexion
        }),
        cryptoBd.chiffrerObjet("User", {
          email: EMAIL_IT,
          name: "IT Test (Task 13)",
          passwordHash: hashPassword(MDP_IT),
          role: "IT",
          isActive: true,
          passwordChangedAt: new Date(),
        }),
      ],
    });
    console.log("=== Comptes de test créés : " + EMAIL_RH + " (RH) / " + EMAIL_IT + " (IT) ===");

    console.log("=== Démarrage du serveur SMTP de capture (port " + PORT_SMTP + ") ===");
    smtpSrv = await serveurSmtp();

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

    /* S1 — login RH */
    const rh = await login(EMAIL_RH, MDP_RH);
    verdict("S1", rh.status === 200 && Boolean(rh.cookie) && rh.role === "RH",
      `login RH → ${rh.status}, rôle=${rh.role}, cookie httpOnly`);

    /* S2 — login IT */
    const it = await login(EMAIL_IT, MDP_IT);
    verdict("S2", it.status === 200 && Boolean(it.cookie) && it.role === "IT",
      `login IT → ${it.status}, rôle=${it.role}, cookie httpOnly`);

    /* S3 — IT enregistre la configuration SMTP (usage légitime de l'informatique) */
    const rPutIt = await httpRequete(
      "PUT",
      `${ADMIN}/api/mail-config`,
      {
        preset: "personnalise",
        host: "127.0.0.1",
        port: PORT_SMTP,
        username: "service_rh_mail",
        password: "P@ieSage2026!",
        from: "auto-rh@monentreprise.tn",
        portailUrl: "http://192.168.1.10:4001",
      },
      { Cookie: `auto_rh_session=${it.cookie}` }
    );
    verdict("S3", rPutIt.status === 200,
      `IT PUT /api/mail-config → ${rPutIt.status} (200 attendu : l'informatique configure)`);
    if (rPutIt.status !== 200) {
      console.log("  détail:", rPutIt.body.slice(0, 300));
    }

    /* S4 — IT lit la configuration complète */
    const rGetIt = await httpRequete("GET", `${ADMIN}/api/mail-config`, null, {
      Cookie: `auto_rh_session=${it.cookie}`,
    });
    const itComplet =
      rGetIt.body.includes('"host"') &&
      rGetIt.body.includes('"port"') &&
      rGetIt.body.includes('"defauts"');
    verdict("S4", rGetIt.status === 200 && itComplet,
      `IT GET /api/mail-config → ${rGetIt.status}, hôte/port/défauts présents (config complète)`);

    /* S5 — RH lit la configuration : AUCUN paramètre SMTP divulgué */
    const rGetRh = await httpRequete("GET", `${ADMIN}/api/mail-config`, null, {
      Cookie: `auto_rh_session=${rh.cookie}`,
    });
    const corps = rGetRh.body;
    const aucuneFuite =
      !/"host"\s*:/.test(corps) &&
      !/"port"\s*:/.test(corps) &&
      !/"username"\s*:/.test(corps) &&
      !/"from"\s*:/.test(corps) &&
      !/"defauts"\s*:/.test(corps) &&
      !/"hasPassword"\s*:/.test(corps) &&
      !corps.includes("auto-rh@monentreprise.tn") &&
      !corps.includes("P@ieSage2026!");
    verdict("S5", rGetRh.status === 200 && corps.includes('"configuree"') && aucuneFuite,
      `RH GET /api/mail-config → ${rGetRh.status}, corps = ${corps.slice(0, 80)} (configuree SEUL, aucun paramètre)`);

    /* S6 — RH enregistre la configuration : REFUSÉ */
    const rPutRh = await httpRequete(
      "PUT",
      `${ADMIN}/api/mail-config`,
      { host: "smtp.pirate.tn", port: 587, username: "pirate", password: "Pirate2026!", from: "pirate@pirate.tn" },
      { Cookie: `auto_rh_session=${rh.cookie}` }
    );
    verdict("S6", rPutRh.status === 403,
      `RH PUT /api/mail-config → ${rPutRh.status} (403 attendu : le RH ne configure PAS)`);

    /* S7 — RH e-mail de test (diagnostic) : REFUSÉ */
    const rTestRh = await httpRequete(
      "POST",
      `${ADMIN}/api/mail-config`,
      { action: "test", dest: "pirate@pirate.tn" },
      { Cookie: `auto_rh_session=${rh.cookie}` }
    );
    verdict("S7", rTestRh.status === 403,
      `RH POST test SMTP → ${rTestRh.status} (403 attendu : test = outil informatique)`);

    /* S8 — RH crée un accès portail (usage légitime de la section RH) */
    const rCreate = await httpRequete(
      "POST",
      `${ADMIN}/api/portal-access`,
      { action: "create", cin: "123456789013" },
      { Cookie: `auto_rh_session=${rh.cookie}` }
    );
    let accessId = null;
    try {
      accessId = JSON.parse(rCreate.body).access.id;
    } catch {}
    verdict("S8", rCreate.status === 200 && Boolean(accessId),
      `RH création accès portail → ${rCreate.status} (le RH gère les accès)`);

    /* S9 — RH « Envoyer l'e-mail » : l'ENVOI fonctionne (usage du service) */
    const rSend = await httpRequete(
      "POST",
      `${ADMIN}/api/portal-access`,
      { action: "send-mail", id: accessId, dest: "employe@monentreprise.tn" },
      { Cookie: `auto_rh_session=${rh.cookie}` }
    );
    await attendre(900); // laisse le serveur SMTP finir de capter
    const sujet = capture.data ? extraireSujet(capture.data) : null;
    const envoiOk =
      rSend.status === 200 &&
      capture.auth === true &&
      capture.rcptTos.includes("employe@monentreprise.tn") &&
      Boolean(sujet);
    verdict("S9", envoiOk,
      `RH envoi e-mail d'accès → ${rSend.status} | AUTH=${capture.auth} | Dest=${capture.rcptTos.join(",")} | Objet="${sujet ?? "—"}"`);
    if (rSend.status !== 200) {
      console.log("  détail:", rSend.body.slice(0, 300));
    }
  } catch (e) {
    console.error("\n[ERREUR HARNAIS]", e);
    resultats.push({ id: "EXCEPTION", ok: false });
  } finally {
    /* Nettoyage : serveurs + comptes de test */
    if (prisma) {
      try {
        await purgerUtilisateursTest(prisma);
        await prisma.$disconnect();
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
    if (smtpSrv) {
      try {
        smtpSrv.close();
      } catch {}
    }
    const ok = resultats.filter((r) => r.ok).length;
    console.log(`\n=========== BILAN SÉPARATION RH/SMTP : ${ok}/${resultats.length} réussis ===========`);
    resultats.forEach((r) => {
      if (!r.ok) console.log(`  ÉCHEC ${r.id}`);
    });
    setTimeout(() => process.exit(ok === resultats.length ? 0 : 1), 500).unref();
  }
})();
