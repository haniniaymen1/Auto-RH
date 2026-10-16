// Types partagés client/serveur

export interface PayslipListItem {
  id: string;
  fileName: string;
  fileSize: number;
  cin: string | null;
  employeeName: string | null;
  period: string | null;
  netSalary: string | null;
  matricule: string | null;
  pageNumber: number;
  uploadedAt: string;
  snippet: string | null;
  matchedBy: "cin_content" | "cin_detected" | "none";
  // NOUVEAU (v0.2.50) : texte des erreurs / incohérences nom & prénom
  // détectées à l'import (null = aucune). Affiché par une pastille ⚠ dans
  // l'onglet « Toutes les fiches ».
  anomalieNom: string | null;
}

export interface SearchResponse {
  mode: "search" | "list";
  query?: string;
  total: number;
  items: PayslipListItem[];
}

// NOUVEAU (Task 99) : réponse PAGINÉE côté serveur de GET /api/payslips
// (liste ET recherche CIN — la recherche s'effectue sur TOUTES les fiches,
// pas seulement la page affichée).
export interface PaginationMeta {
  page: number;
  totalPages: number;
  total: number;
}

export interface PayslipListResponse {
  mode: "search" | "list";
  query?: string;
  exact?: boolean;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasMore: boolean;
  /** (Task 99) recherche uniquement : fiches restant à indexer. */
  indexation?: { restants: number };
  items: PayslipListItem[];
}

/** NOUVEAU (Task 109) : vérification d'authenticité des CIN détectés,
 * calculée après l'importation (demande utilisateur : « taux de fiabilité et
 * taux d'erreur en vérifiant le nombre de CIN corrects (vrais) et incorrects
 * (faux) »). Règle (src/lib/cin-validation.ts) :
 *  - VRAI  = format tunisien authentique (8 chiffres classique ou 9
 *            biométrique, sans lettres, sans 4 zéros en tête) ;
 *  - FAUX  = valeur détectée hors format (lettres « DEMO001234 », longueur
 *            anormale, zéros en tête…) ;
 *  - non détecté = aucune valeur CIN trouvée sur la fiche (ni vrai ni faux). */
export interface FiabiliteCin {
  total: number; // fiches vérifiées (créées par l'import)
  vrais: number; // CIN corrects (format authentique)
  faux: number; // CIN incorrects (format non authentique)
  nonDetectes: number; // fiches sans aucun CIN (rien à vérifier)
  tauxFiabilite: number; // vrais / total × 100
  tauxErreur: number; // faux / total × 100
}

export interface UploadResultItem {
  fileName: string;
  status: "SUCCESS" | "ERROR";
  message: string;
  id?: string;
  cin?: string | null;
  employeeName?: string | null;
  period?: string | null;
  netSalary?: string | null;
  matricule?: string | null;
  fileSize?: number;
  // NOUVEAU (ajouté, optionnel) : nombre de fiches créées quand le fichier
  // contient PLUSIEURS fiches (PDF multi-fiches, ZIP, Excel multi-feuilles…).
  created?: number;
  // NOUVEAU (Task 109, optionnel) : vérification des CIN de CE fichier
  // (présente seulement quand au moins une fiche a été créée).
  fiabilite?: FiabiliteCin;
  // NOUVEAU (v0.2.50, optionnel) : anomalies nom/prénom détectées pour CE
  // fichier (incohérences avec les fiches du même CIN, format suspect…).
  anomalies?: string[];
  // NOUVEAU (ajouté, optionnel) : résultats détaillés de chaque fichier
  // contenu dans une ARCHIVE ZIP.
  entryResults?: UploadResultItem[];
}

export interface UploadResponse {
  processed: number;
  success: number;
  failed: number;
  results: UploadResultItem[];
  // NOUVEAU (Task 109) : vérification d'authenticité des CIN de TOUTES les
  // fiches créées par CETTE requête (1 requête = 1 lot de l'interface).
  fiabilite?: FiabiliteCin;
  // NOUVEAU (v0.2.50) : nombre de fiches du lot porteuses d'au moins une
  // anomalie nom / prénom (bandeau d'avertissement dans l'interface).
  anomaliesNoms?: number;
}

export interface StatsResponse {
  total: number;
  /** (MODIFIÉ Task 79) Nombre de CIN DISTINCTS détectés (dédoublonnage
   * normalisé côté /api/stats) — plus le nombre de fiches avec CIN. */
  withCin: number;
  /** Nombre de FICHES sans aucun CIN détecté (inchangé Task 79). */
  withoutCin: number;
  employees: number;
  lastUpload: string | null;
}

/** Utilisateur connecté (retourné par /api/auth/me). */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "RH" | "IT" | "SUPERADMIN"; // (MODIFIÉ Task 34 : inclut SUPERADMIN)
  // NOUVEAU (Task 64) : true = mot de passe expiré (politique 15 jours) →
  // l'écran de changement de mot de passe OBLIGATOIRE remplace l'application.
  mustChangePassword?: boolean;
}
