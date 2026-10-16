/**
 * ============================================================================
 *  CHIFFRER LA BASE DE DONNÉES — migration des lignes existantes (Task 32)
 * ============================================================================
 *
 *  L'application chiffre désormais les champs sensibles À L'ÉCRITURE
 *  (middleware Prisma, voir src/lib/db.ts + src/lib/db-crypto.ts). Ce script
 *  chiffre (ou déchiffre avec --dechiffrer) les lignes DÉJÀ PRÉSENTES dans
 *  db/custom.db — les 107 fiches importées avant cette mise à niveau, les
 *  accès portail TOTP, les comptes RH/IT et les journaux d'import.
 *
 *  UTILISATION (Windows comme Linux/Mac) :
 *
 *    1) ARRÊTER les serveurs (ARRETER-SILENCIEUX-WINDOWS.vbs ou fermer les
 *       fenêtres CMD) — SQLite n'accepte qu'un seul écrivain.
 *    2) node scripts\chiffrer-base.js             → chiffre tout (défaut)
 *       node scripts\chiffrer-base.js --statut    → état sans rien modifier
 *       node scripts\chiffrer-base.js --dechiffrer→ retour arrière (rollback)
 *    3) Redémarrer les serveurs (DEMARRER-SILENCIEUX-WINDOWS.vbs …).
 *
 *  SÉCURITÉ :
 *    - une SAUVEGARDE AUTOMATIQUE du fichier de base est créée AVANT toute
 *      modification (db/custom.db.avant-chiffrement-<date>) ;
 *    - le chiffrement est IDEMPOTENT : relancer le script ne rechiffre jamais
 *      une valeur déjà chiffrée (préfixe encbd1: / encbd1d:) ;
 *    - la clé est dérivée de AUTO_RH_STORAGE_KEY (repli AUTH_SECRET) —
 *      NE PAS PERDRE cette clé (sinon la base devient illisible).
 * ============================================================================
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cryptoBd = require("./lib-crypto-bd.js");

const ROOT = path.join(__dirname, "..");

/* ---------------- Chargement du .env (même mécanisme que le portail) ------ */
(function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  }
})();

/* ---------------- Résolution du fichier de base --------------------------- */
function cheminBase() {
  const url = String(process.env.DATABASE_URL || "");
  const m = url.match(/^file:(.+)$/i);
  if (m) return path.resolve(m[1]);
  return path.join(ROOT, "db", "custom.db");
}

/* ---------------- Sauvegarde automatique ---------------------------------- */
function sauvegarderBase(raison) {
  const dbPath = cheminBase();
  if (!fs.existsSync(dbPath)) return null;
  const horodatage = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "-");
  const cible = dbPath + ".avant-" + raison + "-" + horodatage;
  fs.copyFileSync(dbPath, cible);
  for (const ext of ["-wal", "-shm"]) {
    const f = dbPath + ext;
    if (fs.existsSync(f)) fs.copyFileSync(f, cible + ext);
  }
  return cible;
}

/* ---------------- Traitement ------------------------------------------------ */
const { PrismaClient } = require("@prisma/client");

const MODELES = [
  { nom: "Payslip", prisma: "payslip", libelle: "Fiches de paie" },
  { nom: "PortalAccess", prisma: "portalAccess", libelle: "Accès portail (TOTP)" },
  { nom: "User", prisma: "user", libelle: "Comptes RH/IT" },
  { nom: "ImportLog", prisma: "importLog", libelle: "Journal des imports" },
];

function champsDe(modele) {
  const c = cryptoBd.CARTE_CHAMPS[modele];
  return { det: c.det, alea: c.alea, tous: [...c.det, ...c.alea] };
}

function compteStatut(valeurs) {
  let chiffres = 0;
  let clairs = 0;
  let vides = 0;
  for (const v of valeurs) {
    if (v === null || v === undefined || v === "") vides++;
    else if (cryptoBd.estChiffre(v)) chiffres++;
    else clairs++;
  }
  return { chiffres, clairs, vides };
}

