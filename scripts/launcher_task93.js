#!/usr/bin/env node
/**
 * ============================================================
 *  Lanceur de TEST Task 93 — réplique FIDÈLEMENT la chaîne
 *  « fichier .env -> start-prod.js -> process.env -> application »
 *  sur un .env DE SANDBOX (AUTO_RH_DOTENV / DOTENV_PATH), sans
 *  toucher au .env réel ni à la base réelle.
 * ============================================================
 *  Le bloc de lecture .env ci-dessous est la COPIE EXACTE de
 *  scripts/start-prod.js (même regex, même règle « ne pas
 *  écraser les variables déjà présentes »). Le serveur standalone
 *  est ensuite requis exactement comme le fait start-prod.js.
 * ============================================================
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SERVER = path.join(ROOT, ".next", "standalone", "server.js");
const DOTENV = process.env.DOTENV_PATH
  ? path.resolve(process.env.DOTENV_PATH)
  : path.join(ROOT, ".env");

if (!fs.existsSync(SERVER)) {
  console.error("Build standalone introuvable : " + SERVER);
  process.exit(1);
}

process.env.NODE_ENV = "production";
if (!process.env.PORT) process.env.PORT = "4310";
if (!process.env.HOSTNAME) process.env.HOSTNAME = "127.0.0.1";
if (!process.env.AUTO_RH_ROOT) process.env.AUTO_RH_ROOT = ROOT;
if (!process.env.AUTO_RH_STORAGE_DIR)
  process.env.AUTO_RH_STORAGE_DIR = path.join(ROOT, "storage", "payslips");

// ---- COPIE EXACTE du chargement .env de start-prod.js (fichier -> env) ----
if (fs.existsSync(DOTENV)) {
  for (const line of fs.readFileSync(DOTENV, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

// Aucun db push / copie de ressources ici : le bac à sable est prêt.
require(SERVER);
