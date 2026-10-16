#!/bin/bash
# ============================================================================
# VERIF-BUILD v0.2.115 (Task 225) — build Next.js + verdict écrit sur disque.
# La sortie terminal de cette session s'est avérée instable (stubs) :
# ce script écrit SES PROPRES conclusions dans verif-build-resultat.txt —
# fichier relu ensuite par l'agent (source de vérité sur disque).
# ============================================================================
cd /home/z/my-project || exit 2
SORTIE=/tmp/build-v02115.log
RESULTAT=/home/z/my-project/scripts/verif-build-resultat.txt

{
  echo "=== BUILD v0.2.115 — démarré $(date '+%H:%M:%S') ==="
} > "$RESULTAT"

# 1) TSC ciblé : mes fichiers uniquement (le projet a des erreurs préexistantes
#    hors src/app+src/lib — next build ne compile que l'app).
timeout 600 npx tsc --noEmit > "$SORTIE" 2>&1
CODE_TSC=$?
{
  echo "tsc_exit=$CODE_TSC"
  echo "--- erreurs fichiers Task 225 (signature) ---"
  grep -E "signature-documents|signature-api/signer" "$SORTIE" || echo "AUCUNE"
  echo "--- erreurs src/app/page.tsx ---"
  grep -E "src/app/page\.tsx" "$SORTIE" || echo "AUCUNE"
} >> "$RESULTAT"

# 2) Build Next.js production
timeout 900 npm run build > "$SORTIE" 2>&1
CODE_BUILD=$?
{
  echo "build_exit=$CODE_BUILD"
  if [ $CODE_BUILD -eq 0 ]; then
    echo "BUILD_OK"
    grep -E "Route \(app\)|signer|Compiled successfully|Generating static" "$SORTIE" | head -12
  else
    echo "BUILD_KO — 25 dernières lignes :"
    tail -25 "$SORTIE"
  fi
  echo "=== FIN $(date '+%H:%M:%S') ==="
} >> "$RESULTAT"
