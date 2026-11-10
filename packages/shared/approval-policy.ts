// Temporary exception authorized by the user. Restore to true on:
// "Reanuda el cierre de 2 accesos". See docs/CIERRE_TEMPORAL_UNA_CUENTA.md.
export const REQUIRE_SECOND_ACCOUNT_FOR_CLOSE = false;

export function requiresDistinctApprover(
  mode: string,
  type: "close" | "publish",
) {
  return (
    mode === "OFICIAL" &&
    (type === "publish" || REQUIRE_SECOND_ACCOUNT_FOR_CLOSE)
  );
}
