/**
 * ============================================================================
 *  NOUVEAU (v0.2.93) — CONFIGURATION DU TAMPON DES RÉPONSES (SÉPARATION)
 *  MODIFIÉ (v0.2.99) — CERTIFICAT DE SIGNATURE ÉLECTRONIQUE TOTALEMENT DÉDIÉ
 * ============================================================================
 *
 *  Demande utilisateur (v0.2.93) : « Séparer la configuration du QR Code, de
 *  la signature électronique et du certificat de signature électronique entre
 *  les deux sections : Import / Demandes-Réponses. Chaque section doit
 *  disposer de sa propre configuration et de ses propres paramètres de
 *  positionnement. »
 *
 *  Demande utilisateur (v0.2.99) : « la configuration du certificat de
 *  signature électronique doit être totalement séparée de celle utilisée
 *  pour l'Import… Le certificat, son mot de passe ainsi que ses paramètres
 *  de positionnement doivent être gérés séparément pour chaque section. »
 *
 *  - Section « Import » (onglet Importation)  → table SignatureConfig
 *    (singleton « signature ») : s'applique aux FICHES DE PAIE.
 *  - Section « Demandes / Réponses » (onglet Demandes) → table
 *    SignatureConfigReponse (singleton « signature-reponse ») : s'applique
 *    aux DOCUMENTS DE RÉPONSE (mode Automatique du dialogue de réponse).
 *
 *  ACTIFS : l'image de signature/cachet et l'image de QR fourni (mode
 *  IMAGE) restent importés UNE SEULE FOIS (section Import) et partagés.
 *  Le CERTIFICAT est désormais TOTALEMENT DÉDIÉ : fichier importé dans le
 *  panneau des réponses (copie chiffrée distincte certificat-reponse-…),
 *  mot de passe chiffré PROPRE et métadonnées PROPREES — une modification
 *  du certificat « Import » n'affecte plus les réponses, et inversement.
 *
 *  CONTINUITÉ (une seule fois, marqueur certHeriteImport) : si la ligne
 *  réponses existait déjà avec certActif ON sans certificat dédié
 *  (installation v0.2.93 → v0.2.98 où le fichier était partagé), le premier
 *  accès copie les métadonnées du certificat « Import » dans la ligne
 *  réponses — l'état appliqué est inchangé, puis les sections évoluent
 *  INDÉPENDAMMENT (un retrait ultérieur du certificat dédié n'est jamais
 *  annulé par une nouvelle copie).
 *
 *  CONTINUITÉ HISTORIQUE : le singleton « signature-reponse » n'est créé
 *  qu'au premier enregistrement (PUT scope=reponse). Tant qu'il n'existe
 *  pas, le mode Automatique des réponses utilise la configuration « Import »
 *  (comportement historique exact — aucune surprise pour les installations
 *  existantes).
 * ============================================================================
 */
import { db } from "@/lib/db";
import { tamponActif, type ConfigTampon } from "@/lib/stamp";
// (NOUVEAU v0.2.137) injection des métadonnées du cachet « Signature
// électronique » pour juger tamponActifReponses dans les MÊMES conditions
// que le rendu réel (aucun cycle : signature-api n'importe pas ce module).
import { completerConfigTamponAvecElec } from "@/lib/signature-api";

export const ID_CONFIG_REPONSE = "signature-reponse";

/** Type de la configuration RÉPONSES (colonnes de SignatureConfigReponse).
 * (v0.2.99) le CERTIFICAT est dédié : fichier, métadonnées et mot de passe
 * (ce dernier n'apparaît JAMAIS ici — il est retiré des réponses API et
 * remplacé par le booléen certMotDePasseEnregistre). */
