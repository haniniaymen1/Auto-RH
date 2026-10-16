/**
 * ============================================================================
 *  NOUVEAU (Task 224) — API DE CONFIGURATION « CERTIFICATION & SIGNATURE
 *  ÉLECTRONIQUE »
 * ============================================================================
 *
 *  GET /api/signature-api/config
 *      → configuration complète SANS aucun secret (booléens
 *        certMotDePasseEnregistre / certCleMotDePasseEnregistre /
 *        apiSecretEnregistre seuls). IT / SUPERADMIN uniquement.
 *
 *  PUT /api/signature-api/config
 *      → enregistre la configuration. Les champs SECRÈTES (apiSecret,
 *        certMotDePasse, certCleMotDePasse) ne sont écrasés QUE s'ils sont
 *        fournis NON VIDES dans le corps (chaîne absente ou vide = inchangé).
 *        Les chemins de fichiers (certChemin, certCleChemin) ne sont JAMAIS
 *        pris du corps : ils ne changent que par /certificat (import/retrait).
 *        Rôles : IT / SUPERADMIN.
 * ============================================================================
 */
import { NextRequest, NextResponse } from "next/server";
import {
  estSuperadmin,
  getSessionUser,
  motDePasseExpire,
  unauthorized,
} from "@/lib/auth";
import { db } from "@/lib/db";
import {
  configPublique,
  ID_CONFIG_SIGNATURE_API,
  lireConfigSignatureApi,
  signerToutesFichesExistantes,
  urlActive,
} from "@/lib/signature-api";

export async function GET() {
  const session = await getSessionUser();
  if (!session) return unauthorized();
  if (session.mustChangePassword) return motDePasseExpire();
  try {
    if (session.role !== "IT" && !estSuperadmin(session)) {
      // Matrice des rôles : le RH n'est pas concerné par la configuration
      // technique de la signature — aucune information renvoyée.
      return NextResponse.json({ config: {} });
    }
    const cfg = await lireConfigSignatureApi();
    return NextResponse.json({ config: configPublique(cfg) });
  } catch (error) {
    console.error("[SIGNATURE-API/CONFIG] Lecture:", error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}

const OUI_NON = ["actif", "signerFiches", "signerReponses", "verifierAuto"] as const;
const TEXTES = [
  "mode",
  "environnement",
  "raison",
  "emplacement",
  "contact",
  "apiUrlTest",
  "apiUrlProd",
  "apiAuthType",
  "apiAuthEntete",
  "apiIdentifiant",
  "apiEntetesSup",
  "apiChampReponse",
] as const;
const SECRETS = ["apiSecret", "certMotDePasse", "certCleMotDePasse"] as const;

export async function PUT(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorized();
  if (session.mustChangePassword) return motDePasseExpire();
  try {
    if (session.role !== "IT" && !estSuperadmin(session)) {
      return NextResponse.json(
        { error: "Fonctionnalité réservée aux rôles IT et superadministrateur." },
        { status: 403 }
      );
    }
    const corps = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    // (v0.2.122) ÉTAT AVANT mise à jour : nécessaire pour détecter la
    // TRANSITION d'activation (inactif → actif) et ne lancer le rattrapage
    // automatique QUE dans ce cas (pas à chaque simple sauvegarde).
    const cfgAvant = await lireConfigSignatureApi(); // garantit le singleton

    const data: Record<string, unknown> = {};
    for (const champ of OUI_NON) {
      if (typeof corps[champ] === "boolean") data[champ] = corps[champ];
    }
    for (const champ of TEXTES) {
      if (typeof corps[champ] === "string") data[champ] = (corps[champ] as string).slice(0, 2000);
    }
    for (const champ of SECRETS) {
      const v = corps[champ];
      // Champ vide ou absent = secret CONSERVÉ (jamais écrasé par "")
      if (typeof v === "string" && v.length > 0) data[champ] = v.slice(0, 2000);
    }
    if (typeof corps.apiTimeoutMs === "number" && isFinite(corps.apiTimeoutMs)) {
      data.apiTimeoutMs = Math.min(300000, Math.max(5000, Math.round(corps.apiTimeoutMs)));
    }
    // Valeurs bornées
    if (typeof data.mode === "string" && !["LOCALE", "API_EXTERNE"].includes(data.mode as string)) {
      return NextResponse.json({ error: "Mode inconnu : LOCALE ou API_EXTERNE attendu." }, { status: 400 });
    }
    if (typeof data.environnement === "string" && !["TEST", "PRODUCTION"].includes(data.environnement as string)) {
      return NextResponse.json({ error: "Environnement inconnu : TEST ou PRODUCTION attendu." }, { status: 400 });
    }
    if (typeof data.apiAuthType === "string" && !["BEARER", "API_KEY", "BASIC", "AUCUN"].includes(data.apiAuthType as string)) {
      return NextResponse.json({ error: "Type d'authentification inconnu : BEARER, API_KEY, BASIC ou AUCUN." }, { status: 400 });
    }

    const maj = await db.signatureApiConfig.update({
      where: { id: ID_CONFIG_SIGNATURE_API },
      data,
    });

    // NOUVEAU (v0.2.122) — RATTRAPAGE AUTOMATIQUE À L'ACTIVATION : quand la
    // configuration vient d'ACTIVER le module avec couverture des fiches de
    // paie (actif = true et/ou signerFiches = true → les deux désormais ON),
    // TOUTES les fiches PDF déjà importées sont signées automatiquement en
    // arrière-plan (demande utilisateur : « toutes les fiches de paie dans
    // le portail employé doivent être signées électroniquement de façon
    // automatique lorsque l'option est activée »). La réponse part SANS
    // attendre (fire-and-forget) — le résultat complet est dans les
    // journaux du serveur et chaque fiche porte sa copie signée au registre
    // (badge « Signée électroniquement » au portail, Task 231).
    let message = "Configuration enregistrée.";
    const cfgFraiche = await lireConfigSignatureApi();
    // TRANSITION d'activation : le module est maintenant pleinement actif
    // (actif + signerFiches) ALORS qu'avant la sauvegarde il ne l'était pas
    // (actif ou signerFiches désactivé). C'est exactement le moment demandé
    // par l'utilisateur : « lorsque l'option ... est activée dans la
    // configuration ». Une simple re-sauvegarde (déjà actif) ne relance PAS
    // le rattrapage — le cache du registre rendrait l'opération inutile.
    const activationFiches =
      cfgFraiche.actif &&
      cfgFraiche.signerFiches &&
      (!cfgAvant.actif || !cfgAvant.signerFiches);
    if (activationFiches) {
      signerToutesFichesExistantes("activation du module")
        .then((r) => {
          if (r.message) console.log("[SIGNATURE-API/CONFIG] " + r.message);
        })
        .catch((e) =>
          console.error("[SIGNATURE-API/CONFIG] Rattrapage impossible:", e)
        );
      message =
        "Configuration enregistrée. Signature électronique automatique de TOUTES les fiches de paie déjà importées lancée en arrière-plan — chaque employé recevra au portail la copie signée (PAdES).";
    }

    return NextResponse.json({
      config: configPublique(maj as never),
      message,
    });
  } catch (error) {
    console.error("[SIGNATURE-API/CONFIG] Enregistrement:", error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}
