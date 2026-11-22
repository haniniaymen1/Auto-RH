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
// NOUVEAU (v0.2.209) : le mode --assurer peut être appelé sur une installation
// NEUVE (base encore absente) — il crée alors le schéma lui-même.
const { spawnSync } = require("child_process");

// (v0.2.209) AUTO-SUFFISANCE : si DATABASE_URL n'est défini ni par
// l'environnement ni par le .env (chargé ci-dessus), défaut standard du
// projet — ainsi « node scripts/creer-superadmin.js --assurer » fonctionne
// même appelé SANS lanceur (poste neuf, cron, gestion.sh superadmin).
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = `file:${path.join(ROOT, "db", "custom.db")}`;
}

function assurerBase() {
  const fichierBd = path.join(ROOT, "db", "custom.db");
  if (fs.existsSync(fichierBd)) return true;
  // .env sans DATABASE_URL ? Écriture idempotente (même comportement que les
  // lanceurs DEMARRER-*) : sinon « prisma db push » échoue sur une machine neuve.
  const envPath = path.join(ROOT, ".env");
  try {
    let envTexte = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
    if (!/^DATABASE_URL=/m.test(envTexte)) {
      envTexte = envTexte.replace(/\s*$/, "\n") + `DATABASE_URL=file:${fichierBd}\n`;
      fs.writeFileSync(envPath, envTexte, { mode: 0o600 });
    }
  } catch { /* .env non écrivable : l'environnement du processus fera foi */ }
  console.log("Base absente : création du schéma (prisma db push)...");
  const r = spawnSync(
    process.execPath,
    [path.join(ROOT, "node_modules", "prisma", "build", "index.js"), "db", "push"],
    { cwd: ROOT, stdio: "inherit", timeout: 180000 }
  );
  if (r.status !== 0) {
    console.log(COULEUR.rouge("Création du schéma impossible — création automatique annulée."));
    process.exitCode = 1;
    return false;
  }
  return true;
}
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

/**
 * NOUVEAU (v0.2.209) — CRÉATION AUTOMATIQUE du superadministrateur au premier
 * démarrage (mode `--assurer`, appelé par gestion.sh / gestion.ps1 / le moteur
 * silencieux service-paiesage.js et les lanceurs DEMARRER-*).
 *
 * Garanties :
 *  - IDEMPOTENT : si au moins un compte SUPERADMIN ACTIF existe déjà, rien n'est
 *    créé (protection contre les doublons) et le script sort avec le code 0 ;
 *  - identité configurable par le .env (SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD) ;
 *  - sans .env : email par défaut + mot de passe ALÉATOIRE (16 caractères,
 *    toutes les classes) généré ici, affiché UNE SEULE fois et consigné dans
 *    logs/compte-superadmin-initial.txt (permissions 600 sur Linux/macOS) ;
 *  - même hachage scrypt et même chiffrement d'email que l'application
 *    (fonctions partagées ci-dessus, lib-crypto-bd.js) ;
 *  - n'écrase JAMAIS un compte existant : si l'email visé appartient déjà à un
 *    compte, un email de repli est essayé avant d'échouer proprement.
 */
function genererMotDePasse() {
  const min = "abcdefghijkmnopqrstuvwxyz";
  const maj = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const chi = "23456789";
  const sym = "!@#$%*+=?";
  const tous = min + maj + chi + sym;
  // Au moins un caractère de chaque classe, puis remplissage aléatoire.
  const chars = [
    min[crypto.randomInt(min.length)],
    maj[crypto.randomInt(maj.length)],
    chi[crypto.randomInt(chi.length)],
    sym[crypto.randomInt(sym.length)],
  ];
  while (chars.length < 16) chars.push(tous[crypto.randomInt(tous.length)]);
  // Mélange de Fisher-Yates pour ne pas laisser les classes en tête.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function consignerIdentifiants(email, password) {
  const ligne =
    `Compte superadministrateur créé AUTOMATIQUEMENT le ${new Date().toLocaleString("fr-FR")}\n` +
    `  Email    : ${email}\n` +
    `  Mot de passe : ${password}\n\n` +
    `À communiquer à l'administrateur puis SUPPRIMER ce fichier :\n` +
    `  Linux/macOS : rm logs/compte-superadmin-initial.txt\n` +
    `  Windows     : supprimer logs\\compte-superadmin-initial.txt\n`;
  try {
    fs.mkdirSync(path.join(ROOT, "logs"), { recursive: true });
    fs.writeFileSync(path.join(ROOT, "logs", "compte-superadmin-initial.txt"), ligne, { mode: 0o600 });
  } catch {
    /* impossible d'écrire le fichier : le mot de passe reste affiché ci-dessous */
  }
}