export type ConfigReponse = {
  actif: boolean;
  sigActif: boolean;
  sigTexte: string;
  sigPosition: string;
  sigTaille: number;
  sigOpacite: number;
  qrActif: boolean;
  qrMode: string;
  qrUrl: string;
  qrTexte: string;
  qrPosition: string;
  qrTaille: number;
  sigDecalX: number;
  sigDecalY: number;
  qrDecalX: number;
  qrDecalY: number;
  sigRotation: number;
  qrRotation: number;
  mentionActif: boolean;
  mentionTexte: string;
  certActif: boolean;
  certPosition: string;
  certDecalX: number;
  certDecalY: number;
  certTaille: number;
  // ---- (v0.2.99) certificat DÉDIÉ (fichier + métadonnées propres) ----
  certFormat: string;
  certFichierNom: string;
  certChemin: string;
  certSujet: string;
  certEmetteur: string;
  certSerie: string;
  certValideDu: Date | string | null;
  certValideAu: Date | string | null;
  certEmpreinte: string;
  certImportLe: Date | string | null;
  // ---- (v0.2.112) CLÉ PRIVÉE ASSOCIÉE (fichier séparé) ----
  certCleChemin: string;
  certCleFichierNom: string;
  certCleType: string;
  certCleImportLe: Date | string | null;
  certHeriteImport: boolean;
  // ---- (NOUVEAU v0.2.119) ÉLÉMENT « SIGNATURE ÉLECTRONIQUE » DU TAMPON ----
  // Alimenté EN DIRECT par le certificat du module de signature
  // (SignatureApiConfig) — aucune donnée de certificat stockée ici.
  elecActif: boolean;
  elecPosition: string;
  elecDecalX: number;
  elecDecalY: number;
  elecTaille: number;
  // (NOUVEAU v0.2.120) forme du cachet : RECTANGLE (historique) | ROND
  elecForme: string;
  // ---- (CORRECTIF v0.2.201) PROPRIÉTÉS DU CONTENU DU CACHET ÉLECTRONIQUE ----
  // Alimentées par les interrupteurs du formulaire « Aperçu réponses »
  // (signature-config/route.ts lignes ~1091-1096). Présentes dans la base
  // et utilisées par stamp.ts mais MANQUANTES du type ConfigReponse —
  // TypeScript déclenchait TS2339 / TS2353 à la lecture/écriture.
  elecAffSignataire: boolean;
  elecAffOrganisation: boolean;
  elecAffEmetteur: boolean;
  elecAffValidite: boolean;
  elecAffEmpreinte: boolean;
  elecTexteLibre: string;
};

/** Valeurs par défaut (identiques aux @default du schéma). */
export function valeursReponseParDefaut(): ConfigReponse {
  return {
    actif: false,
    sigActif: false,
    sigTexte: "",
    sigPosition: "BAS_DROITE",
    sigTaille: 120,
    sigOpacite: 0.9,
    qrActif: false,
    qrMode: "DONNEES",
    qrUrl: "",
    qrTexte: "",
    qrPosition: "BAS_GAUCHE",
    qrTaille: 110,
    sigDecalX: 0,
    sigDecalY: 0,
    qrDecalX: 0,
    qrDecalY: 0,
    sigRotation: 0,
    qrRotation: 0,
    mentionActif: true,
    mentionTexte: "Document signé électroniquement — AutoRH — {DATE}",
    certActif: false,
    certPosition: "BAS_CENTRE",
    certDecalX: 0,
    certDecalY: 0,
    certTaille: 100,
    certFormat: "",
    certFichierNom: "",
    certChemin: "",
    certSujet: "",
    certEmetteur: "",
    certSerie: "",
    certValideDu: null,
    certValideAu: null,
    certEmpreinte: "",
    certImportLe: null,
    certCleChemin: "",
    certCleFichierNom: "",
    certCleType: "",
    certCleImportLe: null,
    certHeriteImport: false,
    // (NOUVEAU v0.2.119) cachet « Signature électronique » — mêmes défauts
    // que les @default du schéma (BAS_DROITE, échelle 100 %).
    elecActif: false,
    elecPosition: "BAS_DROITE",
    elecDecalX: 0,
    elecDecalY: 0,
    elecTaille: 100,
    elecForme: "RECTANGLE",
    // (CORRECTIF v0.2.201) propriétés du contenu du cachet électronique
    // (interrupteurs d'affichage + texte libre) — valeurs par défaut.
    elecAffSignataire: true,
    elecAffOrganisation: true,
    elecAffEmetteur: true,
    elecAffValidite: true,
    elecAffEmpreinte: true,
    elecTexteLibre: "",
  };
}

