#!/usr/bin/env node
/**
 * E2E « Statuts en deux étapes » (v0.2.141) — affichage admin Manager → RH.
 * Capteur SMTP local (port 2525) ; vérifie, pour les 4 chemins de statut,
 * les champs exposés par l'API liste/détail du portail administratif :
 *   A. Congé → manager accepte → RH (voie admin) accepte
 *      → decisionManager=ACCEPTEE, decisionRh=ACCEPTEE, statutFinal « Acceptée ».
 *   B. Congé → manager refuse
 *      → decisionManager=REFUSEE, décision RH « Non concernée », statutFinal
 *        « Refusée par le Manager » (jamais transmise aux RH).
 *   C. Autorisation → manager accepte → RH (voie admin) refuse
 *      → statutFinal « Refusée par les RH ».
 *   D. Congé sans décision → tout « En attente », statutFinal « En attente ».
 *   E. Attestation (une seule étape) → deuxEtapes=false, flux historique intact.
 * Traçabilité vérifiée : décision, horodatage, auteur, commentaire par étape.
 * Nettoyage intégral en fin de test (demandes, accès, compte, config, VACUUM).
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
const CIN = "STATUTS001";
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
          } else if (cmd.startsWith("MAIL FROM") || cmd.startsWith("RCPT TO")) {
            if (/^RCPT/i.test(cmd) && !msgCourant) msgCourant = { de: "", vers: [], data: "" };
            const m = ligne.match(/<([^>]+)>/);
            if (/^RCPT/i.test(cmd) && m && msgCourant) msgCourant.vers.push(m[1]);
            soc.write("250 OK\r\n");
          } else if (cmd.startsWith("DATA")) {
            enData = true;
            if (!msgCourant) msgCourant = { de: "", vers: [], data: "" };
            soc.write("354 go ahead\r\n");
          } else if (cmd.startsWith("QUIT")) {
            soc.write("221 Au revoir\r\n");
            soc.end();
          } else {
            soc.write("250 OK\r\n");
          }
        }
      });
    });
    serveurSmtp.listen(SMTP_PORT, "127.0.0.1", resoudre);
  });
}

/** Analyse simplifiée : sujet + liens de décision (mailparser si dispo). */
async function analyser(listeBrute) {
  let simpleParser = null;
  try { ({ simpleParser } = require("mailparser")); } catch { /* repli brut */ }
  const sortis = [];
  for (const m of listeBrute) {
    let sujet = "", html = "", texte = "";
    if (simpleParser) {
      try {
        const p = await simpleParser(Buffer.from(m.data, "utf8"));
        sujet = String(p.subject || "");
        html = String(p.html || "");
        texte = String(p.text || "");
      } catch { /* repli brut */ }
    }
    if (!sujet) {
      const mS = /Subject: ([^\r\n]+)/.exec(m.data);
      sujet = mS ? mS[1] : "";
      html = m.data;
    }
    const liens = [...new Set((html + " " + texte).match(/https?:\/\/[^\s"'<>]+\/decision\?ref=[^"'<>()\s]+/g) || [])];
    sortis.push({ vers: m.vers, sujet, texte, html, liens });
  }
  return sortis;
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
        rejeter(new Error("Capteur : " + messages.length + "/" + nbVoulu + " messages reçus"));
      }
    }, 150);
  });
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
  return fetch(BASE + chemin, Object.assign({ redirect: "manual" }, options || {}));
}
async function admin(chemin, options, cookieAdmin) {
  const entetes = Object.assign({}, (options && options.headers) || {});
  if (cookieAdmin) entetes.cookie = cookieAdmin;
  return fetch(ADMIN + chemin, Object.assign({}, options, { headers: entetes, redirect: "manual" }));
}

let okCount = 0, koCount = 0;
function verif(libelle, cond, detail) {
  if (cond) { okCount++; console.log("  [OK] " + libelle); }
  else { koCount++; console.log("  [ECHEC] " + libelle + (detail ? " — " + detail : "")); }
}
function extraireLien(listeLiens) {
  return [...new Set(listeLiens || [])];
}

/** Récupère l'item de la liste admin par référence. */
async function itemParReference(cookieAdmin, reference) {
  const r = await admin("/api/demandes?q=" + encodeURIComponent(reference), { cache: "no-store" }, cookieAdmin);
  const j = await r.json();
  return (j.items || []).find((x) => x.reference === reference) || null;
}

