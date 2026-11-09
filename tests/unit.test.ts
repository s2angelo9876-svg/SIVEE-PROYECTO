import { validateListLogo } from "../apps/api/src/list-logo";
import { logoPng, logoData } from "./list-logo.fixture";
import { describe, it, expect } from "vitest";
import {
  voterLoginSchema,
  listSchema,
  voteSchema,
  electoralOutcome,
  assertReconciled,
  hasPermission,
  rosterRowSchema,
} from "../packages/shared/domain";
import { windowAvailable, votingAvailable } from "../apps/api/src/services";
import { parseRoster } from "../apps/api/src/roster-files";
import { canonical, digest } from "../apps/api/src/security";
import { totp } from "../apps/api/src/mfa";
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

it("DNI permite cualquier turno, pero respeta pausa, cierre y horarios; CODE conserva su turno", () => {
  const morning = {
    shift: "MANANA",
    state: "ABIERTA",
    startsAt: null,
    endsAt: null,
  };
  const afternoon = { ...morning, shift: "TARDE", state: "PROGRAMADA" };
  const election = {
    state: "EN_CURSO",
    authMode: "DESK",
    windows: [morning, afternoon],
  };
  expect(votingAvailable(election, "TARDE")).toBe(true);
  expect(votingAvailable({ ...election, authMode: "CODE" }, "TARDE")).toBe(
    false,
  );
  expect(votingAvailable({ ...election, state: "PAUSADA" }, "MANANA")).toBe(
    false,
  );
  expect(
    votingAvailable(
      { ...election, windows: [{ ...morning, state: "CERRADA" }] },
      "TARDE",
    ),
  ).toBe(false);
  expect(
    votingAvailable(
      { ...election, windows: [{ ...morning, endsAt: new Date(0) }] },
      "TARDE",
    ),
  ).toBe(false);
  expect(
    votingAvailable(
      {
        ...election,
        windows: [{ ...morning, startsAt: new Date(Date.now() + 60000) }],
      },
      "TARDE",
    ),
  ).toBe(false);
});

// Public reference secret and expected values from RFC 6238, SHA-1, six digits.
describe("TOTP compatible con autenticadores estándar", () => {
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ])("coincide con RFC 6238 en t=%i", (seconds, expected) => {
    expect(
      totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", Math.floor(seconds / 30)),
    ).toBe(expected);
  });
});

describe("logos de listas", () => {
  it("acepta un PNG real y conserva símbolos de elecciones anteriores", () => {
    expect(() => validateListLogo(logoData(logoPng()))).not.toThrow();
    expect(() => validateListLogo("sprout")).not.toThrow();
  });
  it("rechaza SVG, enlaces externos y datos arbitrarios en el contrato", () => {
    const list = {
      number: 1,
      name: "Lista de prueba",
      color: "#0b1f3a",
      candidates: [{ name: "Persona Ejemplo", position: "Alcaldía" }],
      proposal: "",
    };
    for (const symbol of [
      "https://example.com/logo.png",
      "data:image/svg+xml;base64,PHN2Zz4=",
      "data:text/html;base64,PHNjcmlwdD4=",
    ])
      expect(listSchema.safeParse({ ...list, symbol }).success).toBe(false);
    expect(
      listSchema.safeParse({ ...list, symbol: logoData(logoPng()) }).success,
    ).toBe(true);
  });
  it("rechaza contenido falso, tipo incorrecto y límites de tamaño y resolución", () => {
    expect(() =>
      validateListLogo(logoData(Buffer.from("not a PNG"))),
    ).toThrow();
    expect(() =>
      validateListLogo(logoData(logoPng()).replace("image/png", "image/jpeg")),
    ).toThrow();
    expect(() => validateListLogo(logoData(logoPng(1025, 1)))).toThrow(/1024/);
    expect(() => validateListLogo(logoData(logoPng(2, 2, 300000)))).toThrow(
      /300 KB/,
    );
  });
});