/** Champs ÉDITABLES copiés depuis la configuration « Import » quand la
 * configuration RÉPONSES n'existe pas encore (affichage de continuité).
 * (v0.2.99) les MÉTADONNÉES du certificat dédié ne sont PAS copiées : la
 * copie affichée n'a pas de certificat dédié — l'aperçu et le panneau
 * montrent le certificat « Import » HÉRITÉ via les actifs partagés tant
 * que la configuration n'a pas été enregistrée. */
const CHAMPS_COPIES_IMPORT: (keyof ConfigReponse)[] = [
  "actif", "sigActif", "sigTexte", "sigPosition", "sigTaille", "sigOpacite",
  "qrActif", "qrMode", "qrUrl", "qrTexte", "qrPosition", "qrTaille",
  "sigDecalX", "sigDecalY", "qrDecalX", "qrDecalY",
  "sigRotation", "qrRotation", "mentionActif", "mentionTexte",
  "certActif", "certPosition", "certDecalX", "certDecalY", "certTaille",
  // (NOUVEAU v0.2.119) cachet « Signature électronique » — continuité
  // d'affichage tant que la configuration réponses n'a pas été enregistrée.
  "elecActif", "elecPosition", "elecDecalX", "elecDecalY", "elecTaille",
  "elecForme",
];

/**
 * NOUVEAU (v0.2.99) — CONTINUITÉ DU CERTIFICAT (une seule fois).
 * Une installation venue de la v0.2.93 → v0.2.98 avait UN SEUL certificat
 * (section Import) partagé avec les réponses : si la ligne réponses existe
 * avec l'interrupteur certificat ON mais AUCUN certificat dédié, le premier
 * accès copie les métadonnées du certificat « Import » dans la ligne
 * réponses (marqueur certHeriteImport) — l'état appliqué reste identique,
 * puis les deux sections évoluent INDÉPENDAMMENT (le marqueur empêche toute
 * nouvelle copie : un retrait ultérieur du certificat dédié n'est jamais
 * annulé). Jamais bloquant : en cas d'échec, la ligne non modifiée est
 * renvoyée (aucun certificat dédié → bloc certificat absent des réponses).
 */
export async function lireLigneReponseAvecContinuite() {
  const ligne = await db.signatureConfigReponse.findUnique({
    where: { id: ID_CONFIG_REPONSE },
  });
  if (!ligne || ligne.certHeriteImport || !ligne.certActif || ligne.certFichierNom) {
    return ligne;
  }
  const globale = await db.signatureConfig.findUnique({ where: { id: "signature" } });
  if (!globale || !globale.certSujet || !globale.certEmpreinte) return ligne;
  try {
    return await db.signatureConfigReponse.update({
      where: { id: ID_CONFIG_REPONSE },
      data: {
        certFormat: globale.certFormat,
        certFichierNom: globale.certFichierNom,
        certChemin: globale.certChemin,
        certSujet: globale.certSujet,
        certEmetteur: globale.certEmetteur,
        certSerie: globale.certSerie,
        certValideDu: globale.certValideDu,
        certValideAu: globale.certValideAu,
        certEmpreinte: globale.certEmpreinte,
        certImportLe: globale.certImportLe,
        certMotDePasse: globale.certMotDePasse ?? "",
        // (v0.2.112) la CLÉ PRIVÉE associée suit le certificat lors de la
        // copie de continuité (même custody : fichier + mot de passe chiffré).
        certCleChemin: globale.certCleChemin ?? "",
        certCleFichierNom: globale.certCleFichierNom ?? "",
        certCleType: globale.certCleType ?? "",
        certCleMotDePasse: globale.certCleMotDePasse ?? "",
        certCleImportLe: globale.certCleImportLe ?? null,
        certHeriteImport: true,
      },
    });
  } catch {
    return ligne; // copie impossible : comportement dégradé sans certificat dédié
  }
}

/**
 * Lit la configuration RÉPONSES.
 *  - ligne existante → { source: "reponse", valeurs: ligne } ;
 *  - ligne absente   → { source: "import", valeurs: copie des champs
 *    éditables de la configuration « Import » (ou défauts si celle-ci est
 *    absente elle-même) } — RIEN n'est créé : le premier PUT de la section
 *    créera le singleton et rendra la séparation effective.
 */
