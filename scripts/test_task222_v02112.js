/**
 * PREUVE E2E — Task 222 / v0.2.112
 * « Importer les certificats électroniques + leurs clés privées associées dans
 *   la réponse aux demandes ET l'importation fiche de paie »
 *
 * Scénarios (les trois de la demande, sur les DEUX sections Import et Réponses) :
 *   1. CERTIFICAT SEUL quand la clé privée est DÉJÀ DISPONIBLE dans le système
 *      → accepté, association VÉRIFIÉE (appariement cryptographique) ;
 *      appariement négatif → erreur explicite (jamais d'association aveugle) ;
 *   2. CERTIFICAT ACCOMPAGNÉ DE SA CLÉ PRIVÉE → coffre .p12/.pfx OU clé
 *      séparée .pem/.key/.der (PKCS#8/PKCS#1, clair ou chiffré) ; PEM combiné
 *      (CERTIFICATE + PRIVATE KEY) reconnu — clé extraite automatiquement ;
 *   3. FORMATS APPROPRIÉS — .p12/.pfx pour cert+clé, .pem/.cer/… pour un
 *      certificat seul, .pem/.key/.der pour une clé privée.
 *   + erreurs CLASSÉES (mot de passe blâmé SEULEMENT sur refus explicite),
 *   + secrets jamais renvoyés (certMotDePasse / certCleMotDePasse absents),
 *   + IT toujours 403 (double protection historique).
 */
const fs = require("fs");
const path = require("path");

const BASE = "http://127.0.0.1:4000";
const LABO = path.join(__dirname, "p12lab");
const ADMIN = { email: "superadmin@autorh.local", password: "AutoRH-2026!Verif#1" };
const MDP_P12 = "MotDePasse123";

