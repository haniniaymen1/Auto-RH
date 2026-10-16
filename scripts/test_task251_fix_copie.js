#!/usr/bin/env node
"use strict";
/**
 * Task 251 — PREUVE DE NON-RÉGRESSION du correctif « copies de routage ».
 * AVANT le correctif : la copie de routage d'une AUTORISATION (corps contenant
 * « Compensation des heures : Non ») était classée « réponse RH » → REFUS
 * parasite immédiat (reproduit en réel sur DEM-2026-00053).
 * APRÈS : ces copies portent X-Auto-RH-Systeme → ignorées par le poller.
 * Scénario : création (compensation NON) → statut reste « En attente » (le
 * défaut aurait déjà refusé) → en-têtes vérifiés dans INBOX → réponse manager
 * « OK pour moi » → ACCEPTEE → réponse RH « Je valide » → ACCEPTEE + docSigné.
 */
process.chdir(__dirname + "/..");
const M = require("./test_task251_pj_reponses_deux_portails.js");
const fs = require("fs");
const { ImapFlow } = require("imapflow");
const { check, sleep, sha256, relire, totpNow, clientHttp, avecImap, attendreStatut, etatLire, etatEcrire, pdfMinimal, db, TMP, PORTAIL, ADMIN, SUPERADMIN, GMAIL_USER, GMAIL_APP, IMAP_HOST, IMAP_PORT, MGR_EMP1, MDP_PORTAIL, SECRET_TOTP, getOK, getFail, getEchecs } = M;

const REF_P3 = "P3-autor-fix";
let ref = null;

