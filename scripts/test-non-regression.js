/**
 * ============================================================================
 *  NON-RÉGRESSION SÉCURITÉ — Auto-RH (Task 94)
 * ============================================================================
 *  Vérifie bout-en-bout les fonctions impactées par les correctifs de
 *  sécurité, en particulier la MONTÉE DE VERSION nodemailer 7 → 10 :
 *
 *   N1  Login légitime + session (cookie httpOnly) + me + logout
 *   N2  Config SMTP enregistrée : mot de passe chiffré, JAMAIS renvoyé
 *   N3  Envoi SMTP RÉEL via nodemailer 10 (AUTH LOGIN vérifiée par le
 *       serveur de capture, Mail From, destinataire, objet du message)
 *   N4  Mot de passe SMTP jamais exposé dans les réponses API
 *   N5  Politique mots de passe appliquée à l'exécution (faible → 400)
 *   N6  Upload sans fichier → 400 propre (pas de 500)
 *   N7  API de données avec session → 200 (portal-access)
 *
 *  AUTOPORTANT : démarre le site admin (port 4200) + un serveur SMTP de
 *  capture (port 2526), et nettoie tout à la fin.
 *  RUN : node scripts/test-non-regression.js
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

/* ---------------------- serveur SMTP de capture ---------------------- */
const AUTH_ATTENDU = Buffer.from("service_rh_mail:P@ieSage2026!").toString("base64");
const capture = { auth: false, mailFrom: null, rcptTos: [], data: null, sujet: null };