async function principal() {
  const options = process.argv.slice(2);
  const modeStatut = options.includes("--statut");
  const modeDechiffrer = options.includes("--dechiffrer");
  const mode = modeStatut ? "STATUT" : modeDechiffrer ? "DECHIFFREMENT" : "CHIFFREMENT";

  console.log("============================================================");
  console.log("  Auto-RH — " + (modeStatut ? "État du chiffrement de la base" : modeDechiffrer ? "DÉCHIFFREMENT de la base (retour arrière)" : "CHIFFREMENT de la base de données"));
  console.log("  Base : " + cheminBase());
  console.log("  Clé  : " + (process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY ? "AUTO_RH_STORAGE_KEY (.env)" : process.env.AUTH_SECRET ? "AUTH_SECRET (.env, repli)" : "⚠ AUCUNE CLÉ — valeurs de repli par défaut !"));
  console.log("============================================================");

  if (!fs.existsSync(cheminBase())) {
    console.error("\nERREUR : base introuvable (" + cheminBase() + ").");
    process.exit(1);
  }
  if (!process.env.AUTO_RH_STORAGE_KEY && !process.env.AUTH_SECRET) {
    console.error(
      "\nERREUR : ni AUTO_RH_STORAGE_KEY ni AUTH_SECRET dans .env — " +
        "impossible de dériver la clé. Le .env du site est-il présent ?"
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  let modifications = 0;
  const resume = [];

  // SAUVEGARDE AUTOMATIQUE AVANT TOUTE MODIFICATION (chiffrement OU déchiffrement)
  let cheminSauvegarde = null;
  if (!modeStatut) {
    try {
      cheminSauvegarde = sauvegarderBase(modeDechiffrer ? "dechiffrement" : "chiffrement");
      if (cheminSauvegarde) {
        console.log("\nSauvegarde automatique créée : " + path.basename(cheminSauvegarde));
      }
    } catch (e) {
      console.error("\nERREUR : sauvegarde impossible (" + (e && e.message ? e.message : e) + ") — arrêt sans modification.");
      process.exit(1);
    }
  }

  try {
    for (const modele of MODELES) {
      const champs = champsDe(modele.nom);
      const lignes = await prisma[modele.prisma].findMany({
        select: Object.fromEntries([["id", true], ...champs.tous.map((c) => [c, true])]),
      });
      const stats = {};
      for (const c of champs.tous) {
        stats[c] = compteStatut(lignes.map((l) => l[c]));
      }
      resume.push({ modele, stats, total: lignes.length });

      if (modeStatut) continue; // lecture seule

      for (const ligne of lignes) {
        const miseAJour = {};
        for (const c of champs.tous) {
          const v = ligne[c];
          if (v === null || v === undefined || v === "") continue;
          const dejaChiffre = cryptoBd.estChiffre(v);
          if (modeDechiffrer) {
            if (dejaChiffre) miseAJour[c] = cryptoBd.dechiffrerChamp(v);
          } else if (!dejaChiffre) {
            const det = champs.det.includes(c);
            miseAJour[c] = cryptoBd.chiffrerChamp(v, det);
          }
        }
        if (Object.keys(miseAJour).length > 0) {
          await prisma[modele.prisma].update({
            where: { id: ligne.id },
            data: miseAJour,
          });
          modifications++;
        }
      }
    }
  } catch (e) {
    console.error("\nERREUR : " + (e && e.message ? e.message : e));
    const msg = String(e && e.message ? e.message : e);
    if (/locked|busy/i.test(msg)) {
      console.error(
        "\n→ La base est VERROUILLÉE : les serveurs sont probablement encore " +
          "lancés. Arrêtez-les (ARRETER-SILENCIEUX-WINDOWS.vbs) puis relancez."
      );
    }
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  }

  // (NOUVEAU) après une modification, les statistiques affichées sont
  // RECALCULÉES sur la base finale — le rapport reflète l'état RÉEL obtenu.
  if (!modeStatut && modifications > 0) {
    resume.length = 0;
    for (const modele of MODELES) {
      const champs = champsDe(modele.nom);
      const lignes = await prisma[modele.prisma].findMany({
        select: Object.fromEntries([["id", true], ...champs.tous.map((c) => [c, true])]),
      });
      const stats = {};
      for (const c of champs.tous) {
        stats[c] = compteStatut(lignes.map((l) => l[c]));
      }
      resume.push({ modele, stats, total: lignes.length });
    }
  }

  // (ESSENTIEL) SQLite conserve les ANCIENNES valeurs dans ses pages libres
  // après un update : sans VACUUM, un examen brut du fichier retrouverait les
  // données claires d'origine. La base est donc intégralement réécrite
  // (wal_checkpoint + VACUUM) — seules les valeurs CHIFFRÉES subsistent.
  if (!modeStatut) {
    try {
      await prisma.$executeRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE);");
    } catch {}
    try {
      await prisma.$executeRawUnsafe("VACUUM");
      console.log("\nRéécriture propre de la base (VACUUM) : les anciennes pages en clair sont effacées.");
    } catch (e) {
      console.log(
        "\n⚠ VACUUM impossible (" + (e && e.message ? e.message : e) + ")." +
          "\n  Les données lisibles par les applications sont chiffrées, mais des traces" +
          "\n  des anciennes valeurs peuvent subsister dans l'espace libre du fichier." +
          "\n  Exécutez VACUUM via n'importe quel outil SQLite pour les effacer."
      );
    }
  }

  /* ---------------- Rapport ---------------- */
  console.log("\n--- État FINAL par modèle (champ : chiffrés / clairs / vides) ---");
  for (const r of resume) {
    console.log("\n" + r.modele.libelle + " (" + r.total + " ligne" + (r.total > 1 ? "s" : "") + ") :");
    for (const [champ, s] of Object.entries(r.stats)) {
      console.log(
        "   " + champ.padEnd(20) + " : " +
          s.chiffres + " chiffré(s), " +
          s.clairs + " en clair, " +
          s.vides + " vide(s)"
      );
    }
  }

  if (!modeStatut) {
    console.log(
      "\nLignes modifiées : " + modifications + " (" +
        (modeDechiffrer ? "déchiffrées" : "chiffrées") + ")"
    );
  }

  if (modeStatut) {
    const reste = resume.reduce(
      (n, r) =>
        n + Object.values(r.stats).reduce((m, s) => m + s.clairs, 0),
      0
    );
    console.log(
      "\nCONCLUSION : " +
        (reste === 0
          ? "tous les champs sensibles sont CHIFFRÉS ✔"
          : reste + " valeur(s) encore en clair — lancez : node scripts/chiffrer-base.js")
    );
  }
  if (!modeStatut) {
    console.log(
      "\nTerminé ✔" +
        (cheminSauvegarde ? "\nSauvegarde automatique de la base : " + path.basename(cheminSauvegarde) : "")
    );
    console.log(
      modeDechiffrer
        ? "Vous pouvez redémarrer les serveurs (la base est revenue en clair)."
        : "Redémarrez les serveurs (DEMARRER-SILENCIEUX-WINDOWS.vbs ou .bat habituel).\n" +
            "Vérifiez ensuite : node scripts/chiffrer-base.js --statut"
    );
  }

  await prisma.$disconnect();
}

principal();
