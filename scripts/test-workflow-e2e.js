#!/usr/bin/env node
/**
 * E2E du workflow de validation congé/autorisation (v0.2.140).
 * Capteur SMTP local (port 2525) + scénarios complets :
 *   A. Congé + PJ employé → manager accepte (lien) → transfert RH (2 PJ) →
 *      RH refuse (lien) → e-mails employé/RH, statut REFUSEE.
 *   B. Congé → manager refuse (lien) → e-mails employé + RH, PAS de transfert.
 *   C. Autorisation de sortie → manager accepte (lien) → voie ADMIN (RH
 *      connecté accepte) → e-mail employé avec PJ, statut ACCEPTEE.
 * Nettoyage intégral en fin de test.
 */
const crypto = require("crypto");
const net = require("net");
const fs = require("fs");
const path = require("path");

process.env.DATABASE_URL = process.env.DATABASE_URL || "file:" + path.join(__dirname, "..", "db", "custom.db");
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
const prisma = new PrismaClient();

const SECRET = "autorh-secret-local-a-changer-dans-env";
const CIN = "WORKFLOW01";
const SMTP_PORT = 2525;
const BASE = "http://127.0.0.1:4001";
const ADMIN = "http://127.0.0.1:4000";
const EMAIL_EMP = "employe@test.local";
const EMAIL_MAN = "manager@test.local";
const EMAIL_MAN2 = "manager2@test.local";
const EMAIL_RH = "rh@test.local";

// ---------- Capteur SMTP minimal ----------
let messages = [];
let serveurSmtp = null;
function demarrerCapteur() {
  return new Promise((resoudre) => {
    serveurSmtp = net.createServer((soc) => {
      let tampon = "";
      let enData = false;
      let msgCourant = null;
      soc.write("220 catcher ESMTP\r\n");
      soc.on("data", (d) => {
        tampon += d.toString();
        let i;
        while ((i = tampon.indexOf("\r\n")) >= 0) {
          const ligne = tampon.slice(0, i);
          tampon = tampon.slice(i + 2);
          if (enData) {
            if (ligne === ".") {
              enData = false;
              messages.push(msgCourant);
              msgCourant = null;
              soc.write("250 OK queued\r\n");
            } else {
              msgCourant.data += (msgCourant.data ? "\n" : "") + ligne.replace(/^\.\./, ".");
            }
            continue;
          }
          const cmd = ligne.toUpperCase();
          if (cmd.startsWith("EHLO") || cmd.startsWith("HELO")) {
            soc.write("250-catcher\r\n250-8BITMIME\r\n250-SIZE 73400320\r\n250 OK\r\n");
          } else if (cmd.startsWith("MAIL FROM")) {
            soc.write("250 OK\r\n");
          } else if (cmd.startsWith("RCPT TO")) {
            const m = ligne.match(/<([^>]+)>/);
            if (!msgCourant) msgCourant = { de: "", vers: [], data: "" };
            if (m) msgCourant.vers.push(m[1]);
            soc.write("250 OK\r\n");
          } else if (cmd.startsWith("DATA")) {
            enData = true;
            soc.write("354 go ahead\r\n");
          } else if (cmd.startsWith("QUIT")) {
            soc.write("221 Au revoir\r\n");
            soc.end();
          } else if (cmd.startsWith("RSET")) {
            soc.write("250 OK\r\n");
          } else if (cmd.startsWith("NOOP")) {
            soc.write("250 OK\r\n");
          } else {
            soc.write("250 OK\r\n");
          }
        }
      });
    });
    serveurSmtp.listen(SMTP_PORT, "127.0.0.1", resoudre);
  });
}

function attendreMessage(nbVoulu, timeoutMs) {
  const debut = Date.now();
  return new Promise((resoudre, rejeter) => {
    const t = setInterval(() => {
      if (messages.length >= nbVoulu) {
        clearInterval(t);
        resoudre(messages.slice());
      } else if (Date.now() - debut > (timeoutMs || 20000)) {
        clearInterval(t);
        rejeter(new Error("Capteur : " + messages.length + "/" + nbVoulu + " messages reçus en " + (timeoutMs || 20000) + " ms"));
      }
    }, 150);
  });
}