async function assurerSuperadminAuto() {
  // Installation neuve : créer d'abord la base (idempotent), sinon rien n'est possible.
  if (!assurerBase()) return;
  // (v0.2.209) POLITIQUE : SUPERADMIN_AUTO=0 (environnement ou .env) désactive
  // la création automatique. Le mode --assurer honore LUI-MÊME la configuration
  // pour rester cohérent même appelé sans lanceur (les lanceurs filtrent déjà
  // en amont — double protection, même comportement Windows / Linux).
  if (String(process.env.SUPERADMIN_AUTO ?? "").trim() === "0") {
    console.log("SUPERADMIN_AUTO=0 : création automatique du superadministrateur désactivée — rien à faire.");
    return;
  }
  const actifs = await prisma.user.count({ where: { role: "SUPERADMIN", isActive: true } });
  if (actifs > 0) {
    console.log(`Superadministrateur déjà présent (${actifs} compte${actifs > 1 ? "s" : ""} actif${actifs > 1 ? "s" : ""}) — rien à créer.`);
    return;
  }
  // Identité : .env (SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD) ou valeurs sûres.
  let email = normaliserEmail(String(process.env.SUPERADMIN_EMAIL || "admin@auto-rh.local"));
  let password = String(process.env.SUPERADMIN_PASSWORD || "");
  const motDePasseGenere = password.length === 0;
  if (motDePasseGenere) password = genererMotDePasse();
  if (!emailValide(email)) {
    console.log(COULEUR.rouge(`SUPERADMIN_EMAIL invalide dans le .env (${email}) — création automatique annulée.`));
    process.exitCode = 1;
    return;
  }
  // L'email visé appartient déjà à un compte non-superadmin : email de repli.
  const existant = await trouverParEmail(email);
  if (existant) {
    if (existant.role === "SUPERADMIN" && existant.isActive) {
      console.log("Superadministrateur déjà présent — rien à créer.");
      return;
    }
    const repli = "superadmin@auto-rh.local";
    if (await trouverParEmail(repli)) {
      console.log(
        COULEUR.rouge(`Création automatique impossible : ${email} et ${repli} sont déjà pris.`) +
          " Définissez SUPERADMIN_EMAIL dans le .env ou utilisez le mode interactif."
      );
      process.exitCode = 1;
      return;
    }
    console.log(COULEUR.jaune(`L'email ${email} est déjà pris — repli sur ${repli}.`));
    email = repli;
  }
  await creerSuperadmin(email, "Superadministrateur", password, "SUPERADMIN");
  if (process.exitCode !== 1) {
    if (motDePasseGenere) {
      consignerIdentifiants(email, password);
      console.log(COULEUR.jaune("Mot de passe généré automatiquement : " + password));
      console.log("Consigné une seule fois dans logs/compte-superadmin-initial.txt — à communiquer puis supprimer.");
    } else {
      console.log("Identifiants issus du .env (SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD) — rien n'est affiché ni consigné.");
    }
  }
}

async function menuInteractif() {
  console.log("");
  console.log("==============================================");
  console.log("  AUTO RH (PaieSage) — Superadministrateur");
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
    } else if (args.includes("--assurer")) {
      // (v0.2.209) Création AUTOMATIQUE au premier démarrage — idempotent.
      await assurerSuperadminAuto();
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
