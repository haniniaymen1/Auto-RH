import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// NOUVEAU (Task 17) : masquage du CIN dans les affichages — seuls les 3
// derniers caractères restent visibles (ex. 07778889 -> « •••889 »).
// Masquage PUREMENT VISUEL : la donnée complète reste en base, la recherche
// par CIN et l'accès aux PDF continuent d'utiliser le CIN complet.
export function maskCin(cin?: string | null): string {
  if (!cin) return "—"
  const v = String(cin).trim()
  if (v.length <= 3) return v
  return "•••" + v.slice(-3)
}
