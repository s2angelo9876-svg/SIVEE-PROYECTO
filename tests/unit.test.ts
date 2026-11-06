import { describe, it, expect } from "vitest";
import {
  voterLoginSchema,
  voteSchema,
  electoralOutcome,
  assertReconciled,
  hasPermission,
  rosterRowSchema,
} from "../packages/shared/domain";
import { windowAvailable } from "../apps/api/src/services";
import { parseRoster } from "../apps/api/src/roster-files";
import { canonical, digest } from "../apps/api/src/security";
const electionId = "11111111-1111-4111-8111-111111111111";
const listId = "22222222-2222-4222-8222-222222222222";
describe("identidad y cédula estrictas", () => {
  it.each(["", "1234567", "123456789", "abcdefgh"])(
    "rechaza DNI inválido %s",
    (dni) =>
      expect(
        voterLoginSchema.safeParse({ electionId, dni, accessCode: "DEMO-001" })
          .success,
      ).toBe(false),
  );
  it("exige segundo factor", () =>
    expect(
      voterLoginSchema.safeParse({ electionId, dni: "00000001" }).success,
    ).toBe(false));
  it.each([
    { kind: "VALIDO" },
    { kind: "BLANCO", listId },
    { kind: "NULO", listId },
    { kind: "VALIDO", listId, studentId: electionId },
    { kind: "INVALIDO" },
  ])("rechaza papeleta inválida %j", (x) =>
    expect(voteSchema.safeParse({ electionId, ...x }).success).toBe(false),
  );
  it.each([{ kind: "VALIDO", listId }, { kind: "BLANCO" }, { kind: "NULO" }])(
    "admite una opción válida %j",
    (x) =>
      expect(voteSchema.safeParse({ electionId, ...x }).success).toBe(true),
  );
});
describe("conciliación y permisos", () => {
  it("detecta empate sin proclamar ganador", () =>
    expect(
      electoralOutcome([
        { id: "a", votes: 2 },
        { id: "b", votes: 2 },
      ]).status,
    ).toBe("EMPATE"));
  it("distingue ausencia de votos válidos", () =>
    expect(electoralOutcome([{ id: "a", votes: 0 }]).status).toBe(
      "SIN_VOTOS_VALIDOS",
    ));
  it("verifica todas las sumas", () => {
    const s = {
      eligible: 5,
      voted: 4,
      ballots: 4,
      valid: 2,
      blank: 1,
      null: 1,
      lists: [{ votes: 2 }],
    };
    expect(assertReconciled(s)).toBe(true);
    expect(assertReconciled({ ...s, ballots: 5 })).toBe(false);
    expect(assertReconciled({ ...s, eligible: 3 })).toBe(false);
    expect(assertReconciled({ ...s, lists: [{ votes: 1 }] })).toBe(false);
  });
  it("deniega por defecto y a otra elección", () => {
    const g = [{ electionScope: "a", permissions: ["turnout:read"] }];
    expect(hasPermission(g, "results:read", "a")).toBe(false);
    expect(hasPermission(g, "turnout:read", "b")).toBe(false);
    expect(hasPermission(g, "turnout:read", "a")).toBe(true);
  });
  it("hash canónico independiente del orden de claves", () => {
    expect(canonical({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(digest({ b: 2, a: 1 })).toBe(digest({ a: 1, b: 2 }));
  });
});
describe("padrón y ventanas", () => {
  it("rechaza duplicados sin importar parcialmente", () => {
    const r = parseRoster(
      "dni,apellidos_nombres,grado,seccion,turno,habilitado\n00000001,Ana Demo,3,A,MANANA,true\n00000001,Ana Demo,3,A,MANANA,true",
    );
    expect(r.errors).toEqual([
      { row: 3, field: "dni", message: "Documento duplicado en el archivo." },
    ]);
  });
  it("valida turno, grado y elegibilidad", () =>
    expect(
      rosterRowSchema.safeParse({
        dni: "00000001",
        apellidos_nombres: "Ana Demo",
        grado: "9",
        seccion: "A",
        turno: "OTRO",
        habilitado: "yes",
      }).success,
    ).toBe(false));
  it("respeta cierre y horarios UTC", () => {
    const w = { state: "ABIERTA", startsAt: null, endsAt: null };
    expect(windowAvailable({ state: "EN_CURSO" }, w)).toBe(true);
    expect(windowAvailable({ state: "CERRADA" }, w)).toBe(false);
    expect(
      windowAvailable({ state: "EN_CURSO" }, { ...w, endsAt: new Date(0) }),
    ).toBe(false);
    expect(
      windowAvailable(
        { state: "EN_CURSO" },
        { ...w, startsAt: new Date(Date.now() + 60000) },
      ),
    ).toBe(false);
  });
});