(async () => {
  console.log("\n====== TASK 251 — PREUVE DU CORRECTIF (copie de routage ignorée) ======");
  // sessions
  const p1 = clientHttp(PORTAIL);
  let v = await p1.post("/api/verify", { cin: "EMPZOH001", password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false });
  if (!(v.status === 200 && v.json && v.json.ok)) { await sleep(20000); v = await p1.post("/api/verify", { cin: "EMPZOH001", password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false }); }
  check("Connexion portail employé (EMPZOH001)", v.status === 200 && v.json && v.json.ok, "status=" + v.status);

  // 1) création AUTORISATION avec compensation NON (le déclencheur historique)
  const r = await p1.post("/api/demandes", {
    type: "AUTORISATION_SORTIE", date: "2027-03-02",
    motif: "Task 251 — vérification du correctif copie de routage",
    nombreHeures: "2", heureSortie: "09:00", heureRetour: "11:00", compensation: "NON",
  });
  ref = r.json && (r.json.reference || (r.json.d && r.json.d.reference));
  check("Demande P3 (AUTORISATION_SORTIE, compensation « NON ») créée → " + ref, (r.status === 200 || r.status === 201) && !!ref, "status=" + r.status);
  if (!ref) { await db.$disconnect(); process.exit(1); }
  const cas = (etatLire().cas || []).filter((c) => c.ref !== null);
  cas.push({ cle: REF_P3, ref, shaManager: "", shaRh: "", nomManager: "", nomRh: "" });
  etatEcrire({ ...(etatLire()), cas });

  // 2) AVANT le correctif, la copie de routage était classée « réponse RH » et
  //    la demande était REFUSÉE en moins de 2 minutes. Vérification sur 3 min.
  console.log("  → Observation 180 s (avant correctif : REFUSEE par les RH dès le 1er passage)…");
  let refuse = false;
  for (let i = 0; i < 12; i++) {
    await sleep(15000);
    const d = await relire(ref);
    if (d && (d.decisionRh || d.refuseePar || d.statut !== "EN_ATTENTE")) { refuse = true; break; }
  }
  const d0 = await relire(ref);
  check("CORRECTIF PRUVÉ : AUCUN refus parasite (statut inchangé après 180 s)", !refuse && d0.statut === "EN_ATTENTE" && !d0.decisionRh && !d0.refuseePar, "statut=" + d0.statut + " decisionRh=" + (d0.decisionRh || "-") + " refuseePar=" + (d0.refuseePar || "-"));

  // 3) les copies de routage portent DÉSORMAIS l'en-tête X-Auto-RH-Systeme
  const c = new ImapFlow({ host: IMAP_HOST, port: IMAP_PORT, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_APP }, tls: { rejectUnauthorized: false }, logger: false });
  await c.connect();
  const lock = await c.getMailboxLock("INBOX");
  let avecEntete = 0, copies = 0;
  try {
    const uids = (await c.search({ subject: ref }, { uid: true })) || [];
    for (const uid of uids) {
      const msg = await c.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !msg.source) continue;
      const src = msg.source.toString("utf8");
      const entetes = src.split(/\r?\n\r?\n/)[0] || "";
      if (!/^In-Reply-To:/mi.test(entetes) && /X-Auto-RH-Systeme:/i.test(entetes)) { copies++; avecEntete++; }
      else if (!/^In-Reply-To:/mi.test(entetes)) { copies++; }
    }
  } finally { lock.release(); await c.logout().catch(() => {}); }
  check("Copies de routage dans INBOX portant l'en-tête X-Auto-RH-Systeme : " + avecEntete + "/" + copies, copies >= 1 && avecEntete === copies, copies + " copie(s), " + avecEntete + " avec en-tête");

  // 4) la demande reste TOTALEMENT fonctionnelle : manager puis RH
  const sujet = "Re: AutoRH — Autorisation de sortie " + ref + " (traitement requis)";
  const eml = [
    "Message-ID: <task251-p3-mgr-" + Date.now() + "@gmail.com>",
    "Date: " + new Date().toUTCString(),
    "From: \"Manager Task 251\" <" + MGR_EMP1 + ">", "To: <" + GMAIL_USER + ">",
    "Subject: " + sujet, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "",
    "OK pour moi, à valider par les RH.", "",
  ].join("\r\n");
  await avecImap(async (cl) => cl.append("INBOX", Buffer.from(eml, "utf8")));
  check("Réponse manager « OK pour moi » APPENDÉE (réel)", true, sujet.slice(0, 50));
  const dMgr = await attendreStatut(ref, (x) => !!x.decisionManagerLe, 300000);
  check("Décision MANAGER = ACCEPTEE (le poller traite TOUJOURS les vraies réponses)", dMgr && dMgr.decisionManager === "ACCEPTEE", dMgr ? "decisionManager=" + dMgr.decisionManager : "absent");

  const d0b = await relire(ref);
  const t = require("nodemailer").createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_APP }, tls: { rejectUnauthorized: false } });
  const info = await t.sendMail({
    from: '"Auto-RH Auto-RH (Task 251)" <' + GMAIL_USER + ">", to: GMAIL_USER,
    subject: "Re: AutoRH — Autorisation de sortie " + ref,
    text: "Je valide cette autorisation de sortie.",
    inReplyTo: d0b.messageIdEnvoi, references: d0b.messageIdEnvoi,
    attachments: [{ filename: "note-valide-P3.pdf", content: pdfMinimal("Task 251 - Piece jointe RH - P3 - validation"), contentType: "application/pdf" }],
  });
  check("Réponse RH « Je valide » + pièce jointe ENVOYÉE (250 réel)", /250|OK/.test(info.response || ""), String(info.response || "").slice(0, 35));
  const dFin = await attendreStatut(ref, (x) => x.statut === "ACCEPTEE" || x.statut === "REFUSEE", 300000);
  check("Statut FINAL = ACCEPTEE + document signé généré", dFin && dFin.statut === "ACCEPTEE" && !!dFin.docSigneChemin, dFin ? "statut=" + dFin.statut + " docSigne=" + !!dFin.docSigneChemin : "absent");
  const pjRh = await db.documentDemande.findFirst({ where: { demande: { reference: ref }, recuDe: GMAIL_USER } });
  check("Pièce jointe RH de P3 importée (visible sur les 2 portails comme P1/P2)", !!pjRh, pjRh ? pjRh.nomFichier : "absente");
  const cas2 = (etatLire().cas || []).map((c) => c.cle === REF_P3 ? { ...c, shaRh: pjRh ? sha256(pdfMinimal("Task 251 - Piece jointe RH - P3 - validation")) : "", nomRh: pjRh ? pjRh.nomFichier : "" } : c);
  etatEcrire({ ...(etatLire()), cas: cas2 });

  await db.$disconnect();
  console.log("\n=========== RÉSUMÉ PREUVE CORRECTIF ===========");
  console.log("  " + getOK() + " contrôle(s) OK — " + getFail() + " échec(s)");
  if (getEchecs().length) for (const e of getEchecs()) console.log("   FAIL: " + e);
  process.exit(getFail() ? 1 : 0);
})().catch((e) => { console.error("ERREUR:", e.message); process.exit(1); });