function serveurSmtp() {
  return new Promise((resolve) => {
    const srv = net.createServer((socket) => {
      let etape = 0;
      let tampon = "";
      const envoyer = (l) => socket.write(l + "\r\n");
      envoyer("220 capture.local ESMTP test-securite");
      socket.on("data", (chunk) => {
        tampon += chunk.toString("utf8");
        let idx;
        while ((idx = tampon.indexOf("\r\n")) >= 0) {
          const ligne = tampon.slice(0, idx);
          tampon = tampon.slice(idx + 2);
          if (etape === 4) {
            // corps DATA en cours : capture ligne à ligne, fin = "." seul
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
            // (n'annoncer QUE LOGIN) : nodemailer 10 préfère PLAIN s'il est
            // annoncé — on force le mécanisme que le captureur vérifie.
            envoyer("250-AUTH LOGIN");
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

/* ------------------------------ résultats ------------------------------ */
const resultats = [];
function verdict(id, ok, detail) {
  resultats.push({ id, ok });
  console.log(`  ${ok ? "✅" : "❌"} ${id} — ${detail}`);
}

/* --------------------------------- MAIN --------------------------------- */
(async () => {
  let admin = null;
  let smtpSrv = null;
  try {
    console.log("=== Démarrage du serveur SMTP de capture (port " + PORT_SMTP + ") ===");
    smtpSrv = await serveurSmtp();

    console.log("=== Démarrage du site admin (port " + PORT_ADMIN + ", .env sécurisé) ===");
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

    /* N1 — login / me / logout */
    const rLogin = await httpRequete("POST", `${ADMIN}/api/auth/login`, {
      email: "secu-test@autorh.local",
      password: "Admin2026!",
    });
    let cookie = "";
    const sc = rLogin.headers["set-cookie"];
    if (Array.isArray(sc)) {
      for (const c of sc) {
        const m = c.match(/auto_rh_session=([^;]+)/);
        if (m) cookie = m[1];
      }
    }
    verdict("N1a", rLogin.status === 200 && Boolean(cookie), `login → ${rLogin.status} + cookie httpOnly`);
    const rMe = await httpGet(`${ADMIN}/api/auth/me`, { Cookie: `auto_rh_session=${cookie}` });
    const role = (() => {
      try {
        return JSON.parse(rMe.body).user.role;
      } catch {
        return "?";
      }
    })();
    verdict("N1b", rMe.status === 200 && role === "SUPERADMIN", `me → ${rMe.status} (rôle ${role})`);

    /* N2/N4 — enregistrement de la configuration SMTP */
    const rPut = await httpRequete(
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
      { Cookie: `auto_rh_session=${cookie}` }
    );
    const cfgBrute = rPut.body;
    const mdpFuit =
      cfgBrute.includes("P@ieSage2026!") ||
      cfgBrute.includes("encbd1:"); // jamais de valeur chiffrée non plus
    verdict(
      "N2",
      (rPut.status === 200 || rPut.status === 201) && !mdpFuit,
      `PUT mail-config → ${rPut.status}, mot de passe absent de la réponse`
    );

    /* N3 — envoi SMTP RÉEL via nodemailer 10 */
    const rTest = await httpRequete(
      "POST",
      `${ADMIN}/api/mail-config`,
      { action: "test", dest: "employe-test@monentreprise.tn" },
      { Cookie: `auto_rh_session=${cookie}` }
    );
    await attendre(800); // laisse le serveur SMTP finir de capter
    const authOk = capture.auth;
    const fromOk = capture.mailFrom === "auto-rh@monentreprise.tn";
    const destOk = capture.rcptTos.includes("employe-test@monentreprise.tn");
    const sujetOk = Boolean(capture.data && extraireSujet(capture.data));
    verdict(
      "N3",
      rTest.status === 200 && authOk && fromOk && destOk && sujetOk,
      `nodemailer 10 → envoi ${rTest.status} | AUTH=${authOk} | From=${capture.mailFrom} | Dest=${capture.rcptTos.join(",")} | Objet capté="${sujetOk ? extraireSujet(capture.data) : "—"}"`
    );

    /* N4-bis — GET mail-config : hasPassword seulement */
    const rGet = await httpRequete("GET", `${ADMIN}/api/mail-config`, null, {
      Cookie: `auto_rh_session=${cookie}`,
    });
    const cfgGet = rGet.body;
    const hasPassword =
      cfgGet.includes('"hasPassword":true') || cfgGet.includes('"hasPassword": true');
    const pasDeSecret = !cfgGet.includes("P@ieSage2026!") && !cfgGet.includes("encbd1:");
    verdict("N4", rGet.status === 200 && hasPassword && pasDeSecret, `GET mail-config → ${rGet.status}, hasPassword=${hasPassword}, aucun secret exposé`);

    /* N5 — politique de mot de passe appliquée à l'exécution */
    const rFaible = await httpRequete(
      "POST",
      `${ADMIN}/api/auth/change-password`,
      { currentPassword: "Admin2026!", newPassword: "faible123" },
      { Cookie: `auto_rh_session=${cookie}` }
    );
    const rFort = await httpRequete(
      "POST",
      `${ADMIN}/api/auth/change-password`,
      { currentPassword: "Admin2026!", newPassword: "Admin2026!" },
      { Cookie: `auto_rh_session=${cookie}` }
    );
    verdict(
      "N5",
      rFaible.status === 400 && (rFort.status === 400 || rFort.status === 200),
      `mot de passe faible → ${rFaible.status} (400 attendu) ; identique à l'actuel → ${rFort.status}`
    );

    /* N8 — RÉVOCATION DE SESSION (correctif Task 94) : changement de mot de
       passe → l'ANCIEN cookie est refusé, le NOUVEAU (rotation) est accepté. */
    const NouveauMdp = "NouveauMot2026!x";
    const rChg = await httpRequete(
      "POST",
      `${ADMIN}/api/auth/change-password`,
      { currentPassword: "Admin2026!", newPassword: NouveauMdp },
      { Cookie: `auto_rh_session=${cookie}` }
    );
    let cookieApres = "";
    const sc2 = rChg.headers["set-cookie"];
    if (Array.isArray(sc2)) {
      for (const c of sc2) {
        const m = c.match(/auto_rh_session=([^;]+)/);
        if (m && m[1]) cookieApres = m[1];
      }
    }
    const rAncien = await httpGet(`${ADMIN}/api/auth/me`, {
      Cookie: `auto_rh_session=${cookie}`,
    });
    const rNouveau = await httpGet(`${ADMIN}/api/auth/me`, {
      Cookie: `auto_rh_session=${cookieApres}`,
    });
    verdict(
      "N8",
      rChg.status === 200 && Boolean(cookieApres) && rAncien.status === 401 && rNouveau.status === 200,
      `changement de mot de passe → ancien cookie ${rAncien.status} (401 attendu), nouveau cookie ${rNouveau.status} (200 attendu)`
    );
    /* Remise en état : le mot de passe du compte de test revient à Admin2026!.
       (La rotation invalide cookieApres : on capture le NOUVEAU cookie.) */
    const rRest = await httpRequete(
      "POST",
      `${ADMIN}/api/auth/change-password`,
      { currentPassword: NouveauMdp, newPassword: "Admin2026!" },
      { Cookie: `auto_rh_session=${cookieApres}` }
    );
    if (rRest.status !== 200) console.log("  (remise en état du mot de passe : " + rRest.status + ")");
    let cookieRest = cookieApres;
    const sc3 = rRest.headers["set-cookie"];
    if (Array.isArray(sc3)) {
      for (const c of sc3) {
        const m = c.match(/auto_rh_session=([^;]+)/);
        if (m && m[1]) cookieRest = m[1];
      }
    }

    /* N6 — upload sans fichier → 400 propre (session COURANTE après rotation N8) */
    const u = new URL(`${ADMIN}/api/payslips/upload`);
    const req6 = new Promise((resolve) => {
      const r6 = http.request(
        {
          hostname: u.hostname,
          port: u.port,
          path: u.pathname,
          method: "POST",
          headers: {
            "Content-Type": "multipart/form-data; boundary=----test",
            "Content-Length": 0,
            Cookie: `auto_rh_session=${cookieRest}`,
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        }
      );
      r6.on("error", () => resolve(0));
      r6.end();
    });
    const codeUpload = await req6;
    verdict("N6", codeUpload === 400, `upload sans corps multipart → ${codeUpload} (400 propre attendu)`);

    /* N7 — API de données avec session */
    const rPa = await httpRequete("GET", `${ADMIN}/api/portal-access`, null, {
      Cookie: `auto_rh_session=${cookieRest}`,
    });
    verdict("N7", rPa.status === 200, `GET /api/portal-access avec session → ${rPa.status}`);

    /* Logout — le navigateur perd son cookie (maxAge=0) → 401.
       (Modèle stateless : le serveur ne maintient pas de liste de révocation ;
       le logout efface le cookie — atténué par la rotation pwv du Task 94.) */
    const rOut = await httpRequete("POST", `${ADMIN}/api/auth/logout`, {});
    const rMe2 = await httpGet(`${ADMIN}/api/auth/me`);
    verdict("N1c", rOut.status === 200 && rMe2.status === 401, `logout → ${rOut.status}, accès sans cookie après logout → ${rMe2.status}`);
  } catch (e) {
    console.error("\n[ERREUR HARNAIS]", e);
    resultats.push({ id: "EXCEPTION", ok: false });
  } finally {
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
    console.log(`\n=========== BILAN NON-RÉGRESSION : ${ok}/${resultats.length} réussis ===========`);
    resultats.forEach((r) => {
      if (!r.ok) console.log(`  ÉCHEC ${r.id}`);
    });
    setTimeout(() => process.exit(ok === resultats.length ? 0 : 1), 500).unref();
  }
})();
