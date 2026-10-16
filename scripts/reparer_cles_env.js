#!/usr/bin/env node
/**
 * Task 178 — RÉPARATION : perte des clés de chiffrement (.env) lors des
 * réinitialisations d'environnement, rendant le compte superadmin
 * introuvable au login (« Email ou mot de passe incorrect »).
 *
 * CAUSE : la base conservée avait été chiffrée avec l'ANCIENNE clé ; le .env
 * courant ne contient plus ni AUTH_SECRET ni AUTO_RH_STORAGE_KEY → l'app
 * retombe sur la clé par défaut → le chiffrement DÉTERMINISTE de l'e-mail
 * saisi ne correspond plus au chiffrement stocké → findUnique ne trouve
 * AUCUN compte → 401 systématique (mot de passe pourtant correct).
 *
 * RÉPARATION (minimale, données à risque quasi nulles : 0 fiche, 0 accès,
 * 0 demande) :
 *   1. GÉNÈRE de nouvelles clés AUTH_SECRET + AUTO_RH_STORAGE_KEY → .env
 *      (chmod 600) + copie vers .next/standalone/.env ;
 *   2. RÉÉCRIT le compte superadmin avec la NOUVELLE clé :
 *      email chiffré DÉTERMINISTE (superadmin@autorh.local), nom chiffré
 *      aléatoire (Superadministrateur) ; passwordHash scrypt CONSERVÉ
 *      (mot de passe inchangé : AutoRH-2026!Verif#1) ;
 *   3. PURGE les ImportLog (6 lignes de diagnostic illisibles avec la
 *      nouvelle clé — éviterait des erreurs d'affichage du journal).
 *
 * Idempotent : chaque exécution régénère les clés et réécrit le compte.
 * Après exécution : redémarrer les services (les serveurs lisent .env au
 * démarrage) puis se connecter avec superadmin@autorh.local /
 * AutoRH-2026!Verif#1.
 */
"use strict";
process.chdir(__dirname + "/..");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

// ---- Constantes IDENTIQUES à src/lib/db-crypto.ts -------------------------
const PREFIXE_DET = "encbd1d:";
const SEL_CLE_ALEA = "autorh-db-aleatoire-v1";
const SEL_CLE_DET = "autorh-db-deterministe-v1";
const SEL_CLE_MAC = "autorh-db-mac-v1";
const TAILLE_IV = 12;

// ---- Chiffrement avec la NOUVELLE clé ------------------------------------
function cles(secret) {
  return {
    alea: crypto.scryptSync(secret, SEL_CLE_ALEA, 32),
    det: crypto.scryptSync(secret, SEL_CLE_DET, 32),
    mac: crypto.scryptSync(secret, SEL_CLE_MAC, 32),
  };
}
function chiffrerDet(secret, texte) {
  const k = cles(secret);
  const iv = crypto.createHmac("sha256", k.mac).update(texte, "utf8").digest().subarray(0, TAILLE_IV);
  const c = crypto.createCipheriv("aes-256-gcm", k.det, iv);
  const donnees = Buffer.concat([c.update(texte, "utf8"), c.final()]);
  return PREFIXE_DET + iv.toString("base64") + ":" + c.getAuthTag().toString("base64") + ":" + donnees.toString("base64");
}
function chiffrerAlea(secret, texte) {
  const k = cles(secret);
  const iv = crypto.randomBytes(TAILLE_IV);
  const c = crypto.createCipheriv("aes-256-gcm", k.alea, iv);
  const donnees = Buffer.concat([c.update(texte, "utf8"), c.final()]);
  return "encbd1:" + iv.toString("base64") + ":" + c.getAuthTag().toString("base64") + ":" + donnees.toString("base64");
}

async function main() {
  const EMAIL = "superadmin@autorh.local";
  const NOM = "Superadministrateur";

  // 1) Nouvelles clés
  const authSecret = crypto.randomBytes(48).toString("base64url");
  const storageKey = crypto.randomBytes(48).toString("base64url");

  // 2) .env : conserve DATABASE_URL, ajoute/remplace les deux clés
  const cheminEnv = path.resolve(".env");
  const lignesActuelles = fs.existsSync(cheminEnv) ? fs.readFileSync(cheminEnv, "utf8").split(/\r?\n/) : [];
  const autres = lignesActuelles.filter(
    (l) => l.trim() && !/^(AUTH_SECRET|AUTO_RH_STORAGE_KEY)\s*=/.test(l.trim())
  );
  const contenu = [...autres, `AUTH_SECRET=${authSecret}`, `AUTO_RH_STORAGE_KEY=${storageKey}`, ""].join("\n");
  fs.writeFileSync(cheminEnv, contenu, { mode: 0o600 });
  fs.chmodSync(cheminEnv, 0o600);
  console.log("OK  .env mis à jour (AUTH_SECRET + AUTO_RH_STORAGE_KEY nouveaux, chmod 600)");

  // 2 bis) copie vers le build standalone (lu par le serveur 4000/4001)
  const cibleStandalone = path.resolve(".next/standalone/.env");
  try {
    fs.copyFileSync(cheminEnv, cibleStandalone);
    fs.chmodSync(cibleStandalone, 0o600);
    console.log("OK  .next/standalone/.env synchronisé");
  } catch (e) {
    console.log("WARN standalone/.env non copié :", e.message);
  }

  // 3) Réécriture du compte superadmin avec la nouvelle clé
  const nouveauEmail = chiffrerDet(storageKey, EMAIL);
  const nouveauNom = chiffrerAlea(storageKey, NOM);
  const comptes = await db.user.findMany();
  for (const u of comptes) {
    await db.user.update({
      where: { id: u.id },
      data: { email: nouveauEmail, name: nouveauNom },
    });
  }
  console.log(`OK  ${comptes.length} compte(s) réécrit(s) avec la nouvelle clé (email det + nom alea)`);
  console.log(`    Mot de passe CONSERVÉ : AutoRH-2026!Verif#1 (hachage scrypt intact)`);

  // 4) Purge des ImportLog illisibles avec la nouvelle clé
  const supprimes = await db.importLog.deleteMany({});
  console.log(`OK  ImportLog purgés : ${supprimes.count} ligne(s) (journal de diagnostic)`);
  console.log("\n→ REDÉMARREZ les services : node scripts/auto-rh.js restart");
  console.log(`→ Connexion : ${EMAIL} / AutoRH-2026!Verif#1`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error("ERREUR:", e);
  process.exit(1);
});