export async function lireConfigReponse(): Promise<{
  source: "reponse" | "import";
  valeurs: ConfigReponse;
  actifs: {
    sigImage: string;
    sigImageNom: string;
    qrImage: string;
    qrImageNom: string;
    certFormat: string;
    certFichierNom: string;
    certSujet: string;
    certEmetteur: string;
    certSerie: string;
    certValideDu: Date | string | null;
    certValideAu: Date | string | null;
    certEmpreinte: string;
  };
  tamponActifReponses: boolean;
}> {
  const globale = await db.signatureConfig.findUnique({ where: { id: "signature" } });
  const actifs = {
    sigImage: globale?.sigImage ?? "",
    sigImageNom: globale?.sigImageNom ?? "",
    qrImage: globale?.qrImage ?? "",
    qrImageNom: globale?.qrImageNom ?? "",
    certFormat: globale?.certFormat ?? "",
    certFichierNom: globale?.certFichierNom ?? "",
    certSujet: globale?.certSujet ?? "",
    certEmetteur: globale?.certEmetteur ?? "",
    certSerie: globale?.certSerie ?? "",
    certValideDu: globale?.certValideDu ?? null,
    certValideAu: globale?.certValideAu ?? null,
    certEmpreinte: globale?.certEmpreinte ?? "",
  };
  const ligne = await lireLigneReponseAvecContinuite();
  if (ligne) {
    return {
      source: "reponse",
      valeurs: ligne as unknown as ConfigReponse,
      actifs,
      // L'interrupteur général des réponses compte dans l'état affiché.
      // (MODIFIÉ v0.2.137) jugement sur la config COMPLÉTÉE (elec injecté au
      // rendu, jamais stocké) — sinon le cachet « Signature électronique »
      // seul ne comptait pas comme élément actif.
      tamponActifReponses: tamponActif(
        await completerConfigTamponAvecElec(
          ligne as unknown as Partial<ConfigTampon>,
          "REPONSES"
        )
      ),
    };
  }
  // Ligne absente : valeurs affichées = copie de la configuration « Import »
  // (ce que le mode Automatique applique ACTUELLEMENT aux réponses).
  const copie = { ...valeursReponseParDefaut() };
  if (globale) {
    for (const champ of CHAMPS_COPIES_IMPORT) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (copie as any)[champ] = (globale as any)[champ];
    }
  }
  return {
    source: "import",
    valeurs: copie,
    actifs,
    // (MODIFIÉ v0.2.137) même jugement sur config COMPLÉTÉE pour la copie
    // de continuité « Import » (actif forcé à true = périmètre réponses).
    tamponActifReponses: globale
      ? tamponActif(
          await completerConfigTamponAvecElec(
            { ...(globale as unknown as Partial<ConfigTampon>), actif: true },
            "REPONSES"
          )
        )
      : false,
    // NOTE : en mode « import », le tamponnage forçait historiquement
    // actif:true — l'état affiché reflète ce comportement.
  };
}

/**
 * Fusionne une configuration RÉPONSES avec les ACTIFS partagés de la
 * configuration « Import » → ConfigTampon complet pour les moteurs
 * (tamponnerFicheDossier / apercu…).
 *
 * MODIFIÉ (v0.2.99) : les IMAGES (signature/cachet, QR fourni) viennent
 * TOUJOURS de la configuration « Import » (actifs partagés) ; les
 * MÉTADONNÉES du CERTIFICAT viennent de la configuration RÉPONSES elle-même
 * (certificat DÉDIÉ — fichier, mot de passe et métadonnées propres).
 * source="import" (ligne réponses pas encore enregistrée — continuité
 * historique) : le certificat « Import » s'applique, comme avant la
 * séparation.
 */
export function fusionnerReponseAvecActifs(
  rep: ConfigReponse,
  globale: Partial<ConfigTampon> | null | undefined,
  source: "reponse" | "import" = "reponse"
): ConfigTampon {
  const fusion: ConfigTampon = {
    ...(rep as unknown as ConfigTampon),
    sigImage: globale?.sigImage ?? "",
    qrImage: globale?.qrImage ?? "",
  };
  if (source === "import") {
    fusion.certSujet = globale?.certSujet ?? "";
    fusion.certEmetteur = globale?.certEmetteur ?? "";
    fusion.certSerie = globale?.certSerie ?? "";
    fusion.certValideAu = globale?.certValideAu ?? null;
    fusion.certEmpreinte = globale?.certEmpreinte ?? "";
  }
  return fusion;
}
