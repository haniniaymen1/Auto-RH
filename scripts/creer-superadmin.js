#!/usr/bin/env node
/**
 * NOUVEAU (Task 34) : création / gestion du compte SUPERADMINISTRATEUR.
 *
 * Le superadministrateur est le niveau au-dessus de RH et IT :
 *   - liste les comptes, active/désactive, SUPPRIME les comptes RH et IT ;
 *   - réinitialise le mot de passe de n'importe quel compte ;
 *   - bascule le rôle d'un compte RH <-> IT.
 * Il ne peut PAS être créé par l'inscription publique : uniquement ici.
 *
 * Utilisation :
 *   node scripts/creer-superadmin.js                 -> menu interactif
 *   node scripts/creer-superadmin.js --statut        -> état des comptes (lecture seule)
 *   node scripts/creer-superadmin.js --creer --email a@b.tn --nom "Nom" --password XXXX
 *   node scripts/creer-superadmin.js --creer --role RH --email a@b.tn --nom "Nom" --password XXXX
 *   node scripts/creer-superadmin.js --promouvoir --email a@b.tn
 *
 * Multi-OS (Windows / Linux / Mac), aucune dépendance externe.
 * 100 % additif : ce script ne supprime JAMAIS de compte et ne rétrograde
 * JAMAIS de superadministrateur.
 */
"use strict";

const path = require("path");
const fs = require("fs");
const readline = require("readline");
const crypto = require("crypto");
const ROOT = path.join(__dirname, "..");

// ---------- Chargement du .env de la racine (sans écraser l'existant) ----------
(function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  try {
    const contenu = fs.readFileSync(envPath, "utf8");
    for (const ligne of contenu.split(/\r?\n/)) {
      const m = ligne.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
      }
    }
  } catch {
    // pas de .env : on continue avec l'environnement courant
  }
})();

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ log: ["error"] });
// NOUVEAU (Task 34, correctif) : chiffrement des champs sensibles à la source.
// Les scripts utilisent le client Prisma BRUT (sans le middleware de src/lib/db.ts)
// : sans ce chiffrement, les comptes créés ici seraient stockés EN CLAIR dans
// custom.db (contrarie la Task 32) et INCONNUS du serveur (le login cherche la
// valeur chiffrée déterministe). Même bibliothèque que le portail (Task 32).
const cryptoBd = require(path.join(__dirname, "lib-crypto-bd.js"));

/** Recherche un utilisateur par email : valeur chiffrée déterministe OU claire (lignes historiques). */
async function trouverParEmail(email) {
  const emailChiffre = cryptoBd.chiffrerChamp(normaliserEmail(email), true);
  return (
    (await prisma.user.findFirst({ where: { email: emailChiffre } })) ||
    (await prisma.user.findFirst({ where: { email: normaliserEmail(email) } }))
  );
}

// ---------- Hash de mot de passe : format IDENTIQUE à src/lib/auth.ts ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

const COULEUR = {
  vert: (s) => `\x1b[32m${s}\x1b[0m`,
  rouge: (s) => `\x1b[31m${s}\x1b[0m`,
  jaune: (s) => `\x1b[33m${s}\x1b[0m`,
  gris: (s) => `\x1b[90m${s}\x1b[0m`,
};

