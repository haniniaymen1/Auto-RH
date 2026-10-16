#!/usr/bin/env node
// Task 208 — preuve anti force-brute : 11 mauvais mots de passe depuis une IP
// de test → 401 ×10 puis 429, et journalisation dans logs/auth-securite.log.
const BASE = "http://localhost:4000";
const IP = "9.9.9.9"; // IP factice (le limiteur fait confiance à x-forwarded-for)
const EMAIL = "superadmin@autorh.local";

async function tentative(n) {
  const res = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": IP },
    body: JSON.stringify({ email: EMAIL, password: "Mauvais-Mdp-" + n + "!" }),
  });
  return res.status;
}
(async () => {
  for (let i = 1; i <= 11; i++) {
    const s = await tentative(i);
    console.log("essai " + i + " -> HTTP " + s + (s === 429 ? "  ← VERROUILLÉ" : ""));
  }
})();
