/** Hook de résolution : essaie l'import tel quel, puis avec .ts (projets TS). */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (e) {
    if (
      (e && (e.code === "ERR_MODULE_NOT_FOUND" || e.code === "ERR_UNSUPPORTED_DIR_IMPORT")) &&
      (specifier.startsWith("./") || specifier.startsWith("../"))
    ) {
      try {
        return await next(specifier + ".ts", context);
      } catch {
        return await next(specifier + "/index.ts", context);
      }
    }
    throw e;
  }
}