function emailValide(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function normaliserEmail(email) {
  return String(email || "").trim().toLowerCase();
}

/**
 * (MODIFIÉ Task 34 correctif .bat) Saisie masquée (sans écho) — mode brut avec UN
 * SEUL lecteur de frappes, SANS interface readline.
 * Correctif : l'ancienne version créait l'interface readline AVANT de passer en
 * mode brut — readline ré-échoit alors chaque touche : le mot de passe s'affichait
 * EN CLAIR sur un vrai terminal (double-clic Windows) et les caractères accentués
 * étaient silencieusement avalés (filtre ASCII). Même motif éprouvé que
 * générateurs interactifs du projet (lireMasque), amélioré : UTF-8 complet,
 * séquences d'échappement
 * (flèches) ignorées, Ctrl+U = tout effacer. Repli visible si stdin n'est pas un
 * terminal (entrées redirigées, tests automatisés).
 */
function saisirMasque(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    let peutMasquer = false;
    try {
      if (stdin.isTTY && typeof stdin.setRawMode === "function") {
        stdin.setRawMode(true);
        peutMasquer = true;
      }
    } catch {
      peutMasquer = false;
    }
    if (!peutMasquer) {
      // repli : saisie visible (aucun caractère de contrôle requis)
      const rl = readline.createInterface({ input: stdin, output: process.stdout });
      rl.question(question, (rep) => { rl.close(); resolve(rep.trim()); });
      return;
    }
    // Mode masqué SANS readline : readline ne doit PAS écouter le terminal ici.
    process.stdout.write(question);
    let saisie = "";
    let tampon = Buffer.alloc(0); // accumulateur UTF-8 (é, à, ç… = plusieurs octets)
    let enSequence = false;       // séquence d'échappement en cours (flèches : ignorées)
    const finir = (valeur) => {
      try { stdin.setRawMode(false); } catch {}
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write("\n");
      resolve(valeur);
    };
    const onData = (ch) => {
      tampon = Buffer.concat([tampon, Buffer.isBuffer(ch) ? ch : Buffer.from(String(ch), "utf8")]);
      const texte = tampon.toString("utf8");
      if (Buffer.byteLength(texte, "utf8") !== tampon.length) {
        return; // séquence UTF-8 incomplète : attendre l'octet suivant
      }
      tampon = Buffer.alloc(0);
      for (const c of texte) {
        if (enSequence) {
          if (/[a-zA-Z~]/.test(c)) enSequence = false; // fin de flèche/F1-F12 : ignoré
          continue;
        }
        if (c === "\u001b") { enSequence = true; continue; }
        if (c === "\r" || c === "\n") { finir(saisie.trim()); return; }
        if (c === "\u0003") {
          // Ctrl+C
          process.stdout.write("\n");
          process.exit(130);
        }
        if (c === "\u007f" || c === "\b") {
          if (saisie.length > 0) {
            saisie = saisie.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (c === "\u0015") {
          // Ctrl+U : tout effacer
          while (saisie.length > 0) {
            saisie = saisie.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        // Tout caractère imprimable — ACCENTS INCLUS (é à ç œ …), plus de filtre ASCII
        if (c >= " " && c !== "\u007f") {
          saisie += c;
          process.stdout.write("*");
        }
      }
    };
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function afficherStatut() {
  const users = await prisma.user.findMany({
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: { email: true, name: true, role: true, isActive: true, createdAt: true },
  });
  console.log("");
  console.log("Comptes utilisateurs de l'application :");
  if (users.length === 0) {
    console.log(COULEUR.jaune("  (aucun compte — créez le premier via l'option 2 de ce script)"));
  }
  for (const u of users) {
    const badge =
      u.role === "SUPERADMIN"
        ? COULEUR.jaune("[SUPERADMIN]")
        : u.role === "IT"
          ? COULEUR.gris("[IT         ]")
          : COULEUR.gris("[RH         ]");
    const etat = u.isActive ? COULEUR.vert("actif") : COULEUR.rouge("DESACTIVE");
    // (Task 34 correctif) les emails sont chiffrés en base — déchiffrement pour
    // l'affichage (les valeurs en clair historiques passent telles quelles).
    const emailLisible = cryptoBd.dechiffrerChamp(u.email);
    const nomLisible = cryptoBd.dechiffrerChamp(u.name);
    console.log(`  ${badge} ${String(emailLisible).padEnd(28)} ${String(nomLisible).padEnd(22)} ${etat}`);
  }
  const nbSuperActifs = users.filter((u) => u.role === "SUPERADMIN" && u.isActive).length;
  console.log("");
  console.log(
    nbSuperActifs === 0
      ? COULEUR.rouge("Aucun superadministrateur actif : creez-en un (option 2 ou 3).")
      : COULEUR.vert(`${nbSuperActifs} superadministrateur(s) actif(s).`)
  );
  console.log("");
}

async function creerSuperadmin(email, nom, password, roleCible) {
  email = normaliserEmail(email);
  const role = String(roleCible || "SUPERADMIN").trim().toUpperCase();
  if (!["SUPERADMIN", "RH", "IT"].includes(role)) {
    console.log(COULEUR.rouge("Rôle invalide (SUPERADMIN, RH ou IT)."));
    process.exitCode = 1;
    return;
  }
  if (!emailValide(email)) {
    console.log(COULEUR.rouge("Email invalide."));
    process.exitCode = 1;
    return;
  }
  if (String(nom || "").trim().length < 2) {
    console.log(COULEUR.rouge("Nom trop court (2 caractères minimum)."));
    process.exitCode = 1;
    return;
  }
  if (String(password || "").length < 8) {
    console.log(COULEUR.rouge("Mot de passe trop court (8 caractères minimum)."));
    process.exitCode = 1;
    return;
  }
  const existant = await trouverParEmail(email);
  if (existant) {
    console.log(
      COULEUR.rouge(`Un compte existe déjà avec cet email (${existant.role}).`) +
        " Utilisez l'option 3 (promouvoir) ou un autre email."
    );
    process.exitCode = 1;
    return;
  }
  const user = await prisma.user.create({
    data: {
      // (MODIFIÉ Task 34 correctif) email chiffré DÉTERMINISTE (recherches par
      // égalité du serveur) + nom chiffré à IV aléatoire — identique au
      // middleware de src/lib/db.ts (Task 32) : rien en clair dans custom.db.
      email: cryptoBd.chiffrerChamp(email, true),
      name: cryptoBd.chiffrerChamp(String(nom).trim()),
      role,
      passwordHash: hashPassword(password),
      isActive: true,
    },
  });
  console.log("");
  if (role === "SUPERADMIN") {
    console.log(COULEUR.vert(`Superadministrateur CRÉÉ : ${email} (${String(nom).trim()}).`));
    console.log("Connectez-vous avec cet email sur la page de connexion de l'administration,");
    console.log("l'onglet « Utilisateurs » affichera alors la superadministration complète.");
  } else {
    console.log(COULEUR.vert(`Compte ${role} CRÉÉ : ${email} (${String(nom).trim()}).`));
  }
  console.log("");
}

async function promouvoirSuperadmin(email) {
  email = normaliserEmail(email);
  if (!emailValide(email)) {
    console.log(COULEUR.rouge("Email invalide."));
    process.exitCode = 1;
    return;
  }
  const existant = await trouverParEmail(email);
  if (!existant) {
    console.log(COULEUR.rouge("Aucun compte avec cet email — utilisez l'option 2 (créer)."));
    process.exitCode = 1;
    return;
  }
  if (existant.role === "SUPERADMIN") {
    console.log(COULEUR.jaune("Ce compte est déjà superadministrateur — rien à faire."));
    return;
  }
  if (!existant.isActive) {
    console.log(COULEUR.rouge("Ce compte est DÉSACTIVÉ : réactivez-le d'abord depuis l'onglet Utilisateurs."));
    process.exitCode = 1;
    return;
  }
  await prisma.user.update({ where: { id: existant.id }, data: { role: "SUPERADMIN" } });
  console.log("");
  console.log(COULEUR.vert(`${email} est désormais SUPERADMINISTRATEUR.`));
  console.log("Il doit se RECONNECTER pour que le nouveau rôle prenne effet.");
  console.log("");
}

async function menuInteractif() {
  console.log("");
  console.log("==============================================");
  console.log("  SERVICE RH — Superadministrateur (Task 34)");
  console.log("==============================================");
  console.log("  1) Voir l'état des comptes");
  console.log("  2) CRÉER un compte superadministrateur");
  console.log("  3) PROMOUVOIR un compte existant en superadministrateur");
  console.log("  4) Quitter");
  console.log("");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const choix = await new Promise((r) => rl.question("Votre choix (1-4) : ", (rep) => { r(rep.trim()); }));

  if (choix === "1") {
    rl.close();
    await afficherStatut();
    return;
  }
  if (choix === "2") {
    const email = await new Promise((r) => rl.question("Email du nouveau superadministrateur : ", (x) => r(x)));
    const nom = await new Promise((r) => rl.question("Nom complet affiché (ex. Ahmed Ben Salah) : ", (x) => r(x)));
    rl.close();
    const mdp1 = await saisirMasque("Mot de passe (8 caractères minimum, saisie masquée) : ");
    const mdp2 = await saisirMasque("Confirmez le mot de passe : ");
    if (mdp1 !== mdp2) {
      console.log(COULEUR.rouge("Les deux mots de passe ne correspondent pas — abandon."));
      process.exitCode = 1;
      return;
    }
    await creerSuperadmin(email, nom, mdp1);
    return;
  }
  if (choix === "3") {
    const email = await new Promise((r) => rl.question("Email du compte à promouvoir : ", (x) => r(x)));
    rl.close();
    await promouvoirSuperadmin(email);
    return;
  }
  rl.close();
  console.log("Au revoir.");
}

(async () => {
  const args = process.argv.slice(2);
  try {
    const argVal = (nom) => {
      const i = args.indexOf(nom);
      return i >= 0 ? args[i + 1] : undefined;
    };
    if (args.includes("--statut")) {
      await afficherStatut();
    } else if (args.includes("--creer")) {
      await creerSuperadmin(argVal("--email"), argVal("--nom"), argVal("--password"), argVal("--role"));
    } else if (args.includes("--promouvoir")) {
      await promouvoirSuperadmin(argVal("--email"));
    } else {
      await menuInteractif();
    }
  } catch (e) {
    console.error(COULEUR.rouge(`Erreur : ${e && e.message ? e.message : e}`));
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