(async () => {
  console.log("=== E2E STATUTS DEUX ÉTAPES MANAGER → RH (v0.2.141) ===\n");
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

  // compte portail de test
  await prisma.portalAccess.deleteMany({ where: { cin: cryptoBd.chiffrerChamp(CIN, true) } });
  await prisma.portalAccess.create({
    data: {
      cin: cryptoBd.chiffrerChamp(CIN, true),
      passwordHash: cryptoBd.chiffrerChamp("scrypt:x:y", false),
      nomPrenom: cryptoBd.chiffrerChamp("Nadia TESTSTATUTS", false),
      email: cryptoBd.chiffrerChamp(EMAIL_EMP, false),
      isActive: true,
      lastLoginAt: new Date(),
    },
  });
  // compte RH administration de test
  const sel = crypto.randomBytes(8).toString("hex");
  const mdpAdmin = "AdminStatuts!2026x";
  const hashAdmin = "scrypt:" + sel + ":" + crypto.scryptSync(mdpAdmin, sel, 64).toString("hex");
  await prisma.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp("rh-statuts@test.local", true) } });
  await prisma.user.create({ data: cryptoBd.chiffrerObjet("User", {
    email: "rh-statuts@test.local", name: "RH Statuts", passwordHash: hashAdmin, role: "RH",
    isActive: true, passwordChangedAt: new Date(),
  }) });
  const rLogin = await admin("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "rh-statuts@test.local", password: mdpAdmin, remember: false }) });
  const setCookie = (rLogin.headers.getSetCookie ? rLogin.headers.getSetCookie() : [rLogin.headers.get("set-cookie")]).join("; ");
  const cookieAdmin = setCookie.split(";").map((s) => s.trim()).filter((s) => /^(Auto-RH|session|token|auth)/i.test(s)).join("; ");
  verif("Setup : login admin RH (200 + cookie)", rLogin.status === 200 && cookieAdmin.length > 0, rLogin.status + " / " + setCookie.slice(0, 60));

  // ===== SCÉNARIO A : acceptation complète (congé) =====
  console.log("\n--- A : congé → manager accepte → RH admin accepte → « Acceptée » ---");
  const rCreA = await portail("/api/demandes", {
    method: "POST",
    headers: { cookie: COOKIE, "content-type": "application/json" },
    body: JSON.stringify({ type: "CONGE", typeConge: "Annuel", dateDebut: "2026-03-02", dateFin: "2026-03-06", emailN1: EMAIL_MAN, commentaire: "Congé annuel" }),
  });
  const jCreA = await rCreA.json();
  verif("A1 création congé (201)", rCreA.status === 201, JSON.stringify(jCreA).slice(0, 160));
  const refA = jCreA.reference;
  let msgs = await analyser(await attendreMessage(1, 15000));
  const liensManA = extraireLien(msgs[0] && msgs[0].liens);
  verif("A1 e-mail manager + liens décision", msgs[0] && msgs[0].vers[0] === EMAIL_MAN && liensManA.length >= 1);

  const fdA = new FormData();
  fdA.append("reference", refA);
  fdA.append("jeton", liensManA[0].split("jeton=")[1]);
  fdA.append("decision", "accepter");
  fdA.append("commentaire", "OK bon voyage");
  await portail("/api/decision", { method: "POST", body: fdA });

  const dbA = await prisma.demandeAdministrative.findUnique({ where: { reference: refA } });
  verif("A2 DB statut VALIDEE_MANAGER", dbA.statut === "VALIDEE_MANAGER", dbA.statut);
  verif("A2 DB décision manager = ACCEPTEE + date + auteur + commentaire", dbA.decisionManager === "ACCEPTEE" && !!dbA.decisionManagerLe && /manager/.test(dbA.decisionManagerPar || "") && dbA.commentaireManager === "OK bon voyage", JSON.stringify({ d: dbA.decisionManager, par: dbA.decisionManagerPar, c: dbA.commentaireManager }));
  verif("A2 DB décision RH encore null", !dbA.decisionRh, String(dbA.decisionRh));

  let itA = await itemParReference(cookieAdmin, refA);
  verif("A3 API liste : deuxEtapes=true", itA && itA.deuxEtapes === true);
  verif("A3 API liste : décision manager Acceptée / RH En attente", itA && itA.decisionManager.decision === "ACCEPTEE" && itA.decisionRh.decision === "EN_ATTENTE", JSON.stringify(itA && itA.decisionManager) + " / " + JSON.stringify(itA && itA.decisionRh));
  verif("A3 API liste : statutFinal « En attente » (clé EN_ATTENTE_RH)", itA && itA.statutFinal.cle === "EN_ATTENTE_RH" && itA.statutFinal.libelle === "En attente", JSON.stringify(itA && itA.statutFinal));

  const rDetA = await admin("/api/demandes/" + dbA.id, { cache: "no-store" }, cookieAdmin);
  const detA = (await rDetA.json()).item;
  verif("A4 API détail : commentaire manager visible + statutFinal cohérent", detA && detA.decisionManager.commentaire === "OK bon voyage" && detA.statutFinal.cle === "EN_ATTENTE_RH", JSON.stringify(detA && detA.decisionManager));

  const rPostA = await admin("/api/demandes/" + dbA.id, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ statut: "ACCEPTEE", commentaire: "Validé par le service RH" }) }, cookieAdmin);
  const jPostA = await rPostA.json();
  verif("A5 POST admin ACCEPTEE (ok + libellé « Acceptée »)", rPostA.status === 200 && jPostA.ok && jPostA.statutLibelle === "Acceptée", JSON.stringify(jPostA).slice(0, 200));
  verif("A5 POST admin : décision RH tracée (ACCEPTEE + auteur administration)", jPostA.decisionRh && jPostA.decisionRh.decision === "ACCEPTEE" && /administration/.test(jPostA.decisionRh.par), JSON.stringify(jPostA.decisionRh));

  const dbA2 = await prisma.demandeAdministrative.findUnique({ where: { reference: refA } });
  verif("A6 DB finale : statut ACCEPTEE + decisionRh=ACCEPTEE + date", dbA2.statut === "ACCEPTEE" && dbA2.decisionRh === "ACCEPTEE" && !!dbA2.decisionRhLe, JSON.stringify({ s: dbA2.statut, dr: dbA2.decisionRh }));
  itA = await itemParReference(cookieAdmin, refA);
  verif("A6 API liste : statutFinal « Acceptée » (ACCEPTEE)", itA && itA.statutFinal.cle === "ACCEPTEE" && itA.statutFinal.libelle === "Acceptée", JSON.stringify(itA && itA.statutFinal));

  // ===== SCÉNARIO B : refus manager (congé) =====
  console.log("\n--- B : congé → manager refuse → « Refusée par le Manager » ---");
  const rCreB = await portail("/api/demandes", {
    method: "POST",
    headers: { cookie: COOKIE, "content-type": "application/json" },
    body: JSON.stringify({ type: "CONGE", typeConge: "Sans solde", dateDebut: "2026-04-10", dateFin: "2026-04-12", emailN1: EMAIL_MAN, commentaire: "" }),
  });
  const jCreB = await rCreB.json();
  verif("B1 création congé B (201)", rCreB.status === 201);
  const refB = jCreB.reference;
  // (cumul) A : création(1) + transfert RH(2) + e-mail employé admin(3) ; B = 4e
  msgs = await analyser(await attendreMessage(4, 15000));
  const liensManB = extraireLien(msgs[3] && msgs[3].liens);
  verif("B1 e-mail création B au manager + liens", msgs[3] && msgs[3].vers[0] === EMAIL_MAN && liensManB.length >= 1);

  const fdB = new FormData();
  fdB.append("reference", refB);
  fdB.append("jeton", liensManB[0].split("jeton=")[1]);
  fdB.append("decision", "refuser");
  fdB.append("commentaire", "Période de rush");
  await portail("/api/decision", { method: "POST", body: fdB });

  const dbB = await prisma.demandeAdministrative.findUnique({ where: { reference: refB } });
  verif("B2 DB statut REFUSEE + décision manager REFUSEE (tracée)", dbB.statut === "REFUSEE" && dbB.decisionManager === "REFUSEE" && !!dbB.decisionManagerLe && dbB.commentaireManager === "Période de rush", JSON.stringify({ s: dbB.statut, dm: dbB.decisionManager, c: dbB.commentaireManager }));
  verif("B2 DB décision RH jamais posée (null)", !dbB.decisionRh, String(dbB.decisionRh));
  const itB = await itemParReference(cookieAdmin, refB);
  verif("B3 API liste : statutFinal « Refusée par le Manager » (REFUSEE_MANAGER)", itB && itB.statutFinal.cle === "REFUSEE_MANAGER" && itB.statutFinal.libelle === "Refusée par le Manager", JSON.stringify(itB && itB.statutFinal));
  verif("B3 API liste : décision RH=EN_ATTENTE → UI affichera « Non concernée »", itB && itB.decisionManager.decision === "REFUSEE" && itB.decisionRh.decision === "EN_ATTENTE", JSON.stringify({ dm: itB && itB.decisionManager.decision, dr: itB && itB.decisionRh.decision }));

  // ===== SCÉNARIO C : refus RH après acceptation manager (autorisation) =====
  console.log("\n--- C : autorisation → manager accepte → RH admin refuse → « Refusée par les RH » ---");
  const rCreC = await portail("/api/demandes", {
    method: "POST",
    headers: { cookie: COOKIE, "content-type": "application/json" },
    body: JSON.stringify({ type: "AUTORISATION_SORTIE", date: "2026-03-16", departement: "INFORMATIQUE", motif: "Rendez-vous administratif", nombreHeures: "2", heureSortie: "10:00", heureRetour: "12:00", compensation: "NON" }),
  });
  const jCreC = await rCreC.json();
  verif("C1 création autorisation (201, routée responsable DEFAUT)", rCreC.status === 201 && jCreC.destinataire === EMAIL_MAN2, JSON.stringify(jCreC).slice(0, 160));
  const refC = jCreC.reference;
  // (cumul) B : refus manager = 2 e-mails (employé + RH info) → 6 ; C = 7e
  msgs = await analyser(await attendreMessage(7, 15000));
  const liensManC = extraireLien(msgs[6] && msgs[6].liens);
  const fdC = new FormData();
  fdC.append("reference", refC);
  fdC.append("jeton", liensManC[0].split("jeton=")[1]);
  fdC.append("decision", "accepter");
  fdC.append("commentaire", "Accord du responsable");
  await portail("/api/decision", { method: "POST", body: fdC });

  const dbC = await prisma.demandeAdministrative.findUnique({ where: { reference: refC } });
  verif("C2 DB VALIDEE_MANAGER + décision manager ACCEPTEE", dbC.statut === "VALIDEE_MANAGER" && dbC.decisionManager === "ACCEPTEE", JSON.stringify({ s: dbC.statut, dm: dbC.decisionManager }));

  const rPostC = await admin("/api/demandes/" + dbC.id, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ statut: "REFUSEE", commentaire: "Effectif insuffisant" }) }, cookieAdmin);
  const jPostC = await rPostC.json();
  verif("C3 POST admin REFUSEE (libellé « Refusée par les RH »)", rPostC.status === 200 && jPostC.ok && jPostA.statutLibelle && jPostC.statutLibelle === "Refusée par les RH", JSON.stringify(jPostC).slice(0, 200));
  const dbC2 = await prisma.demandeAdministrative.findUnique({ where: { reference: refC } });
  verif("C3 DB finale : statut REFUSEE + décision RH REFUSEE tracée", dbC2.statut === "REFUSEE" && dbC2.decisionRh === "REFUSEE" && !!dbC2.decisionRhLe && dbC2.commentaireRh === "Effectif insuffisant", JSON.stringify({ s: dbC2.statut, dr: dbC2.decisionRh, c: dbC2.commentaireRh }));
  const itC = await itemParReference(cookieAdmin, refC);
  verif("C4 API liste : statutFinal « Refusée par les RH » (REFUSEE_RH)", itC && itC.statutFinal.cle === "REFUSEE_RH" && itC.statutFinal.libelle === "Refusée par les RH", JSON.stringify(itC && itC.statutFinal));
  verif("C4 API liste : décision manager reste Acceptée (traçabilité intacte)", itC && itC.decisionManager.decision === "ACCEPTEE" && itC.decisionRh.decision === "REFUSEE", JSON.stringify({ dm: itC && itC.decisionManager.decision, dr: itC && itC.decisionRh.decision }));

  // ===== SCÉNARIO D : attente (congé sans décision) =====
  console.log("\n--- D : congé sans décision → tout « En attente » ---");
  const rCreD = await portail("/api/demandes", {
    method: "POST",
    headers: { cookie: COOKIE, "content-type": "application/json" },
    body: JSON.stringify({ type: "CONGE", typeConge: "Exceptionnel", dateDebut: "2026-05-04", dateFin: "2026-05-05", emailN1: EMAIL_MAN, commentaire: "" }),
  });
  const jCreD = await rCreD.json();
  verif("D1 création congé D (201)", rCreD.status === 201);
  const refD = jCreD.reference;
  // (cumul) C : acceptation manager = transfert(8) + refus RH admin = e-mail(9) ; D = 10e
  await analyser(await attendreMessage(10, 15000));
  const itD = await itemParReference(cookieAdmin, refD);
  verif("D2 API liste : décisions manager/RH EN_ATTENTE + statutFinal « En attente »", itD && itD.decisionManager.decision === "EN_ATTENTE" && itD.decisionRh.decision === "EN_ATTENTE" && itD.statutFinal.cle === "EN_ATTENTE" && itD.statutFinal.libelle === "En attente", JSON.stringify(itD && itD.statutFinal));

  // ===== SCÉNARIO E : type UNE étape (attestation) — flux historique =====
  console.log("\n--- E : attestation (une seule étape) — deuxEtapes=false, flux intact ---");
  const rCreE = await portail("/api/demandes", {
    method: "POST",
    headers: { cookie: COOKIE, "content-type": "application/json" },
    body: JSON.stringify({ type: "ATTESTATION_TRAVAIL", nom: "TESTSTATUTS", prenom: "Nadia" }),
  });
  const jCreE = await rCreE.json();
  verif("E1 création attestation (201)", rCreE.status === 201, JSON.stringify(jCreE).slice(0, 160));
  const refE = jCreE.reference;
  // (cumul) D : création seulement → 10 ; E = 11e
  await analyser(await attendreMessage(11, 15000));
  const dbE = await prisma.demandeAdministrative.findUnique({ where: { reference: refE } });
  const itE = await itemParReference(cookieAdmin, refE);
  verif("E2 API liste : deuxEtapes=false (pas de colonnes décision)", itE && itE.deuxEtapes === false, JSON.stringify(itE && itE.deuxEtapes));
  const rPostE = await admin("/api/demandes/" + dbE.id, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ statut: "ACCEPTEE" }) }, cookieAdmin);
  const jPostE = await rPostE.json();
  const dbE2 = await prisma.demandeAdministrative.findUnique({ where: { reference: refE } });
  verif("E3 POST admin ACCEPTEE : AUCUNE décision RH tracée (une seule étape)", jPostE.ok && !dbE2.decisionRh && jPostE.statutLibelle === "Acceptée", JSON.stringify({ s: dbE2.statut, dr: dbE2.decisionRh, lib: jPostE.statutLibelle }));

  // ===== Bilan =====
  console.log("\n--- Bilan : " + okCount + " OK / " + koCount + " échec(s) ---");

  // ===== Nettoyage intégral =====
  console.log("\n--- Nettoyage ---");
  for (const ref of [refA, refB, refC, refD, refE]) {
    const d = await prisma.demandeAdministrative.findUnique({ where: { reference: ref }, select: { id: true } });
    if (d) await prisma.demandeAdministrative.delete({ where: { id: d.id } });
  }
  await prisma.portalAccess.deleteMany({ where: { cin: cryptoBd.chiffrerChamp(CIN, true) } });
  await prisma.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp("rh-statuts@test.local", true) } });
  // restauration MailConfig
  if (cfgOriginale) {
    await prisma.mailConfig.update({ where: { id: "smtp" }, data: {
      host: cfgOriginale.host, port: cfgOriginale.port, secure: cfgOriginale.secure,
      username: cfgOriginale.username, password: cfgOriginale.password,
      from: cfgOriginale.from, rhEmail: cfgOriginale.rhEmail,
      portailUrl: cfgOriginale.portailUrl, responsablesMap: cfgOriginale.responsablesMap,
    } });
  } else {
    await prisma.mailConfig.deleteMany({ where: { id: "smtp" } });
  }
  const restes = await prisma.demandeAdministrative.count();
  console.log("Demandes restantes en base : " + restes);
  if (serveurSmtp) serveurSmtp.close();
  await prisma.$queryRawUnsafe("VACUUM");
  await prisma.$disconnect();
  process.exit(koCount === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error("ERREUR FATALE:", e && e.message ? e.message : e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(2);
});
