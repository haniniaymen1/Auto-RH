/**
 * test103_tls465.js — (Task 103) Preuve du comportement 0.2.30 sur un port
 * SSL/TLS implicite (465) face à un VRAI serveur SMTP-over-TLS.
 *
 *  - Test A (comportement 0.2.30, secureDepuisPort(465)=true) :
 *      nodemailer { secure:true } → handshake TLS COMPLET + transaction SMTP
 *      (EHLO, AUTH, MAIL FROM, RCPT, DATA) → envoi RÉUSSI.
 *  - Test B (ancien comportement ≤0.2.29 : connexion en clair/STARTTLS sur
 *      un port TLS) : { secure:false } → échec attendu avec la MÊME signature
 *      d'erreur que la capture utilisateur : tls_validate_record_header:
 *      wrong version number.
 */
const tls = require("tls");
const fs = require("fs");
const path = require("path");
const TL = require(path.join("/home/z/my-project/task99_smtp/tlstest", "node_modules", "nodemailer"));

const PORT = 4465;
const HOST = "127.0.0.1";
let journal = [];      // trace de la transaction vue par le SERVEUR
let serveur = null;

function demarrerServeurTLS() {
  journal = [];
  return new Promise((resoudre, rejeter) => {
    const opts = {
      key: fs.readFileSync("/home/z/my-project/task99_smtp/tlstest/key.pem"),
      cert: fs.readFileSync("/home/z/my-project/task99_smtp/tlstest/cert.pem"),
    };
    serveur = tls.createServer(opts, (sock) => {
      let tampon = "";
      let etape = "greeting";
      let enData = false;
      let dataBuf = "";
      sock.write("220 tls-test.local ESMTP Pret (Task103)\r\n");
      sock.on("data", (d) => {
        tampon += d.toString("utf8");
        let idx;
        while ((idx = tampon.indexOf("\r\n")) >= 0) {
          const ligne = tampon.slice(0, idx);
          tampon = tampon.slice(idx + 2);
          if (enData) {
            if (ligne === ".") {
              enData = false;
              journal.push("DATA:" + dataBuf.replace(/\r\n/g, " | ").slice(0, 220));
              dataBuf = "";
              sock.write("250 OK: queued (Task103)\r\n");
            } else {
              dataBuf += ligne + " ";
              if (dataBuf.length > 2000) dataBuf = dataBuf.slice(0, 2000);
            }
            continue;
          }
          const cmd = ligne.toUpperCase();
          journal.push("CMD:" + ligne.slice(0, 120));
          if (cmd.startsWith("EHLO") || cmd.startsWith("HELO")) {
            sock.write("250-tls-test.local\r\n250-SIZE 10485760\r\n250-AUTH LOGIN PLAIN\r\n250 SMTPUTF8\r\n");
          } else if (cmd.startsWith("AUTH PLAIN")) {
            sock.write("235 2.7.0 Authentication successful (PLAIN)\r\n");
          } else if (cmd.startsWith("AUTH LOGIN")) {
            etape = "auth_user";
            sock.write("334 VXNlcm5hbWU6\r\n");
          } else if (etape === "auth_user") {
            etape = "auth_pass";
            sock.write("334 UGFzc3dvcmQ6\r\n");
          } else if (etape === "auth_pass") {
            etape = "cmd";
            sock.write("235 2.7.0 Authentication successful (LOGIN)\r\n");
          } else if (cmd.startsWith("MAIL FROM")) {
            sock.write("250 2.1.0 OK\r\n");
          } else if (cmd.startsWith("RCPT TO")) {
            sock.write("250 2.1.5 OK\r\n");
          } else if (cmd.startsWith("DATA")) {
            enData = true;
            sock.write("354 End data with <CR><LF>.<CR><LF>\r\n");
          } else if (cmd.startsWith("QUIT")) {
            sock.write("221 2.0.0 Bye\r\n");
            sock.end();
          } else if (cmd.startsWith("RSET") || cmd.startsWith("NOOP")) {
            sock.write("250 OK\r\n");
          } else {
            sock.write("502 5.5.2 Command not implemented (Task103)\r\n");
          }
        }
      });
      sock.on("error", () => { /* coupures de test B : ignorées côté serveur */ });
    });
    serveur.on("error", rejeter);
    serveur.listen(PORT, HOST, () => resoudre());
  });
}

function envoyer(secure) {
  const transport = TL.createTransport({
    host: HOST,
    port: PORT,
    secure, // ← SEULE DIFFÉRENCE entre Test A et Test B
    auth: { user: "171e357d8ec420", pass: "motdepasse-test" },
    tls: { rejectUnauthorized: false }, // identique à transporteurDepuisConfig() 0.2.30
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 8000,
  });
  return transport.sendMail({
    from: "Auto-RH <expediteur@test.local>",
    to: "smtp.test@autorh.tn",
    subject: "Test 465 implicit TLS (Task103)",
    text: "Preuve de transaction SMTP complete sur port SSL/TLS implicite.",
  });
}

(async () => {
  await demarrerServeurTLS();
  console.log("Serveur SMTP-over-TLS en ecoute sur " + HOST + ":" + PORT);

  // ---------- TEST A : comportement 0.2.30 (secure:true pour port 465) ----------
  journal = [];
  let A = { ok: false, detail: "" };
  try {
    const info = await envoyer(true);
    A.ok = true;
    A.detail = "response=" + info.response;
  } catch (e) {
    A.detail = "ECHEC inattendu: " + (e && (e.message || e));
  }
  console.log("\n===== TEST A — 0.2.30 (secure:true, port type 465) =====");
  console.log("RESULTAT : " + (A.ok ? "ENVOI REUSSI ✔" : "ECHEC ✘"));
  console.log("Detail   : " + A.detail);
  console.log("Transaction cote serveur (TLS) :");
  journal.forEach((l) => console.log("   " + l));
  const txnComplete = journal.some((l) => l.startsWith("CMD:EHLO"))
    && journal.some((l) => l.startsWith("CMD:MAIL FROM"))
    && journal.some((l) => l.startsWith("CMD:RCPT TO"))
    && journal.some((l) => l.startsWith("DATA:"));
  console.log("Transaction COMPLETE (EHLO+MAIL+RCPT+DATA) : " + (txnComplete ? "OUI ✔" : "NON ✘"));

  // ---------- TEST B : ancien comportement (clair/STARTTLS vers port TLS) ----------
  let B = { sig: "" };
  try {
    await envoyer(false);
    B.sig = "(aucune erreur — inattendu)";
  } catch (e) {
    const texte = String((e && (e.message || e)) || e) + " " + String((e && e.command) || "");
    B.sig = texte;
  }
  console.log("\n===== TEST B — ancien comportement (secure:false vers port TLS) =====");
  console.log("Erreur recue : " + B.sig.slice(0, 260));
  const sigOK = /wrong version number/i.test(B.sig);
  console.log("Signature identique a la capture utilisateur (wrong version number) : " + (sigOK ? "OUI ✔" : "NON"));

  serveur.close();
  console.log("\n===== VERDICT =====");
  console.log("A (0.2.30, port 465) : " + (A.ok && txnComplete ? "PASS — handshake TLS complet + e-mail livre" : "FAIL"));
  console.log("B (ancien ≤0.2.29)   : " + (sigOK ? "PASS — reproduit l'erreur de la capture (diagnostic confirme)" : "À vérifier"));
  process.exit(A.ok && txnComplete && sigOK ? 0 : 1);
})().catch((e) => { console.error("ERREUR HARNAIS:", e); try { serveur && serveur.close(); } catch (_) {} process.exit(2); });
