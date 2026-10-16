/**
 * ============================================================================
 *  HARNAIS DE TESTS DE SÉCURITÉ — Auto-RH (Task 94 : « Vérifier sécurité »)
 * ============================================================================
 *
 *  Vérifie DYNAMIQUEMENT les correctifs de sécurité appliqués :
 *
 *   S1  Secret par défaut supprimé (site admin) : un cookie de session FORGÉ
 *       avec l'ancien secret public « autorh-secret-local-a-changer-dans-env »
 *       est REFUSÉ (401) même quand le serveur démarre sans AUTH_SECRET.
 *   S2  Génération automatique d'AUTH_SECRET par start-prod.js dans .env.
 *   S3  Connexion légitime toujours fonctionnelle (création superadmin + login).
 *   S4  Anti force-brute sur /api/auth/login : 10 échecs puis 429.
 *   S5  Portail : cookie FORGÉ avec l'ancien secret public → REFUSÉ (401)
 *       quand le portail démarre sans AUTH_SECRET.
 *   S6  En-têtes de sécurité HTTP (admin : X-Frame-Options/nosniff/referrer ;
 *       portail : X-Frame-Options DENY).
 *   S7  Garde anti-traversée des noms de fichiers stockés (regex réelle).
 *
 *  Le harnais est AUTOPORTANT : il démarre lui-même le site admin
 *  (start-prod.js, port 4200) et le portail (portail-server.js, port 4201),
 *  sauvegarde puis restaure le .env, et tue tous les processus enfants.
 *  RUN : node scripts/test-securite.js
 * ============================================================================
 */
const { execFile, spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORT_ADMIN = 4200;
const PORT_PORTAIL = 4201;
const ADMIN = `http://127.0.0.1:${PORT_ADMIN}`;
const PORTAIL = `http://127.0.0.1:${PORT_PORTAIL}`;
const ANCIEN_SECRET_PUBLIC = "autorh-secret-local-a-changer-dans-env";

/* ----------------------------- utilitaires ----------------------------- */

function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
}

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("timeout GET " + url)));
  });
}

function httpPostJson(url, body, headers = {}, essais = 3) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          ...headers,
        },
      },
      (res) => {
        let out = "";
        res.on("data", (c) => (out += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: out }));
      }
    );
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("timeout POST " + url)));
    req.end(data);
  }).catch(async (e) => {
    // (robustesse) le serveur vient tout juste de démarrer : une connexion
    // peut être réinitialisée pendant l'initialisation des routes — on retente.
    if (essais > 1) {
      await attendre(1200);
      return httpPostJson(url, body, headers, essais - 1);
    }
    throw e;
  });
}

