#!/usr/bin/env node
/**
 * Task 172 — Gestion des rôles et des permissions : PREUVE E2E RÉELLE.
 *
 * Matrice testée (côté serveur, avec sessions réelles) :
 *   SUPERADMIN : tout est autorisé (liste, création RH/IT, rôle, mot de passe,
 *                activation, suppression) + 400 sur rôle SUPERADMIN attribuable.
 *   IT         : recherche/liste/détail/upload/delete/redetect/indexation/
 *                employes/portal-access → 403 ; users GET → 200 ;
 *                PATCH/DELETE sur compte RH → 403 ; PATCH sur compte IT → 200 ;
 *                création de compte → 403 ; rôle/mot de passe → 403 ;
 *                SMTP (PUT) et tampon (GET) → 403 ; stats/demandes → 200.
 *   RH         : liste fiches + portal-access → 200 ; users → 403.
 *
 * Nettoyage intégral à la fin (comptes de test supprimés par le superadmin,
 * liste vérifiée identique à l'état initial).
 */
"use strict";
const BASE = "http://127.0.0.1:4000";
const ADMIN = { email: "superadmin@autorh.local", password: "AutoRH-2026!Verif#1" };
const MDP_TEST = "AutoRH-2026!T1";

let ok = 0, ko = 0;
function verdict(label, condition, detail) {
  if (condition) { ok++; console.log(`   ✓ ${label}${detail ? " — " + detail : ""}`); }
  else { ko++; console.log(`   ✗ ${label}${detail ? " — " + detail : ""}`); }
}
async function login(email, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, remember: false }),
  });
  const sc = r.headers.get("set-cookie") || "";
  const cookie = sc.split(";")[0];
  return { status: r.status, cookie };
}
function H(cookie) { return { Cookie: cookie, "Content-Type": "application/json" }; }

