/**
 * Génère une clé secrète aléatoire (256 bits) pour signer les sessions.
 * Utilisé par les scripts de démarrage :  node scripts/gen-secret.js
 */
console.log(require("crypto").randomBytes(32).toString("hex"));