/** Analyse un message brut avec mailparser (sujet QP, pièces jointes, liens). */
async function analyser(listeBrute) {
  const { simpleParser } = require("mailparser");
  const sortis = [];
  for (const m of listeBrute) {
    let p = null;
    try { p = await simpleParser(Buffer.from(m.data, "utf8")); } catch (e) { p = null; }
    const html = String((p && p.html) || "");
    const texte = String((p && p.text) || "");
    const liens = [...new Set((html + " " + texte).match(/https?:\/\/[^\s"'<>]+\/decision\?ref=[^"'<>()\s]+/g) || [])];
    sortis.push({
      vers: m.vers,
      sujet: String((p && p.subject) || ""),
      texte: texte,
      html: html,
      pjs: ((p && p.attachments) || []).map((a) => a.filename),
      liens: liens,
    });
  }
  return sortis;
}

// ---------- Sessions forgées + HTTP ----------
function b64url(b) { return Buffer.from(b).toString("base64url"); }
function jetonSession(cin) {
  const payload = b64url(JSON.stringify({ cin, exp: Math.floor(Date.now() / 1000) + 1800, rm: 0, pd: 0, ot: 0 }));
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return payload + "." + sig;
}
const COOKIE = "portail_session=" + jetonSession(CIN);

async function portail(chemin, options) {
  const res = await fetch(BASE + chemin, Object.assign({ redirect: "manual" }, options || {}));
  return res;
}
async function admin(chemin, options, cookieAdmin) {
  const entetes = Object.assign({}, (options && options.headers) || {});
  if (cookieAdmin) entetes.cookie = cookieAdmin;
  return fetch(ADMIN + chemin, Object.assign({}, options, { headers: entetes, redirect: "manual" }));
}

function petitPdf(titre) {
  return Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n" +
    "4 0 obj<</Length 60>>stream\nBT /F1 10 Tf 10 50 Td (" + titre + ") Tj ET\nendstream endobj\n" +
    "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF",
    "utf8"
  );
}

let okCount = 0, koCount = 0;
function verif(libelle, cond, detail) {
  if (cond) { okCount++; console.log("  [OK] " + libelle); }
  else { koCount++; console.log("  [ECHEC] " + libelle + (detail ? " — " + detail : "")); }
}
function extraireLien(listeLiens, action) {
  // les liens sont déjà extraits par analyser() — filtre par étape éventuel
  return [...new Set(listeLiens || [])];
}

(async () => {
  console.log("=== E2E WORKFLOW VALIDATION CONGÉ/AUTORISATION (v0.2.140) ===\n");
  await demarrerCapteur();
  console.log("Capteur SMTP en écoute sur :" + SMTP_PORT);

  // --- configuration ---
  const cfgOriginale = await prisma.mailConfig.findUnique({ where: { id: "smtp" } });
  await prisma.mailConfig.upsert({
    where: { id: "smtp" },
    create: { id: "smtp", host: "127.0.0.1", port: SMTP_PORT, secure: false, from: "Auto-RH Test <paie@test.local>", rhEmail: EMAIL_RH, portailUrl: BASE, responsablesMap: "DEFAUT=" + EMAIL_MAN2 },
    update: { host: "127.0.0.1", port: SMTP_PORT, secure: false, username: null, password: null, from: "Auto-RH Test <paie@test.local>", rhEmail: EMAIL_RH, portailUrl: BASE, responsablesMap: "DEFAUT=" + EMAIL_MAN2 },
  });
  console.log("MailConfig de test posée (SMTP 127.0.0.1:" + SMTP_PORT + ", RH " + EMAIL_RH + ")");

  // compte portail de test (email + nom connus)
  await prisma.portalAccess.deleteMany({ where: { cin: cryptoBd.chiffrerChamp(CIN, true) } });
  await prisma.portalAccess.create({
    data: {
      cin: cryptoBd.chiffrerChamp(CIN, true),
      passwordHash: cryptoBd.chiffrerChamp("scrypt:x:y", false),
      nomPrenom: cryptoBd.chiffrerChamp("Nadia TESTWORKFLOW", false),
      email: cryptoBd.chiffrerChamp(EMAIL_EMP, false),
      isActive: true,
      lastLoginAt: new Date(),
    },
  });
  console.log("Compte portail de test créé (" + CIN + " — " + EMAIL_EMP + ")");

  // ===== SCÉNARIO A : congé, manager accepte, RH refuse =====
  console.log("\n--- Scénario A : congé + PJ → manager accepte → RH refuse ---");
  // A1 : pièce jointe employé (staging)
  const fd = new FormData();
  fd.append("type", "CONGE");
  fd.append("files", new Blob([petitPdf("Justificatif conge")], { type: "application/pdf" }), "justificatif.pdf");
  const rPj = await portail("/api/demandes/pieces-jointes", { method: "POST", headers: { cookie: COOKIE }, body: fd });
  const jPj = await rPj.json();
  verif("A1 staging PJ employé (201 + 1 fichier)", rPj.status === 201 && jPj.pieces && jPj.pieces.length === 1, JSON.stringify(jPj).slice(0, 150));

  // A2 : création congé
  const rCre = await portail("/api/demandes", {
    method: "POST",
    headers: { cookie: COOKIE, "content-type": "application/json" },
    body: JSON.stringify({ type: "CONGE", typeConge: "Annuel", dateDebut: "2026-03-02", dateFin: "2026-03-06", emailN1: EMAIL_MAN, commentaire: "Congé annuel de printemps" }),
  });
  const jCre = await rCre.json();
  verif("A2 création congé (201 + PJ rattachées + e-mail envoyé)", rCre.status === 201 && jCre.piecesJointes === 1 && jCre.email && jCre.email.envoye, JSON.stringify(jCre).slice(0, 220));
  const refA = jCre.reference;

  // A3 : e-mail de création au manager avec la PJ
  const msgsA = await analyser(await attendreMessage(1, 15000));
  const e1 = msgsA[0];
  verif("A3 e-mail création → manager, sujet traitement requis", e1 && e1.vers[0] === EMAIL_MAN && /traitement requis/.test(e1.sujet), e1 ? e1.vers.join() + " / " + e1.sujet : "aucun");
  verif("A3 e-mail création contient la PJ justificatif.pdf", e1 && e1.pjs.indexOf("justificatif.pdf") >= 0, e1 ? JSON.stringify(e1.pjs) : "aucun");
  const liensMan = extraireLien(e1 && e1.liens);
  verif("A3 e-mail contient des liens de décision", liensMan.length >= 1, liensMan.join(" | ").slice(0, 120));

  // A4 : page de décision manager
  const rPage = await portail("/decision?ref=" + refA + "&jeton=" + liensMan[0].split("jeton=")[1]);
  const pageHtml = await rPage.text();
  verif("A4 page décision manager (200 + boutons)", rPage.status === 200 && /Accepter la demande/.test(pageHtml) && /Refuser la demande/.test(pageHtml));

  // A5 : manager accepte (avec PJ + commentaire)
  const jetonMan = liensMan[0].split("jeton=")[1];
  const fdA5 = new FormData();
  fdA5.append("reference", refA);
  fdA5.append("jeton", jetonMan);
  fdA5.append("decision", "accepter");
  fdA5.append("commentaire", "OK bon voyage, pensez au passation");
  fdA5.append("pieces", new Blob([petitPdf("Note manager")], { type: "application/pdf" }), "note-manager.pdf");
  const rDec = await portail("/api/decision", { method: "POST", body: fdA5 });
  const pageDec = await rDec.text();
  verif("A5 décision manager accepter (200 + confirmation)", rDec.status === 200 && /Votre décision a été enregistrée/.test(pageDec), pageDec.slice(0, 200));
  const demA = await prisma.demandeAdministrative.findUnique({ where: { reference: refA } });
  verif("A5 statut VALIDEE_MANAGER + traitePar manager", demA.statut === "VALIDEE_MANAGER" && /manager/.test(demA.traitePar || ""), demA.statut);

  // A6 : e-mail de transfert RH avec 2 PJ + liens RH
  const msgsA6 = await analyser(await attendreMessage(2, 15000));
  const e2 = msgsA6[1];
  verif("A6 transfert RH (sujet + 2 PJ : justificatif + note manager)", e2 && e2.vers[0] === EMAIL_RH && /Validation RH requise/.test(e2.sujet) && e2.pjs.indexOf("justificatif.pdf") >= 0 && e2.pjs.indexOf("note-manager.pdf") >= 0, e2 ? JSON.stringify(e2.pjs) + " / " + e2.sujet : "aucun");
  const liensRh = extraireLien(e2 && e2.liens);
  verif("A6 e-mail RH contient des liens de décision", liensRh.length >= 1);
  const demA2 = await prisma.demandeAdministrative.findUnique({ where: { reference: refA } });
  verif("A6 messageIdRh mémorisé", !!demA2.messageIdRh);

  // A7 : RH refuse via lien RH
  const jetonRh = liensRh[0].split("jeton=")[1];
  const fdA7 = new FormData();
  fdA7.append("reference", refA);
  fdA7.append("jeton", jetonRh);
  fdA7.append("decision", "refuser");
  fdA7.append("commentaire", "Effectif insuffisant sur cette période");
  const rA7 = await portail("/api/decision", { method: "POST", body: fdA7 });
  verif("A7 décision RH refuser (200)", rA7.status === 200);
  const msgsA7 = await analyser(await attendreMessage(3, 15000));
  const e3 = msgsA7[2];
  verif("A7 e-mail employé : demande REFUSÉE (décision finale RH)", e3 && e3.vers[0] === EMAIL_EMP && /REFUSÉE/.test(e3.sujet) && /Effectif insuffisant/.test(e3.texte), e3 ? e3.sujet : "aucun");
  verif("A7 e-mail employé embarque les 2 PJ", e3 && e3.pjs.indexOf("justificatif.pdf") >= 0 && e3.pjs.indexOf("note-manager.pdf") >= 0, e3 ? JSON.stringify(e3.pjs) : "aucun");
  const demA3 = await prisma.demandeAdministrative.findUnique({ where: { reference: refA } });
  verif("A7 statut final REFUSEE", demA3.statut === "REFUSEE", demA3.statut);

  // ===== SCÉNARIO B : congé refusé par le manager =====
  console.log("\n--- Scénario B : congé → manager refuse (pas de transmission RH) ---");
  const rCreB = await portail("/api/demandes", {
    method: "POST",
    headers: { cookie: COOKIE, "content-type": "application/json" },
    body: JSON.stringify({ type: "CONGE", typeConge: "Sans solde", dateDebut: "2026-04-10", dateFin: "2026-04-12", emailN1: EMAIL_MAN, commentaire: "" }),
  });
  const jCreB = await rCreB.json();
  verif("B1 création congé B (201)", rCreB.status === 201, JSON.stringify(jCreB).slice(0, 160));
  const refB = jCreB.reference;
  const msgsB = await analyser(await attendreMessage(4, 15000));
  const eB = msgsB[3];
  const liensManB = extraireLien(eB && eB.liens);
  verif("B2 e-mail création B au manager + liens", eB && eB.vers[0] === EMAIL_MAN && liensManB.length >= 1);
  const fdB = new FormData();
  fdB.append("reference", refB);
  fdB.append("jeton", liensManB[0].split("jeton=")[1]);
  fdB.append("decision", "refuser");
  fdB.append("commentaire", "Période de rush — reportez au mois suivant");
  const rB = await portail("/api/decision", { method: "POST", body: fdB });
  verif("B3 refus manager enregistré (200)", rB.status === 200);
  const msgsB3 = await analyser(await attendreMessage(6, 15000));
  const eBemp = msgsB3[4], eBrh = msgsB3[5];
  verif("B3 e-mail employé REFUSÉE", eBemp && eBemp.vers[0] === EMAIL_EMP && /REFUSÉE/.test(eBemp.sujet));
  verif("B3 e-mail RH = information (pas de validation)", eBrh && eBrh.vers[0] === EMAIL_RH && /refusée par le manager/.test(eBrh.sujet) && !/Validation RH requise/.test(eBrh.sujet), eBrh ? eBrh.sujet : "aucun");
  const demB = await prisma.demandeAdministrative.findUnique({ where: { reference: refB } });
  verif("B3 statut REFUSEE (jamais transmis aux RH)", demB.statut === "REFUSEE", demB.statut);

  // ===== SCÉNARIO C : autorisation de sortie, voie admin =====
  console.log("\n--- Scénario C : autorisation sortie → manager accepte → RH admin accepte ---");
  const rCreC = await portail("/api/demandes", {
    method: "POST",
    headers: { cookie: COOKIE, "content-type": "application/json" },
    body: JSON.stringify({ type: "AUTORISATION_SORTIE", date: "2026-03-16", departement: "INFORMATIQUE", motif: "Rendez-vous administratif", nombreHeures: "2", heureSortie: "10:00", heureRetour: "12:00", compensation: "NON" }),
  });
  const jCreC = await rCreC.json();
  verif("C1 création autorisation (201 + routage responsable département)", rCreC.status === 201 && jCreC.destinataire === EMAIL_MAN2, JSON.stringify(jCreC).slice(0, 200));
  const refC = jCreC.reference;
  const msgsC = await analyser(await attendreMessage(7, 15000));
  const eC = msgsC[6];
  const liensManC = extraireLien(eC && eC.liens);
  const fdC = new FormData();
  fdC.append("reference", refC);
  fdC.append("jeton", liensManC[0].split("jeton=")[1]);
  fdC.append("decision", "accepter");
  fdC.append("commentaire", "Accord du responsable");
  const rC = await portail("/api/decision", { method: "POST", body: fdC });
  verif("C2 manager accepte (200)", rC.status === 200);
  const msgsC2 = await analyser(await attendreMessage(8, 15000));
  const eC2 = msgsC2[7];
  verif("C2 transfert RH reçu", eC2 && eC2.vers[0] === EMAIL_RH && /Validation RH requise/.test(eC2.sujet));
  const demC = await prisma.demandeAdministrative.findUnique({ where: { reference: refC } });
  verif("C2 statut VALIDEE_MANAGER", demC.statut === "VALIDEE_MANAGER", demC.statut);

  // C3 : voie ADMIN — login RH + traitement (ACCEPTEE)
  const sel = crypto.randomBytes(8).toString("hex");
  const mdpAdmin = "AdminE2E!2026x";
  const hashAdmin = "scrypt:" + sel + ":" + crypto.scryptSync(mdpAdmin, sel, 64).toString("hex");
  // (v0.2.140) User.email est chiffré DÉTERMINISTE (carte db-crypto) : la
  // création passe par chiffrerObjet — comme les scripts de test historiques.
  await prisma.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp("rh-e2e@test.local", true) } });
  await prisma.user.create({ data: cryptoBd.chiffrerObjet("User", {
    email: "rh-e2e@test.local", name: "RH E2E", passwordHash: hashAdmin, role: "RH",
    isActive: true, passwordChangedAt: new Date(),
  }) });
  const rLogin = await admin("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "rh-e2e@test.local", password: mdpAdmin, remember: false }) });
  const setCookie = (rLogin.headers.getSetCookie ? rLogin.headers.getSetCookie() : [rLogin.headers.get("set-cookie")]).join("; ");
  verif("C3 login admin RH (200 + cookie)", rLogin.status === 200 && /Auto-RH|session|token/i.test(setCookie), rLogin.status + " / " + setCookie.slice(0, 60));
  const cookieAdmin = setCookie.split(";").map(s => s.trim()).filter(s => /^(Auto-RH|session|token|auth)/i.test(s)).join("; ");
  const rTrait = await admin("/api/demandes/" + demC.id, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ statut: "ACCEPTEE", commentaire: "Validé par le service RH" }) }, cookieAdmin);
  const jTrait = await rTrait.json();
  verif("C3 traitement admin ACCEPTEE (ok + notification envoyée)", rTrait.status === 200 && jTrait.ok && jTrait.notification && jTrait.notification.envoye, JSON.stringify(jTrait).slice(0, 220));
  const msgsC3 = await analyser(await attendreMessage(9, 15000));
  const eC3 = msgsC3[8];
  verif("C3 e-mail employé ACCEPTÉE (voie admin)", eC3 && eC3.vers[0] === EMAIL_EMP && /Acceptée/.test(eC3.sujet), eC3 ? eC3.sujet : "aucun");
  const demC3 = await prisma.demandeAdministrative.findUnique({ where: { reference: refC } });
  verif("C3 statut final ACCEPTEE", demC3.statut === "ACCEPTEE", demC3.statut);

  // ===== Contrôles de sécurité =====
  console.log("\n--- Sécurité : rejeu + jeton faux + expéditeur ---");
  const fdRe = new FormData();
  fdRe.append("reference", refB);
  fdRe.append("jeton", liensManB[0].split("jeton=")[1]);
  fdRe.append("decision", "accepter");
  const rRe = await portail("/api/decision", { method: "POST", body: fdRe });
  verif("S1 rejeu d'une décision (409)", rRe.status === 409, rRe.status);
  const rJetonFaux = await portail("/decision?ref=" + refA + "&jeton=abc123faux");
  const htmlFaux = await rJetonFaux.text();
  verif("S2 jeton invalide → page refus", /non applicable|invalide/i.test(htmlFaux));

  // ===== Bilan + nettoyage =====
  console.log("\n--- Bilan : " + okCount + " OK / " + koCount + " échec(s) ---");

  // nettoyage
  const refs = [refA, refB, refC];
  for (const r of refs) {
    const d = await prisma.demandeAdministrative.findUnique({ where: { reference: r }, include: { documents: true } });
    if (d) {
      const chemin = require("./lib-crypto-bd.js");
      for (const doc of d.documents) {
        for (const candidat of [path.join(__dirname, "..", "storage", "documents-demandes", doc.chemin), path.join(__dirname, "..", "storage", "documents-demandes", "_staging", doc.chemin)]) {
          try { fs.unlinkSync(candidat); } catch (e) { /* absent */ }
        }
      }
      await prisma.documentDemande.deleteMany({ where: { demandeId: d.id } });
      await prisma.demandeAdministrative.delete({ where: { id: d.id } });
    }
  }
  await prisma.portalAccess.deleteMany({ where: { cin: cryptoBd.chiffrerChamp(CIN, true) } });
  await prisma.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp("rh-e2e@test.local", true) } });
  if (cfgOriginale) {
    await prisma.mailConfig.update({ where: { id: "smtp" }, data: {
      host: cfgOriginale.host, port: cfgOriginale.port, secure: cfgOriginale.secure,
      username: cfgOriginale.username, password: cfgOriginale.password, from: cfgOriginale.from,
      rhEmail: cfgOriginale.rhEmail, responsablesMap: cfgOriginale.responsablesMap, portailUrl: cfgOriginale.portailUrl,
    } });
  } else {
    await prisma.mailConfig.deleteMany({ where: { id: "smtp" } });
  }
  // purge du staging résiduel
  const dossierStaging = path.join(__dirname, "..", "storage", "documents-demandes", "_staging");
  try { for (const f of fs.readdirSync(dossierStaging)) fs.unlinkSync(path.join(dossierStaging, f)); } catch (e) { /* absent */ }
  console.log("Nettoyage effectué (demandes, documents, comptes, MailConfig restaurée).");
  if (serveurSmtp) serveurSmtp.close();
  process.exit(koCount ? 1 : 0);
})().catch(e => { console.error("ERREUR E2E:", e && e.message ? e.message : e); process.exit(1); });