(async () => {
  console.log("=== TASK 172 : GESTION DES RÔLES ET PERMISSIONS — PREUVE E2E ===");

  // ---------- PHASE 0 : état initial ----------
  const sa = await login(ADMIN.email, ADMIN.password);
  verdict("Connexion superadmin", sa.status === 200 && Boolean(sa.cookie), `HTTP ${sa.status}`);

  let r = await fetch(`${BASE}/api/users`, { headers: H(sa.cookie), cache: "no-store" });
  const etatInitial = await r.json();
  const nbInitial = (etatInitial.users ?? []).length;
  verdict("Liste des comptes (superadmin)", r.status === 200, `${nbInitial} comptes avant tests`);

  // ---------- PHASE 1 : SUPERADMIN crée les comptes de test ----------
  console.log("\n--- PHASE 1 : SUPERADMIN — création et gestion complète ---");
  r = await fetch(`${BASE}/api/users`, {
    method: "POST", headers: H(sa.cookie),
    body: JSON.stringify({ name: "IT Test 172", email: "it-test-172@autorh.local", password: MDP_TEST, role: "IT" }),
  });
  let d = await r.json().catch(() => ({}));
  verdict("Créer un compte IT (POST /api/users)", r.status === 200, d.message || `HTTP ${r.status}`);
  const idIT = d.user?.id;

  r = await fetch(`${BASE}/api/users`, {
    method: "POST", headers: H(sa.cookie),
    body: JSON.stringify({ name: "IT Test 172 bis", email: "it-test-172b@autorh.local", password: MDP_TEST, role: "IT" }),
  });
  d = await r.json().catch(() => ({}));
  verdict("Créer un 2e compte IT (pour test IT↔IT)", r.status === 200);
  const idIT2 = d.user?.id;

  r = await fetch(`${BASE}/api/users`, {
    method: "POST", headers: H(sa.cookie),
    body: JSON.stringify({ name: "RH Test 172", email: "rh-test-172@autorh.local", password: MDP_TEST, role: "RH" }),
  });
  d = await r.json().catch(() => ({}));
  verdict("Créer un compte RH (POST /api/users)", r.status === 200, d.message || `HTTP ${r.status}`);
  const idRH = d.user?.id;

  r = await fetch(`${BASE}/api/users`, {
    method: "POST", headers: H(sa.cookie),
    body: JSON.stringify({ name: "X Y", email: "super-172@autorh.local", password: MDP_TEST, role: "SUPERADMIN" }),
  });
  verdict("Rôle SUPERADMIN refusé à la création (400)", r.status === 400, `HTTP ${r.status}`);

  r = await fetch(`${BASE}/api/users`, {
    method: "POST", headers: H(sa.cookie),
    body: JSON.stringify({ name: "Doublon", email: "rh-test-172@autorh.local", password: MDP_TEST, role: "RH" }),
  });
  verdict("E-mail en double refusé (409)", r.status === 409, `HTTP ${r.status}`);

  // changement de rôle RH -> IT -> RH (superadmin)
  r = await fetch(`${BASE}/api/users/${idRH}/role`, { method: "POST", headers: H(sa.cookie), body: JSON.stringify({ role: "IT" }) });
  verdict("Changer le rôle d'un compte (RH→IT)", r.status === 200);
  r = await fetch(`${BASE}/api/users/${idRH}/role`, { method: "POST", headers: H(sa.cookie), body: JSON.stringify({ role: "RH" }) });
  verdict("Changer le rôle d'un compte (IT→RH)", r.status === 200);

  // réinitialisation d'accès (mot de passe)
  r = await fetch(`${BASE}/api/users/${idRH}/password`, { method: "POST", headers: H(sa.cookie), body: JSON.stringify({ password: MDP_TEST }) });
  verdict("Réinitialiser les accès (mot de passe)", r.status === 200);

  // ---------- PHASE 2 : IT — droits limités ----------
  console.log("\n--- PHASE 2 : IT — fonctionnalités refusées (403) et permises ---");
  const it = await login("it-test-172@autorh.local", MDP_TEST);
  verdict("Connexion IT", it.status === 200 && Boolean(it.cookie), `HTTP ${it.status}`);

  // Fiches : liste / recherche / upload / suppression / maintenance
  r = await fetch(`${BASE}/api/payslips?page=1&limit=10`, { headers: H(it.cookie) });
  verdict("IT : liste « Toutes les fiches » → 403", r.status === 403, `HTTP ${r.status}`);
  r = await fetch(`${BASE}/api/payslips?cin=12345678&page=1`, { headers: H(it.cookie) });
  verdict("IT : recherche par CIN → 403", r.status === 403, `HTTP ${r.status}`);
  r = await fetch(`${BASE}/api/payslips/upload`, { method: "POST", headers: { Cookie: it.cookie } });
  verdict("IT : import de fiches → 403", r.status === 403, `HTTP ${r.status}`);
  r = await fetch(`${BASE}/api/payslips/delete-many`, { method: "POST", headers: H(it.cookie), body: JSON.stringify({ ids: ["x"] }) });
  verdict("IT : suppression multiple de fiches → 403", r.status === 403, `HTTP ${r.status}`);
  r = await fetch(`${BASE}/api/payslips/${idRH}`, { headers: H(it.cookie) });
  verdict("IT : détail d'une fiche → 403", r.status === 403, `HTTP ${r.status}`);
  r = await fetch(`${BASE}/api/payslips/${idRH}/file`, { headers: H(it.cookie) });
  verdict("IT : fichier d'une fiche → 403", r.status === 403, `HTTP ${r.status}`);
  r = await fetch(`${BASE}/api/payslips/employes`, { headers: H(it.cookie) });
  verdict("IT : liste des employés → 403", r.status === 403, `HTTP ${r.status}`);
  r = await fetch(`${BASE}/api/payslips/redetect`, { method: "POST", headers: H(it.cookie) });
  verdict("IT : redétection → 403", r.status === 403, `HTTP ${r.status}`);
  r = await fetch(`${BASE}/api/payslips/indexation`, { method: "POST", headers: H(it.cookie) });
  verdict("IT : indexation (POST) → 403", r.status === 403, `HTTP ${r.status}`);

  // Accès portail employé
  r = await fetch(`${BASE}/api/portal-access`, { headers: H(it.cookie) });
  verdict("IT : liste des accès portail → 403", r.status === 403, `HTTP ${r.status}`);
  r = await fetch(`${BASE}/api/portal-access`, { method: "POST", headers: H(it.cookie), body: JSON.stringify({ action: "create" }) });
  verdict("IT : création d'un accès employé → 403", r.status === 403, `HTTP ${r.status}`);

  // Gestion des comptes : limitée
  r = await fetch(`${BASE}/api/users`, { headers: H(it.cookie) });
  verdict("IT : liste des comptes → 200", r.status === 200, `HTTP ${r.status}`);
  r = await fetch(`${BASE}/api/users`, { method: "POST", headers: H(it.cookie), body: JSON.stringify({ name: "Zz", email: "zz@zz.local", password: MDP_TEST, role: "RH" }) });
  verdict("IT : créer un compte RH → 403", r.status === 403, `HTTP ${r.status}`);
  r = await fetch(`${BASE}/api/users/${idRH}`, { method: "PATCH", headers: H(it.cookie), body: JSON.stringify({ isActive: false }) });
  verdict("IT : désactiver un compte RH → 403", r.status === 403, `HTTP ${r.status}`);
  r = await fetch(`${BASE}/api/users/${idRH}`, { method: "DELETE", headers: H(it.cookie) });
  verdict("IT : supprimer un compte RH → 403", r.status === 403, `HTTP ${r.status}`);
  r = await fetch(`${BASE}/api/users/${idRH}/role`, { method: "POST", headers: H(it.cookie), body: JSON.stringify({ role: "IT" }) });
  verdict("IT : changer un rôle → 403", r.status === 403, `HTTP ${r.status}`);
  r = await fetch(`${BASE}/api/users/${idRH}/password`, { method: "POST", headers: H(it.cookie), body: JSON.stringify({ password: MDP_TEST }) });
  verdict("IT : réinitialiser un mot de passe → 403", r.status === 403, `HTTP ${r.status}`);
  r = await fetch(`${BASE}/api/users/${idIT2}`, { method: "PATCH", headers: H(it.cookie), body: JSON.stringify({ isActive: false }) });
  verdict("IT : désactiver un compte IT → 200", r.status === 200, `HTTP ${r.status}`);
  r = await fetch(`${BASE}/api/users/${idIT2}`, { method: "PATCH", headers: H(it.cookie), body: JSON.stringify({ isActive: true }) });
  verdict("IT : réactiver un compte IT → 200", r.status === 200, `HTTP ${r.status}`);

  // Paramètres + fonctionnalités IT permises
  r = await fetch(`${BASE}/api/mail-config`, { method: "PUT", headers: H(it.cookie), body: JSON.stringify({ host: "smtp.test", port: 25 }) });
  verdict("IT : configuration SMTP → 403", r.status === 403, `HTTP ${r.status}`);
  r = await fetch(`${BASE}/api/signature-config`, { headers: H(it.cookie) });
  verdict("IT : signature/tampon → 403", r.status === 403, `HTTP ${r.status}`);
  r = await fetch(`${BASE}/api/stats`, { headers: H(it.cookie) });
  verdict("IT : statistiques → 200", r.status === 200, `HTTP ${r.status}`);
  r = await fetch(`${BASE}/api/demandes`, { headers: H(it.cookie) });
  verdict("IT : demandes administratives → 200", r.status === 200, `HTTP ${r.status}`);

  // ---------- PHASE 3 : RH — fonctionnalités métier intactes ----------
  console.log("\n--- PHASE 3 : RH — fonctionnalités métier inchangées ---");
  const rh = await login("rh-test-172@autorh.local", MDP_TEST);
  verdict("Connexion RH (mot de passe réinitialisé)", rh.status === 200, `HTTP ${rh.status}`);
  r = await fetch(`${BASE}/api/payslips?page=1&limit=10`, { headers: H(rh.cookie) });
  verdict("RH : liste « Toutes les fiches » → 200", r.status === 200, `HTTP ${r.status}`);
  r = await fetch(`${BASE}/api/payslips?cin=54706561`, { headers: H(rh.cookie) });
  verdict("RH : recherche par CIN → 200", r.status === 200, `HTTP ${r.status}`);
  r = await fetch(`${BASE}/api/portal-access`, { headers: H(rh.cookie) });
  verdict("RH : accès portail → 200", r.status === 200, `HTTP ${r.status}`);
  r = await fetch(`${BASE}/api/signature-config`, { headers: H(rh.cookie) });
  verdict("RH : signature/tampon → 200", r.status === 200, `HTTP ${r.status}`);
  r = await fetch(`${BASE}/api/users`, { headers: H(rh.cookie) });
  verdict("RH : liste des comptes → 403", r.status === 403, `HTTP ${r.status}`);
  r = await fetch(`${BASE}/api/users`, { method: "POST", headers: H(rh.cookie), body: JSON.stringify({ name: "Zz", email: "zz2@zz.local", password: MDP_TEST, role: "RH" }) });
  verdict("RH : créer un compte → 403", r.status === 403, `HTTP ${r.status}`);
  r = await fetch(`${BASE}/api/mail-config`, { method: "PUT", headers: H(rh.cookie), body: JSON.stringify({ host: "smtp.test", port: 25 }) });
  verdict("RH : configuration SMTP → 403", r.status === 403, `HTTP ${r.status}`);

  // ---------- PHASE 4 : nettoyage intégral ----------
  console.log("\n--- PHASE 4 : nettoyage (superadmin) ---");
  for (const [label, id] of [["IT bis", idIT2], ["RH", idRH], ["IT", idIT]]) {
    r = await fetch(`${BASE}/api/users/${id}`, { method: "DELETE", headers: H(sa.cookie) });
    verdict(`Suppression du compte de test ${label}`, r.status === 200, `HTTP ${r.status}`);
  }
  r = await fetch(`${BASE}/api/users`, { headers: H(sa.cookie), cache: "no-store" });
  d = await r.json();
  verdict("Base des comptes restaurée", (d.users ?? []).length === nbInitial, `${(d.users ?? []).length} comptes (initial : ${nbInitial})`);

  console.log(`\n=== RÉSULTAT : ${ok} OK / ${ko} KO ===`);
  if (ko > 0) process.exit(1);
})().catch((e) => { console.error("ERREUR FATALE:", e); process.exit(1); });
