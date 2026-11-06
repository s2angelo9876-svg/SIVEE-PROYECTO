import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { zipSync, strToU8, type Zippable } from "fflate";
import {
  inspectRoster,
  parseRosterInput,
  parseRoster,
  rosterInputSchema,
  rosterTemplate,
} from "../apps/api/src/roster-files";
import { credentialExpiry } from "../apps/api/src/roster";
const headers = "dni,apellidos_nombres,grado,seccion,turno,habilitado";
async function bookInput(
  configure: (book: ExcelJS.Workbook) => void,
  extra: Record<string, unknown> = {},
) {
  const book = new ExcelJS.Workbook();
  configure(book);
  return rosterInputSchema.parse({
    file: {
      name: "padron.xlsx",
      base64: Buffer.from(await book.xlsx.writeBuffer()).toString("base64"),
    },
    ...extra,
  });
}
describe("archivos de padrón", () => {
  it("conserva números de fila después de errores y líneas vacías", () => {
    const p = parseRoster(
      headers +
        "\nmal,Ana Demo,3,A,MANANA,true\n\n00000002,Luz Demo,3,A,TARDE,true\n00000002,Luz Demo,3,A,TARDE,true",
    );
    expect(p.total).toBe(3);
    expect(p.rows[0].row).toBe(4);
    expect(p.errors.map((e) => e.row)).toEqual([2, 5]);
  });
  it("acepta CSV de Excel con BOM, punto y coma y nombres en español", () => {
    const p = parseRoster(
      "\uFEFFDNI;Nombres y apellidos;Grado;Sección;Turno;Habilitado\n00000101;María Ejemplo;3;a;Mañana;Sí",
    );
    expect(p.errors).toEqual([]);
    expect(p.rows[0].data).toMatchObject({
      dni: "00000101",
      seccion: "A",
      turno: "MANANA",
      habilitado: "true",
    });
  });
  it("no asigna automáticamente encabezados duplicados", () => {
    expect(() =>
      parseRoster(headers + ",dni\n00000101,Ana Demo,3,A,MANANA,true,00000102"),
    ).toThrow(/Asocia/);
  });
  it("respeta la fila de encabezados y asociación personalizada", async () => {
    const input = rosterInputSchema.parse({
      csv: "Padrón autorizado\nID;Persona;Nivel;Grupo;Jornada;Permiso\n00000101;Ana Demo;3;B;Tarde;No",
      headerRow: 2,
      mapping: {
        dni: 0,
        apellidos_nombres: 1,
        grado: 2,
        seccion: 3,
        turno: 4,
        habilitado: 5,
      },
    });
    const p = await parseRosterInput(input);
    expect(p.rows[0]).toMatchObject({
      row: 3,
      data: { dni: "00000101", habilitado: "false" },
    });
    expect(p.errors).toEqual([]);
  });
  it("lee la hoja elegida, conserva ceros e informa filas ocultas", async () => {
    const input = await bookInput(
      (book) => {
        book.addWorksheet("Notas").addRow(["No importar"]);
        const sheet = book.addWorksheet("Electores");
        sheet.addRow(headers.split(","));
        sheet.addRow(["00000101", "Ana Demo", 3, "A", "Mañana", true]);
        sheet.getRow(2).hidden = true;
      },
      { sheet: "Electores" },
    );
    const info = await inspectRoster(input),
      p = await parseRosterInput(input);
    expect(info.sheets).toHaveLength(2);
    expect(info.warnings[0]).toContain("ocultas");
    expect(p.rows[0].data.dni).toBe("00000101");
    expect(p.errors).toEqual([]);
  });
  it("permite elegir otra hoja cuando la primera está vacía", async () => {
    const input = await bookInput((book) => {
      book.addWorksheet("Vacía");
      const sheet = book.addWorksheet("Electores");
      sheet.addRow(headers.split(","));
      sheet.addRow(["00000101", "Ana Demo", 3, "A", "MANANA", true]);
    });
    const info = await inspectRoster(input);
    expect(info.sheets.map((s) => s.name)).toEqual(["Vacía", "Electores"]);
    expect(info.headers).toEqual([]);
    expect(info.warnings[0]).toContain("Selecciona otra hoja");
    await expect(parseRosterInput(input)).rejects.toThrow(/encabezados/);
    const parsed = await parseRosterInput({ ...input, sheet: "Electores" });
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.errors).toEqual([]);
  });
  it("rechaza DNI numérico truncado, fórmulas y fechas sin inferir valores", async () => {
    const input = await bookInput((book) => {
      const sheet = book.addWorksheet("Padrón");
      sheet.addRow(headers.split(","));
      sheet.addRow([101, "Ana Demo", 3, "A", "MANANA", true]);
      sheet.addRow([
        "00000102",
        { formula: '"Ana Demo"', result: "Ana Demo" },
        3,
        "A",
        "MANANA",
        true,
      ]);
      sheet.addRow([
        new Date("2026-01-01"),
        "Ana Demo",
        3,
        "A",
        "MANANA",
        true,
      ]);
    });
    const p = await parseRosterInput(input);
    expect(p.rows).toHaveLength(0);
    expect(new Set(p.errors.map((e) => e.row)).size).toBe(3);
    expect(p.errors.some((e) => /fórmula/.test(e.message))).toBe(true);
  });
  it("rechaza archivos corruptos y formatos no admitidos", async () => {
    await expect(
      inspectRoster(
        rosterInputSchema.parse({
          file: { name: "padron.xlsx", base64: "YWJj" },
        }),
      ),
    ).rejects.toThrow(/leer/);
    await expect(
      inspectRoster(
        rosterInputSchema.parse({
          file: { name: "padron.xlsm", base64: "YWJj" },
        }),
      ),
    ).rejects.toThrow(/sin macros/);
  });
  it("limita la expansión del ZIP antes de cargar el libro", async () => {
    const compressed = zipSync({
      "xl/workbook.xml": new Uint8Array(17 * 1024 * 1024),
    });
    await expect(
      inspectRoster(
        rosterInputSchema.parse({
          file: {
            name: "padron.xlsx",
            base64: Buffer.from(compressed).toString("base64"),
          },
        }),
      ),
    ).rejects.toThrow(/límite/);
  });
  it("rechaza vínculos externos y declaraciones de entidades XML", async () => {
    const archives: Zippable[] = [
      {
        "xl/workbook.xml": strToU8("<xml/>"),
        "xl/externalLinks/externalLink1.xml": strToU8("<xml/>"),
      },
      {
        "xl/workbook.xml": strToU8(
          '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///tmp/example">]><x/>',
        ),
      },
    ];
    for (const files of archives)
      await expect(
        inspectRoster(
          rosterInputSchema.parse({
            file: {
              name: "padron.xlsx",
              base64: Buffer.from(zipSync(files)).toString("base64"),
            },
          }),
        ),
      ).rejects.toThrow();
  });
  it("la plantilla Excel descargada se puede volver a importar", async () => {
    const p = await parseRosterInput(
      rosterInputSchema.parse({
        file: {
          name: "plantilla.xlsx",
          base64: Buffer.from(await rosterTemplate()).toString("base64"),
        },
      }),
    );
    expect(p.errors).toEqual([]);
    expect(p.rows[0].data.dni).toBe("00000101");
  });
  it("los códigos cubren una jornada programada más allá de 30 días", () => {
    const now = Date.parse("2026-11-06T12:00:00Z"),
      end = new Date("2027-03-03T23:00:00Z");
    expect(+credentialExpiry([{ startsAt: null, endsAt: end }], now)).toBe(
      +end + 86400000,
    );
    expect(+credentialExpiry([], now)).toBe(now + 30 * 86400000);
  });
});
