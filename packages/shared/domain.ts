import { z } from "zod";
export const shiftSchema = z.enum(["MANANA", "TARDE"]);
export const uuid = z.uuid();
export const voterLoginSchema = z
  .object({
    electionId: uuid,
    dni: z.string().regex(/^\d{8}$/),
    accessCode: z.string().min(6).max(100),
  })
  .strict();
export const voteSchema = z.discriminatedUnion("kind", [
  z
    .object({ electionId: uuid, kind: z.literal("VALIDO"), listId: uuid })
    .strict(),
  z
    .object({
      electionId: uuid,
      kind: z.literal("BLANCO"),
      listId: z.null().optional(),
    })
    .strict(),
  z
    .object({
      electionId: uuid,
      kind: z.literal("NULO"),
      listId: z.null().optional(),
    })
    .strict(),
]);
export type VoteInput = z.infer<typeof voteSchema>;
export const electionSchema = z
  .object({
    name: z.string().trim().min(5).max(150),
    year: z.number().int().min(2026).max(2100),
    scope: z.string().min(3).max(120),
    blankAllowed: z.boolean(),
    nullAllowed: z.boolean(),
    regulation: z.string().min(3).max(300),
    contact: z.string().min(3).max(200),
    shifts: z
      .array(shiftSchema)
      .min(1)
      .max(2)
      .refine((x) => new Set(x).size === x.length),
  })
  .strict();
export const listSchema = z
  .object({
    number: z.number().int().min(1).max(99),
    name: z.string().trim().min(3).max(100),
    symbol: z.enum(["sprout", "sun", "book", "star"]),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    candidates: z
      .array(
        z
          .object({
            name: z.string().trim().min(3).max(100),
            position: z.string().trim().min(3).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(7),
    proposal: z.string().max(600),
    active: z.boolean().default(true),
  })
  .strict();
export const rosterRowSchema = z
  .object({
    dni: z.string().regex(/^\d{8}$/),
    apellidos_nombres: z.string().trim().min(3).max(150),
    grado: z.string().regex(/^[1-6]$/),
    seccion: z.string().regex(/^[A-Z]{1,2}$/),
    turno: shiftSchema,
    habilitado: z.enum(["true", "false"]),
  })
  .strict();
export const rolePermissions: Record<string, string[]> = {
  COMITE: [
    "elections:read",
    "elections:write",
    "elections:prepare",
    "windows:manage",
    "elections:close",
    "elections:approve",
    "roster:read",
    "roster:write",
    "lists:read",
    "lists:write",
    "turnout:read",
    "results:read",
    "results:reconcile",
    "results:publish",
    "results:approve",
    "reports:read",
    "audit:read",
    "incidents:read",
    "incidents:write",
    "demo:reset",
  ],
  OPERADOR: [
    "elections:read",
    "elections:write",
    "roster:read",
    "roster:write",
    "lists:read",
    "lists:write",
    "turnout:read",
    "incidents:read",
    "incidents:write",
  ],
  OBSERVADOR: ["elections:read", "turnout:read", "results:read"],
  MESA: ["elections:read", "turnout:read", "incidents:read", "incidents:write"],
  ADMIN_TECNICO: ["accounts:manage"],
};
export function hasPermission(
  grants: { electionScope: string; permissions: string[] }[],
  permission: string,
  electionId?: string,
) {
  return grants.some(
    (g) =>
      g.permissions.includes(permission) &&
      (g.electionScope === "*" || g.electionScope === electionId),
  );
}
export function electoralOutcome(lists: { id: string; votes: number }[]) {
  const max = Math.max(0, ...lists.map((x) => x.votes));
  const leaders = lists.filter((x) => x.votes === max);
  return {
    status:
      max === 0
        ? "SIN_VOTOS_VALIDOS"
        : leaders.length > 1
          ? "EMPATE"
          : "MAYOR_VOTACION",
    listIds: max ? leaders.map((x) => x.id) : [],
  };
}
export function assertReconciled(s: {
  eligible: number;
  voted: number;
  ballots: number;
  valid: number;
  blank: number;
  null: number;
  lists: { votes: number }[];
}) {
  return (
    s.voted === s.ballots &&
    s.ballots === s.valid + s.blank + s.null &&
    s.valid === s.lists.reduce((a, x) => a + x.votes, 0) &&
    s.voted >= 0 &&
    s.voted <= s.eligible
  );
}