let ok = 0, ko = 0;
function verdict(label, condition, detail) {
  if (condition) { ok++; console.log(`   ✓ ${label}${detail ? " — " + detail : ""}`); }
  else { ko++; console.log(`   ✗ ${label}${detail ? " — " + detail : ""}`); }
}
function b64(fichier) {
  return fs.readFileSync(path.join(LABO, fichier)).toString("base64");
}
async function creerClient(email, motDePasse) {
  let cookie = "";
  const req = async (method, p, corps) => {
    const res = await fetch(BASE + p, {
      method,
      headers: {
        ...(corps !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: corps === undefined ? undefined : JSON.stringify(corps),
      redirect: "manual",
    });
    const setC = res.headers.get("set-cookie");
    if (setC) cookie = setC.split(";")[0];
    return res;
  };
  const r = await req("POST", "/api/auth/login", { email, password: motDePasse });
  if (!r.ok) throw new Error("Connexion impossible pour " + email);
  return { req };
}
function sansSecrets(cfg) {
  return !("certMotDePasse" in cfg) && !("certCleMotDePasse" in cfg);
}

(async () => {
  console.log("=== Task 222 — certificats électroniques + clés privées associées ===\n");
  const admin = await creerClient(ADMIN.email, ADMIN.password);

  // ---------- Section A : IMPORT FICHE DE PAIE (onglet Importation) ----------
  console.log("--- A. Section Import (importation fiche de paie) ---");

  // A0 — état initial propre (retrait éventuel de tests précédents)
  const cfg0 = await (await admin.req("GET", "/api/signature-config")).json();
  verdict("A0. GET config initial", cfg0.config && sansSecrets(cfg0.config));

  // A1 — certificat SEUL (.pem, paire A) sans clé : accepté, clé NON disponible
  let r = await admin.req("PUT", "/api/signature-config", {
    certFichier: b64("cert.pem"), certFichierNom: "cert.pem",
  });
  let d = await r.json().catch(() => ({}));
  verdict("A1. certificat SEUL (.pem) accepté", r.status === 200 && d.config?.certFormat === "X.509");
  verdict("A2. clé privée NON disponible (aucune clé enregistrée)", d.config?.certClePriveeDisponible === false);

  // A3 — clé privée SÉPARÉE seule (PKCS#1, paire A) appariée au certificat
  r = await admin.req("PUT", "/api/signature-config", {
    certCleFichier: b64("cle222-pkcs1.key"), certCleFichierNom: "cle222-pkcs1.key",
  });
  d = await r.json().catch(() => ({}));
  verdict("A3. clé privée séparée (.key PKCS#1) acceptée", r.status === 200);
  verdict("A4. clé privée DISPONIBLE (calculée)", d.config?.certClePriveeDisponible === true);
  verdict("A5. type affiché RSA 2048 bits", /RSA 2048/.test(String(d.config?.certCleType ?? "")));

  // A6 — clé CHIFFRÉE sans mot de passe → erreur CLASSÉE « protégée »
  r = await admin.req("PUT", "/api/signature-config", {
    certCleFichier: b64("cle-a-chiffree.key"), certCleFichierNom: "cle-a-chiffree.key",
  });
  d = await r.json().catch(() => ({}));
  verdict("A6. clé chiffrée SANS mot de passe → « Clé privée protégée »",
    r.status === 400 && /Clé privée protégée/.test(String(d.error ?? "")));

  // A7 — clé CHIFFRÉE + MAUVAIS mot de passe → « mot de passe incorrect »
  r = await admin.req("PUT", "/api/signature-config", {
    certCleFichier: b64("cle-a-chiffree.key"), certCleFichierNom: "cle-a-chiffree.key",
    certCleMotDePasse: "Faux123!",
  });
  d = await r.json().catch(() => ({}));
  verdict("A7. clé chiffrée + mauvais mot de passe → « Mot de passe de la clé privée incorrect »",
    r.status === 400 && /Mot de passe de la clé privée incorrect/.test(String(d.error ?? "")));

  // A8 — clé CHIFFRÉE + BON mot de passe → acceptée (paire A, appariée au cert A)
  r = await admin.req("PUT", "/api/signature-config", {
    certCleFichier: b64("cle-a-chiffree.key"), certCleFichierNom: "cle-a-chiffree.key",
    certCleMotDePasse: "SecretCle222",
  });
  d = await r.json().catch(() => ({}));
  verdict("A8. clé chiffrée + BON mot de passe acceptée", r.status === 200, d.error ?? "");
  verdict("A9. mot de passe clé enregistré (booléen, secret jamais renvoyé)",
    d.config?.certCleMotDePasseEnregistre === true && sansSecrets(d.config ?? {}));

  // A10 — clé NON APARIÉE (paire B) contre certificat A → refus explicite
  r = await admin.req("PUT", "/api/signature-config", {
    certCleFichier: b64("cle222-pkcs8.key"), certCleFichierNom: "cle222-pkcs8.key",
  });
  d = await r.json().catch(() => ({}));
  verdict("A10. clé ≠ certificat → « ne correspond pas au certificat »",
    r.status === 400 && /ne correspond pas au certificat/.test(String(d.error ?? "")));

  // A11 — CERTIFICAT SEUL (paire B) quand la clé A est déjà disponible → REFUS
  r = await admin.req("PUT", "/api/signature-config", {
    certFichier: b64("cert222.pem"), certFichierNom: "cert222.pem",
  });
  d = await r.json().catch(() => ({}));
  verdict("A11. certificat ≠ clé déjà disponible → refus explicite",
    r.status === 400 && /ne correspond pas à la clé privée déjà disponible/.test(String(d.error ?? "")));

  // A12 — CERTIFICAT SEUL (paire A) quand SA clé est déjà disponible → ACCEPTÉ
  r = await admin.req("PUT", "/api/signature-config", {
    certFichier: b64("cert.pem"), certFichierNom: "cert.pem",
  });
  d = await r.json().catch(() => ({}));
  verdict("A12. certificat SEUL + clé déjà disponible → accepté (association vérifiée)",
    r.status === 200 && d.config?.certClePriveeDisponible === true);

  // A13 — PEM COMBINÉ (CERTIFICATE + PRIVATE KEY dans le même fichier)
  r = await admin.req("PUT", "/api/signature-config", {
    certFichier: b64("combine-cert-cle.pem"), certFichierNom: "combine-cert-cle.pem",
  });
  d = await r.json().catch(() => ({}));
  verdict("A13. PEM combiné (certificat + clé embarquée) → clé extraite automatiquement",
    r.status === 200 && /clé embarquée/.test(String(d.config?.certCleFichierNom ?? "")) &&
    d.config?.certClePriveeDisponible === true);

  // A14 — coffre .p12 moderne (certificat + clé privée) : clé du coffre,
  //       clé séparée vidée (le coffre devient la custody)
  r = await admin.req("PUT", "/api/signature-config", {
    certFichier: b64("moderne.p12"), certFichierNom: "moderne.p12", certMotDePasse: MDP_P12,
  });
  d = await r.json().catch(() => ({}));
  verdict("A14. coffre .p12 moderne accepté (Task 221 non régressé)",
    r.status === 200 && d.config?.certFormat === "PKCS#12");
  verdict("A15. clé privée disponible VIA le coffre, clé séparée vidée",
    d.config?.certClePriveeDisponible === true && !String(d.config?.certCleFichierNom ?? ""));

  // A16 — certificat SEUL (paire B) alors que le coffre .p12 (paire A) occupe
  //       la section → l'association VÉRIFIÉE contre la CLÉ DU COFFRE refuse
  //       (l'appariement couvre aussi les clés venues d'un coffre) ;
  // A16b — après retrait du coffre, un certificat seul est accepté (clé absente).
  r = await admin.req("PUT", "/api/signature-config", {
    certFichier: b64("cert222.pem"), certFichierNom: "cert222.pem",
  });
  d = await r.json().catch(() => ({}));
  verdict("A16. certificat ≠ clé du coffre en place → refus explicite (association vérifiée)",
    r.status === 400 && /ne correspond pas à la clé privée déjà disponible/.test(String(d.error ?? "")));
  await admin.req("PUT", "/api/signature-config", { certFichier: "" }); // retrait du coffre
  r = await admin.req("PUT", "/api/signature-config", {
    certFichier: b64("certificat222.cer"), certFichierNom: "certificat222.cer",
  });
  d = await r.json().catch(() => ({}));
  verdict("A16b. certificat .cer seul (sans clé enregistrée) accepté",
    r.status === 200 && d.config?.certFormat === "X.509" && d.config?.certClePriveeDisponible === false);

  // A17 — retrait du certificat : métadonnées + clé privée balayées
  r = await admin.req("PUT", "/api/signature-config", { certFichier: "" });
  d = await r.json().catch(() => ({}));
  verdict("A17. retrait certificat → tout vidé (disponible=false)",
    r.status === 200 && !String(d.config?.certFichierNom ?? "") &&
    d.config?.certClePriveeDisponible === false);

  // ---------- Section B : RÉPONSES AUX DEMANDES (scope=reponse) ----------
  console.log("\n--- B. Section Réponses aux demandes (scope=reponse) ---");

  // B1 — certificat SEUL (.pem) : accepté, clé non disponible
  r = await admin.req("PUT", "/api/signature-config", {
    scope: "reponse", certFichier: b64("cert.pem"), certFichierNom: "cert.pem",
  });
  d = await r.json().catch(() => ({}));
  verdict("B1. certificat SEUL (.pem) accepté pour les réponses",
    r.status === 200 && d.config?.certFormat === "X.509" && d.config?.certClePriveeDisponible === false);

  // B2 — clé privée séparée appariée → disponible
  r = await admin.req("PUT", "/api/signature-config", {
    scope: "reponse", certCleFichier: b64("cle222-pkcs1.key"), certCleFichierNom: "cle-paire-a.key",
  });
  d = await r.json().catch(() => ({}));
  verdict("B2. clé privée (.key) acceptée pour les réponses", r.status === 200);
  verdict("B3. clé privée DISPONIBLE pour les réponses", d.config?.certClePriveeDisponible === true);

  // B4 — certificat NON aparié (paire B) → refus (association vérifiée)
  r = await admin.req("PUT", "/api/signature-config", {
    scope: "reponse", certFichier: b64("cert222.pem"), certFichierNom: "cert222.pem",
  });
  d = await r.json().catch(() => ({}));
  verdict("B4. certificat ≠ clé déjà disponible (réponses) → refus explicite",
    r.status === 400 && /ne correspond pas à la clé privée déjà disponible/.test(String(d.error ?? "")));

  // B5 — certificat SEUL aparié → association vérifiée OK
  r = await admin.req("PUT", "/api/signature-config", {
    scope: "reponse", certFichier: b64("cert.pem"), certFichierNom: "cert.pem",
  });
  d = await r.json().catch(() => ({}));
  verdict("B5. certificat SEUL + clé déjà disponible (réponses) → accepté",
    r.status === 200 && d.config?.certClePriveeDisponible === true);

  // B6 — coffre LEGACY .p12 + mot de passe → clé du coffre, disponible
  r = await admin.req("PUT", "/api/signature-config", {
    scope: "reponse", certFichier: b64("legacy.p12"), certFichierNom: "legacy.p12", certMotDePasse: MDP_P12,
  });
  d = await r.json().catch(() => ({}));
  verdict("B6. coffre .p12 legacy accepté (certificat + clé privée)",
    r.status === 200 && d.config?.certFormat === "PKCS#12" && d.config?.certClePriveeDisponible === true);

  // B7 — secrets jamais renvoyés sur le scope reponse
  verdict("B7. secrets absents des réponses API (scope reponse)", sansSecrets(d.config ?? {}));

  // B8 — retrait du certificat dédié des réponses
  r = await admin.req("PUT", "/api/signature-config", { scope: "reponse", certFichier: "" });
  d = await r.json().catch(() => ({}));
  verdict("B8. retrait certificat des réponses → tout vidé",
    r.status === 200 && !String(d.config?.certFichierNom ?? "") && d.config?.certClePriveeDisponible === false);

  // ---------- Section C : protections et intégration ----------
  console.log("\n--- C. Protections (rôle IT) et intégration ---");
  let itClient = null;
  const cr = await admin.req("POST", "/api/users", {
    name: "IT Demo 222", email: "it-demo222@test.local",
    password: "Demo222Initial!", role: "IT",
  });
  if (cr.ok) {
    // première connexion : mot de passe provisoire OBLIGATOIREMENT changé
    itClient = await creerClient("it-demo222@test.local", "Demo222Initial!");
    const ch = await itClient.req("POST", "/api/auth/change-password", {
      currentPassword: "Demo222Initial!", newPassword: "Demo222Final!x",
    });
    if (ch.ok) {
      itClient = await creerClient("it-demo222@test.local", "Demo222Final!x");
    } else {
      itClient = null; // changement refusé : les 403 seraient ambigus
    }
  }
  if (itClient) {
    r = await itClient.req("PUT", "/api/signature-config", {
      certCleFichier: b64("cle222-pkcs1.key"), certCleFichierNom: "cle222-pkcs1.key",
    });
    let dj = await r.json().catch(() => ({}));
    verdict("C1. IT → 403 refusIT sur l'import de clé privée (double protection)",
      r.status === 403 && /informatique/i.test(String(dj.error ?? "")), `code=${dj.code ?? "?"}`);
    r = await itClient.req("PUT", "/api/signature-config", {
      scope: "reponse", certFichier: b64("cert.pem"), certFichierNom: "cert.pem",
    });
    dj = await r.json().catch(() => ({}));
    verdict("C2. IT → 403 refusIT sur l'import de certificat (scope reponse)",
      r.status === 403 && /informatique/i.test(String(dj.error ?? "")));
  } else {
    verdict("C1/C2. compte IT de test indisponible", false);
  }

  // C3 — la configuration Import n'a PAS été coulée par les tests réponses
  r = await admin.req("GET", "/api/signature-config?scope=reponse");
  d = await r.json().catch(() => ({}));
  verdict("C3. GET scope=reponse expose certClePriveeDisponible (affichage dialogue)",
    r.status === 200 && typeof (d.config ?? {}).certClePriveeDisponible === "boolean");

  // ---------- Nettoyage : état final propre ----------
  console.log("\n--- Nettoyage ---");
  await admin.req("PUT", "/api/signature-config", { certFichier: "" });
  await admin.req("PUT", "/api/signature-config", { scope: "reponse", certFichier: "" });
  // suppression du compte IT de démonstration
  const listeUsers = await (await admin.req("GET", "/api/users")).json().catch(() => ({}));
  const demoIt = (listeUsers.users ?? []).find((u) => u.email === "it-demo222@test.local");
  if (demoIt) await admin.req("DELETE", "/api/users/" + encodeURIComponent(demoIt.id));
  const fin = await (await admin.req("GET", "/api/signature-config")).json();
  verdict("Nettoyage. configuration Import propre", !String(fin.config?.certFichierNom ?? "") &&
    fin.config?.certClePriveeDisponible === false);

  console.log(`\n=== RÉSULTAT : ${ok} OK / ${ko} KO ===`);
  process.exit(ko ? 1 : 0);
})().catch((e) => {
  console.error("ERREUR FATALE:", e);
  process.exit(1);
});