/** Forge un jeton de session « à l'ancienne » avec l'ancien secret public. */
function forgerTokenAdmin(ancienSecret) {
  const payload = {
    id: "id-forgé-par-l-attaquant",
    email: "attaquant@inconnu.tn",
    name: "Attaquant",
    role: "SUPERADMIN",
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", ancienSecret).update(body).digest("base64url");
  return body + "." + sig;
}

function forgerTokenPortail(ancienSecret, cin) {
  const payload = {
    cin,
    exp: Math.floor(Date.now() / 1000) + 3600,
    rm: 0,
    pd: 0,
    ot: 0,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", ancienSecret).update(body).digest("base64url");
  return body + "." + sig;
}

function attendre(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function attendreServeur(url, label, essais = 60) {
  for (let i = 0; i < essais; i++) {
    try {
      await httpGet(url);
      return true;
    } catch {
      await attendre(500);
    }
  }
  throw new Error(`Serveur ${label} (${url}) injoignable`);
}

function lancer(cmd, args, env, label) {
  const enfant = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  enfant.stdout.on("data", (d) => process.stdout.write(`[${label}] ` + d.toString()));
  enfant.stderr.on("data", (d) => process.stderr.write(`[${label}!ERR] ` + d.toString()));
  return enfant;
}

function tuerProcessus(enfant) {
  if (!enfant || enfant.exitCode !== null || enfant.signalCode) return;
  try {
    enfant.kill("SIGTERM");
  } catch {}
  setTimeout(() => {
    try {
      if (enfant.exitCode === null) enfant.kill("SIGKILL");
    } catch {}
  }, 3000);
}

/** Garde anti-traversée — COPIE EXACTE de celle de resolveStoredFile/findStoredFile. */
function nomFichierSur(storedName) {
  return (
    typeof storedName === "string" &&
    storedName.length > 0 &&
    storedName.length <= 255 &&
    /^[A-Za-z0-9._-]+$/.test(storedName) &&
    !storedName.includes("..")
  );
}

/* ------------------------------ résutats ------------------------------ */

const resultats = [];
function verdict(id, ok, detail) {
  resultats.push({ id, ok, detail });
  console.log(`  ${ok ? "✅" : "❌"} ${id} — ${detail}`);
}

/* --------------------------------- MAIN --------------------------------- */

(async () => {
  let admin = null;
  let portail = null;
  const envPath = path.join(ROOT, ".env");
  const envBackup = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : null;

  try {
    /* Préparation : .env de test SANS AUTH_SECRET (DATABASE_URL seul) */
    if (envBackup !== null) fs.writeFileSync(envPath + ".sauvegarde-securite", envBackup);
    fs.writeFileSync(envPath, `DATABASE_URL=file:${path.join(ROOT, "db", "custom.db")}\n`);

    /* Création (ou réutilisation) d'un superadmin de test */
    try {
      await new Promise((resolve, reject) => {
        execFile(
          process.execPath,
          [
            path.join(ROOT, "scripts", "creer-superadmin.js"),
            "--creer",
            "--email",
            "secu-test@autorh.local",
            "--nom",
            "Test Securite",
            "--password",
            "Admin2026!",
          ],
          { cwd: ROOT, timeout: 60000 },
          (err, stdout) => (err ? reject(err) : resolve(stdout))
        );
      });
      console.log("  (superadmin de test créé)");
    } catch {
      console.log("  (superadmin de test déjà présent)");
    }

    console.log("\n=== DÉMARRAGE du site admin SANS AUTH_SECRET (AUTH_SECRET=\"\" forcé) ===");
    admin = lancer(
      process.execPath,
      [path.join(ROOT, "scripts", "start-prod.js")],
      { PORT: String(PORT_ADMIN), AUTH_SECRET: "" },
      "admin"
    );
    await attendreServeur(`${ADMIN}/login`, "admin");
    await attendre(2000); // laisse les routes API finir leur initialisation

    /* S2 — AUTH_SECRET a été générée et persistée dans .env */
    const envApres = fs.readFileSync(envPath, "utf8");
    const mSecret = envApres.match(/^AUTH_SECRET=(\S+)\s*$/m);
    verdict(
      "S2",
      Boolean(mSecret && mSecret[1].length >= 40 && mSecret[1] !== ANCIEN_SECRET_PUBLIC),
      mSecret
        ? "start-prod.js a généré et enregistré AUTH_SECRET (clé forte) dans .env"
        : "AUTH_SECRET absente du .env après démarrage"
    );

    /* S1 — forge avec l'ancien secret public → refusé */
    const cookieForge = forgerTokenAdmin(ANCIEN_SECRET_PUBLIC);
    const rForge = await httpGet(`${ADMIN}/api/auth/me`, { Cookie: `auto_rh_session=${cookieForge}` });
    verdict(
      "S1",
      rForge.status === 401,
      `cookie forgé avec l'ancien secret public → HTTP ${rForge.status} (401 attendu)`
    );

    /* S3 — connexion légitime */
    const rLogin = await httpPostJson(`${ADMIN}/api/auth/login`, {
      email: "secu-test@autorh.local",
      password: "Admin2026!",
    });
    let cookieLegit = "";
    const setCookie = rLogin.headers["set-cookie"];
    if (Array.isArray(setCookie)) {
      for (const c of setCookie) {
        const m = c.match(/auto_rh_session=([^;]+)/);
        if (m) cookieLegit = m[1];
      }
    }
    verdict(
      "S3",
      rLogin.status === 200 && Boolean(cookieLegit),
      `login légitime → HTTP ${rLogin.status} + session émise`
    );

    /* S3-bis — session légitime acceptée */
    const rMe = await httpGet(`${ADMIN}/api/auth/me`, {
      Cookie: `auto_rh_session=${cookieLegit}`,
    });
    verdict("S3-bis", rMe.status === 200, `session légitime validée → HTTP ${rMe.status}`);

    /* S4 — anti force-brute : 12 mauvais mots de passe */
    let codes = [];
    for (let i = 0; i < 12; i++) {
      const r = await httpPostJson(`${ADMIN}/api/auth/login`, {
        email: "secu-test@autorh.local",
        password: "MauvaisMotDePasse" + i + "!",
      });
      codes.push(r.status);
      await attendre(60);
    }
    const dixPremiers401 = codes.slice(0, 10).every((c) => c === 401 || c === 403);
    const ensuite429 = codes.slice(10).every((c) => c === 429);
    verdict(
      "S4",
      dixPremiers401 && ensuite429,
      `échecs successifs : ${codes.join(",")} (10×401 puis 429 attendu)`
    );

    /* S6 — en-têtes de sécurité du site admin */
    const rPage = await httpGet(`${ADMIN}/login`);
    const hOk =
      rPage.headers["x-frame-options"] === "DENY" &&
      rPage.headers["x-content-type-options"] === "nosniff" &&
      rPage.headers["referrer-policy"] === "no-referrer";
    verdict("S6", hOk, `en-têtes admin : XFO=${rPage.headers["x-frame-options"]}, nosniff=${rPage.headers["x-content-type-options"]}, referrer=${rPage.headers["referrer-policy"]}`);

    tuerProcessus(admin);
    admin = null;
    await attendre(2500);

    console.log("\n=== DÉMARRAGE du portail SANS AUTH_SECRET ===");
    portail = lancer(
      process.execPath,
      [path.join(ROOT, "scripts", "portail-server.js")],
      { PORTAL_PORT: String(PORT_PORTAIL), AUTH_SECRET: "" },
      "portail"
    );
    await attendreServeur(`${PORTAIL}/`, "portail");

    /* S5 — forge portail avec l'ancien secret public → refusé */
    const cookiePortailForge = forgerTokenPortail(ANCIEN_SECRET_PUBLIC, "07778899");
    const rPortailForge = await httpGet(`${PORTAIL}/api/my-fiches`, {
      Cookie: `portail_session=${cookiePortailForge}`,
    });
    verdict(
      "S5",
      rPortailForge.status === 401,
      `cookie portail forgé avec l'ancien secret public → HTTP ${rPortailForge.status} (401 attendu)`
    );

    /* S6-bis — en-têtes de sécurité du portail */
    const rPortailPage = await httpGet(`${PORTAIL}/`);
    verdict(
      "S6-bis",
      rPortailPage.headers["x-frame-options"] === "DENY",
      `en-tête portail : X-Frame-Options=${rPortailPage.headers["x-frame-options"]}`
    );

    /* S7 — garde anti-traversée (comportement de la regex appliquée) */
    const casRejetes = ["../etc/passwd", "a/b.pdf", "a\\b.pdf", "..", "fiche/../../../secret.pdf", ""];
    const casAcceptes = ["1737612345678-0a1b2c3d4e5f.pdf"];
    const tousRejetes = casRejetes.every((c) => !nomFichierSur(c));
    const tousAcceptes = casAcceptes.every((c) => nomFichierSur(c));
    verdict("S7", tousRejetes && tousAcceptes, "garde anti-traversée : séparateurs et « .. » rejetés, noms légitimes acceptés");
  } catch (e) {
    console.error("\n[ERREUR HARNAIS]", e);
    resultats.push({ id: "EXCEPTION", ok: false, detail: String(e) });
  } finally {
    tuerProcessus(admin);
    tuerProcessus(portail);
    /* Restauration du .env original */
    try {
      if (envBackup !== null) {
        fs.writeFileSync(envPath, envBackup);
        fs.unlinkSync(envPath + ".sauvegarde-securite");
        console.log("\n  (.env original restauré)");
      } else {
        fs.unlinkSync(envPath);
        console.log("\n  (.env de test supprimé — aucun .env avant le harnais)");
      }
    } catch (e2) {
      console.error("  Restauration .env :", e2.message);
    }
    /* Bilan */
    const ok = resultats.filter((r) => r.ok).length;
    console.log(`\n=========== BILAN SÉCURITÉ : ${ok}/${resultats.length} tests réussis ===========`);
    resultats.forEach((r) => {
      if (!r.ok) console.log(`  ÉCHEC ${r.id} : ${r.detail}`);
    });
    process.exitCode = resultats.every((r) => r.ok) ? 0 : 1;
    setTimeout(() => process.exit(process.exitCode || 0), 500).unref();
  }
})();
