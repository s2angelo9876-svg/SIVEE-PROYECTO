import { expect, it } from "vitest";
import crypto from "node:crypto";
import {
  parseSchoolFile,
  schoolSourceSchema,
  schoolIssues,
  schoolHeaders,
  schoolTemplate,
} from "../apps/api/src/school-files";
import { encryptDocument, decryptDocument } from "../apps/api/src/private-data";
import { schoolShift } from "../apps/api/src/school-shifts";
import { schoolFixture } from "./school-fixture";
it("solo clasificar explícitamente como extranjero permite usar matrícula sin DNI", () => {
  expect(schoolIssues({ document: "", isForeign: false })).toHaveLength(1);
  expect(schoolIssues({ document: "", isForeign: true })).toEqual([]);
  expect(schoolIssues({ document: "ABC123456", isForeign: true })).toEqual([]);
  expect(schoolIssues({ document: "12345678", isForeign: true })).toEqual([]);
});
it("lee 1742 filas, encabezados dobles y celdas combinadas sin inventar turnos", async () => {
  const { rows } = await parseSchoolFile(
    schoolSourceSchema.parse(await schoolFixture()),
  );
  expect(rows).toHaveLength(1742);
  expect(rows[0].sourceRow).toBe(13);
  expect(rows.at(-1)?.sourceRow).toBe(1754);
  expect(rows.filter((r) => !r.document)).toHaveLength(20);
  expect(
    rows.filter((r) => r.document && r.document.length !== 8),
  ).toHaveLength(5);
  expect(rows.filter((r) => r.enrollment !== "DEFINITIVA")).toHaveLength(2);
  expect(rows.every((r) => r.shift === null)).toBe(true);
  expect(rows.filter((r) => schoolIssues(r).length > 0)).toHaveLength(25);
  expect(schoolIssues(rows[30])).toEqual([]);
  expect(rows[0].grade).toBe("1");
  expect(rows[0].section).toBe("HONESTIDAD Y RESPETO");
  expect(Object.keys(rows[0])).not.toContain("sex");
});
it("acepta CSV escolar con ceros iniciales y rechaza referencias duplicadas", async () => {
  const row =
    "1;PRIMERO;PAZ;00123456;00001234;Persona Ejemplo;;;;DEFINITIVA;;Mañana";
  const input = {
    csv: schoolHeaders.join(";") + "\n" + row,
    requestId: crypto.randomUUID(),
  };
  const { rows } = await parseSchoolFile(schoolSourceSchema.parse(input));
  expect(rows[0].document).toBe("00123456");
  expect(rows[0].studentCode).toBe("00001234");
  expect(rows[0].shift).toBe("MANANA");
  expect(schoolIssues(rows[0])).toEqual([]);
  await expect(
    parseSchoolFile(
      schoolSourceSchema.parse({ ...input, csv: input.csv + "\n" + row }),
    ),
  ).rejects.toThrow(/repetido/);
});
it("la plantilla se puede volver a importar sin exigir turno", async () => {
  const input = schoolSourceSchema.parse({
    requestId: crypto.randomUUID(),
    file: {
      name: "plantilla.xlsx",
      base64: Buffer.from(await schoolTemplate()).toString("base64"),
    },
  });
  const { rows } = await parseSchoolFile(input);
  expect(rows).toHaveLength(1);
  expect(rows[0].document).toBe("00000101");
  expect(rows[0].shift).toBe("MANANA");
  expect(schoolIssues(rows[0])).toEqual([]);
});
it("documentos de borrador se cifran con nonce aleatorio y autenticación", () => {
  const a = encryptDocument("00123456"),
    b = encryptDocument("00123456");
  expect(a).not.toBe(b);
  expect(a).not.toContain("00123456");
  expect(decryptDocument(a)).toBe("00123456");
  const parts = a.split(".");
  parts[2] = Buffer.alloc(8).toString("base64url");
  expect(() => decryptDocument(parts.join("."))).toThrow();
});

it("clasifica por grado y sección conforme a la imagen y a Gabriel García Márquez confirmado", () => {
  expect(schoolShift("1", "G")).toBe("MANANA");
  expect(schoolShift("1", "H")).toBe("TARDE");
  for (const grade of ["2", "3", "4", "5"]) {
    expect(schoolShift(grade, "F")).toBe("MANANA");
    expect(schoolShift(grade, "G")).toBe("TARDE");
  }
  expect(schoolShift("1", "tolerancia")).toBe("MANANA");
  expect(schoolShift("1", "EMPATÍA")).toBe("TARDE");
  expect(schoolShift("3", "JAVIER HERAUD PÉREZ")).toBe("TARDE");
  expect(schoolShift("3", "Gabriel García Márquez")).toBe("TARDE");
  expect(schoolShift("4", "LEONHARD EULER")).toBe("MANANA");
  expect(schoolShift("5", "RENÉ DESCARTES")).toBe("TARDE");
  expect(schoolShift("1", "HONESTIDAD Y RESPETO")).toBeNull();
  expect(schoolShift("3", "L")).toBeNull();
});
