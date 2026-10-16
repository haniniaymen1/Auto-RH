/**
 * Reproduction de l'erreur « Erreur serveur » configuration SMTP/IMAP.
 * Parcours exact de l'interface admin :4000 :
 *   1. Connexion superadmin
 *   2. GET  /api/mail-config        (chargement du panneau)
 *   3. PUT  /api/mail-config        (enregistrement)
 *   4. POST /api/mail-config test   (e-mail de test SMTP)
 *   5. POST /api/mail-config test-imap (test de connexion IMAP)
 */
const BASE = "http://localhost:4000";

function cookieFrom(res) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return set.map((c) => c.split(";")[0]).join("; ");
}

async function main() {
  // 1. Connexion
  const login = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "lab-e2e-116@autorh.local",
      password: "Lab116-e2e-71a50dccbbc8",
    }),
  });
  const cookie = cookieFrom(login);
  console.log("1) LOGIN:", login.status, cookie ? "(session OK)" : "(PAS de cookie)");

  // 2. GET mail-config (chargement du panneau)
  const get = await fetch(BASE + "/api/mail-config", { headers: { cookie } });
  const getBody = await get.json().catch(() => ({}));
  console.log("2) GET  /api/mail-config:", get.status);
  if (get.status !== 200) console.log("   → CORPS:", JSON.stringify(getBody));
  else {
    console.log("   host:", getBody.config?.host, "| port:", getBody.config?.port,
      "| imapActif:", getBody.config?.imapActif, "| imapHost:", getBody.config?.imapHost,
      "| imapPort:", getBody.config?.imapPort, "| hasPassword:", getBody.config?.hasPassword);
  }

  // 3. PUT mail-config (enregistrement — identique aux valeurs actuelles)
  const cfg = getBody.config ?? {};
  const put = await fetch(BASE + "/api/mail-config", {
    method: "PUT",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({
      host: cfg.host || "smtp.gmail.com",
      port: cfg.port || 465,
      username: cfg.username || "employe.test@autorh.tn",
      password: "", // vide = inchangé
      from: cfg.from || "AutoRH Auto-RH <employe.test@autorh.tn>",
      serveurAdresse: cfg.serveurAdresse || "",
      sitePort: cfg.sitePort || "",
      portailUrl: cfg.portailUrl || "",
      rhEmail: cfg.rhEmail || "",
      itEmail: cfg.itEmail || "",
      responsablesMap: cfg.responsablesMap || "",
      parrainageEmail: cfg.parrainageEmail || "",
      attestationTravailEmail: cfg.attestationTravailEmail || "",
      attestationSalaireEmail: cfg.attestationSalaireEmail || "",
      congeEmail: cfg.congeEmail || "",
      autorisationEmail: cfg.autorisationEmail || "",
      imapActif: cfg.imapActif !== false,
      imapHost: cfg.imapHost || "imap.gmail.com",
      imapPort: cfg.imapPort || 993,
      imapUser: cfg.imapUser || "employe.test@autorh.tn",
      imapPassword: "", // vide = inchangé
    }),
  });
  const putBody = await put.json().catch(() => ({}));
  console.log("3) PUT  /api/mail-config:", put.status, put.status !== 200 ? "→ " + JSON.stringify(putBody) : "(enregistré)");

  // 4. POST test SMTP (e-mail de test réel)
  const testSmtp = await fetch(BASE + "/api/mail-config", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ action: "test", dest: "employe.test@autorh.tn" }),
  });
  const smtpBody = await testSmtp.json().catch(() => ({}));
  console.log("4) POST test SMTP:", testSmtp.status, smtpBody.ok ? "→ OK (" + (smtpBody.message || "").slice(0, 60) + ")" : "→ " + JSON.stringify(smtpBody).slice(0, 300));

  // 5. POST test IMAP (connexion réelle)
  const testImap = await fetch(BASE + "/api/mail-config", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ action: "test-imap" }),
  });
  const imapBody = await testImap.json().catch(() => ({}));
  console.log("5) POST test IMAP:", testImap.status, imapBody.ok ? "→ OK" : "→ " + JSON.stringify(imapBody).slice(0, 500));
  if (imapBody.etapes) imapBody.etapes.forEach((e) => console.log("   - [" + (e.ok ? "OK" : "KO") + "] " + e.etape + (e.detail ? " — " + e.detail : "")));
}

main().catch((e) => {
  console.error("ERREUR SCRIPT:", e);
  process.exit(1);
});
