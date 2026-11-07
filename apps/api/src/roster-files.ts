import ExcelJS from "exceljs";
import { unzipSync } from "fflate";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { rosterRowSchema } from "../../../packages/shared/domain.js";
import { AppError } from "./security.js";

export const fields = [
  "dni",
  "apellidos_nombres",
  "grado",
  "seccion",
  "turno",
  "habilitado",
] as const;
export type RosterField = (typeof fields)[number];
export type RosterData = z.infer<typeof rosterRowSchema>;
export type RosterRow = { row: number; data: RosterData };
export type RosterIssue = { row: number; field?: string; message: string };
export const rosterInputSchema = z
  .object({
    csv: z.string().max(900000).optional(),
    file: z
      .object({
        name: z.string().min(1).max(150),
        base64: z.string().max(7000000),
      })
      .strict()
      .optional(),
    individual: rosterRowSchema.optional(),
    sheet: z.string().max(100).optional(),
    headerRow: z.number().int().min(1).max(50).default(1),
    mapping: z
      .record(z.enum(fields), z.number().int().min(0).max(49))
      .optional(),
    requestId: z.uuid().optional(),
    skipExisting: z.boolean().default(false),
    updateProfiles: z.boolean().default(false),
    reason: z.string().trim().max(300).default(""),
  })
  .strict()
  .refine(
    (v) =>
      [v.csv !== undefined, !!v.file, !!v.individual].filter(Boolean).length ===
      1,
    "Selecciona un archivo o completa el registro individual.",
  );
export type RosterInput = z.infer<typeof rosterInputSchema>;
type Cell = { text: string; invalid?: string };
export type Table = {
  sheet: string;
  sheets: { name: string; hidden: boolean }[];
  lines: { row: number; cells: Cell[] }[];
  warnings: string[];
};
const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
const alias: Record<RosterField, string[]> = {
  dni: ["dni", "documento", "documento de identidad"],
  apellidos_nombres: [
    "apellidos nombres",
    "nombres apellidos",
    "apellidos y nombres",
    "nombres y apellidos",
    "nombre completo",
  ],
  grado: ["grado"],
  seccion: ["seccion"],
  turno: ["turno"],
  habilitado: ["habilitado", "habilitacion", "habilitada"],
};
const fileError = (message: string) =>
  new AppError(400, "INVALID_ROSTER_FILE", message);

async function excelTable(
  input: RosterInput,
  schoolReport = false,
): Promise<Table> {
  const file = input.file!;
  if (!/\.xlsx$/i.test(file.name))
    throw fileError(
      "Usa un archivo .xlsx sin macros; guarda los .xls antiguos como .xlsx.",
    );
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64))
    throw fileError("Archivo Excel inválido.");
  const buffer = Buffer.from(file.base64, "base64");
  if (!buffer.length || buffer.length > 5 * 1024 * 1024)
    throw fileError("El Excel debe ocupar como máximo 5 MB.");
  try {
    let expanded = 0,
      entries = 0;
    const archive = unzipSync(buffer, {
      filter(entry) {
        expanded += entry.originalSize;
        if (++entries > 1000 || expanded > 16 * 1024 * 1024)
          throw fileError("El contenido del Excel supera el límite permitido.");
        if (/vbaProject|externalLinks/i.test(entry.name))
          throw fileError(
            "El Excel contiene macros o vínculos externos. Guarda una copia solo con valores.",
          );
        return /\.xml$/i.test(entry.name);
      },
    });
    if (!archive["xl/workbook.xml"])
      throw fileError("El archivo no es un libro Excel válido.");
    for (const [name, bytes] of Object.entries(archive)) {
      const xml = Buffer.from(bytes).toString("utf8");
      if (/<!DOCTYPE|<!ENTITY/i.test(xml))
        throw fileError("El archivo contiene elementos XML no admitidos.");
      if (/^xl\/worksheets\//.test(name)) {
        if (
          (xml.match(/<row\b/g) || []).length > 5050 ||
          (xml.match(/<c\b/g) || []).length > 252500
        )
          throw fileError("Usa hasta 5000 estudiantes y 50 columnas por hoja.");
        for (const match of xml.matchAll(/<row\b[^>]*\br="(\d+)"/g))
          if (Number(match[1]) > 5050)
            throw fileError(
              "Hay filas fuera del rango permitido; elimina el formato de filas sobrantes.",
            );
        for (const match of xml.matchAll(/<c\b[^>]*\br="([A-Z]+)(\d+)"/g)) {
          const column = [...match[1]].reduce(
            (n, c) => n * 26 + c.charCodeAt(0) - 64,
            0,
          );
          if (column > 50 || Number(match[2]) > 5050)
            throw fileError(
              "Hay celdas fuera del rango permitido de 5000 estudiantes y 50 columnas.",
            );
        }
      }
    }
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    if (!book.worksheets.length || book.worksheets.length > 20)
      throw fileError("El libro debe tener entre 1 y 20 hojas.");
    const sheet = input.sheet
      ? book.getWorksheet(input.sheet)
      : book.worksheets.find((s) => s.state === "visible") ||
        book.worksheets[0];
    if (!sheet) throw fileError("La hoja seleccionada ya no existe.");
    if (sheet.rowCount > 5050 || sheet.columnCount > 50)
      throw fileError("Usa hasta 5000 estudiantes y 50 columnas por hoja.");
    const warnings: string[] = [];
    if (sheet.state !== "visible")
      warnings.push("Seleccionaste una hoja oculta.");
    if (sheet.autoFilter)
      warnings.push(
        "La hoja tiene filtros: se revisarán también las filas filtradas.",
      );
    let hidden = 0;
    const lines: Table["lines"] = [];
    sheet.eachRow((row, number) => {
      if (row.hidden) hidden++;
      const cells: Cell[] = [];
      for (let i = 1; i <= sheet.columnCount; i++) {
        const cell = row.getCell(i);
        let invalid: string | undefined;
        if (
          cell.isMerged &&
          (!schoolReport || Number(cell.master.row) !== row.number)
        )
          invalid = "Separa las celdas combinadas entre filas.";
        else if (cell.type === ExcelJS.ValueType.Formula)
          invalid = "Reemplaza la fórmula por su valor antes de importar.";
        else if (
          cell.type === ExcelJS.ValueType.Date ||
          cell.type === ExcelJS.ValueType.Error
        )
          invalid =
            "La celda debe contener texto o un número válido, no una fecha o error.";
        // Never pad numeric DNI: if Excel removed zeros, the operator must correct it.
        const text =
          cell.value === null ||
          (schoolReport &&
            cell.isMerged &&
            cell.master.address !== cell.address)
            ? ""
            : cell.text.trim();
        cells.push({ text, ...(invalid ? { invalid } : {}) });
      }
      lines.push({ row: number, cells });
    });
    if (hidden)
      warnings.push(
        `Se incluirán ${hidden} filas ocultas con datos. Revisa la vista previa.`,
      );
    return {
      sheet: sheet.name,
      sheets: book.worksheets.map((s) => ({
        name: s.name,
        hidden: s.state !== "visible",
      })),
      lines,
      warnings,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw fileError(
      "No se pudo leer el Excel. Comprueba que no esté dañado o protegido con contraseña.",
    );
  }
}

export async function readSchoolTable(source: {
  file?: { name: string; base64: string };
  csv?: string;
}) {
  const input = rosterInputSchema.parse(source);
  return input.file ? excelTable(input, true) : csvTable(input.csv!);
}

function csvTable(csv: string, headerRow = 1): Table {
  try {
    const first =
      csv.replace(/^\uFEFF/, "").split(/\r?\n/)[headerRow - 1] || "";
    const delimiter =
      (first.match(/;/g) || []).length > (first.match(/,/g) || []).length
        ? ";"
        : ",";
    const records = parse(csv, {
      bom: true,
      delimiter,
      info: true,
      relax_column_count: true,
      max_record_size: 8192,
      trim: true,
    });
    let previous = 0;
    const lines: Table["lines"] = records.map((r: any) => {
      const row = previous + 1;
      previous = r.info.lines;
      return { row, cells: r.record.map((s: string) => ({ text: s.trim() })) };
    });
    if (lines.length > 5050 || lines.some((r) => r.cells.length > 50))
      throw fileError("Usa hasta 5000 estudiantes y 50 columnas.");
    return { sheet: "CSV", sheets: [], lines, warnings: [] };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw fileError(
      "El CSV no es válido. Usa UTF-8 y separadores de coma o punto y coma.",
    );
  }
}

export async function inspectRoster(input: RosterInput) {
  if (input.individual)
    return {
      sheet: "Individual",
      sheets: [],
      headers: [...fields],
      mapping: Object.fromEntries(fields.map((f, i) => [f, i])),
      sample: [],
      warnings: [],
    };
  const table = input.file
    ? await excelTable(input)
    : csvTable(input.csv!, input.headerRow);
  return inspectTable(table, input);
}
function inspectTable(table: Table, input: RosterInput) {
  const headers =
    table.lines
      .find((r) => r.row === input.headerRow)
      ?.cells.map((c) => c.text) || [];
  const mapping: Partial<Record<RosterField, number>> = {};
  for (const field of fields) {
    const matches = headers.flatMap((h, i) =>
      alias[field].includes(normalize(h).replace(/_/g, " ")) ? [i] : [],
    );
    if (matches.length === 1) mapping[field] = matches[0];
  }
  return {
    sheet: table.sheet,
    sheets: table.sheets,
    headers,
    mapping,
    sample: table.lines
      .filter((r) => r.row > input.headerRow)
      .slice(0, 5)
      .map((r) => ({ row: r.row, values: r.cells.map((c) => c.text) })),
    warnings: [
      ...table.warnings,
      ...(!headers.length
        ? [
            "No hay encabezados en esta fila. Selecciona otra hoja o fila de encabezados.",
          ]
        : []),
    ],
  };
}
export function parseRoster(csv: string) {
  const input = rosterInputSchema.parse({ csv });
  return parseTable(csvTable(csv), input);
}
export async function parseRosterInput(input: RosterInput) {
  if (input.individual)
    return {
      sheet: "Individual",
      rows: [{ row: 1, data: input.individual }],
      errors: [] as RosterIssue[],
      total: 1,
      warnings: [] as string[],
    };
  return parseTable(
    input.file
      ? await excelTable(input)
      : csvTable(input.csv!, input.headerRow),
    input,
  );
}
function parseTable(table: Table, input: RosterInput) {
  const info = inspectTable(table, input);
  if (!info.headers.length)
    throw fileError("No se encontró la fila de encabezados indicada.");
  const mapping = input.mapping || info.mapping;
  if (
    fields.some(
      (f) => mapping[f] === undefined || mapping[f]! >= info.headers.length,
    ) ||
    new Set(fields.map((f) => mapping[f])).size !== fields.length
  )
    throw fileError(
      "Asocia una columna distinta a cada campo. Revisa los encabezados ausentes o repetidos.",
    );
  const lines = table.lines.filter(
    (r) =>
      r.row > input.headerRow &&
      r.cells.some((c) => c.text !== "" || c.invalid),
  );
  if (!lines.length || lines.length > 5000)
    throw fileError("Importa entre 1 y 5000 estudiantes.");
  const rows: RosterRow[] = [],
    errors: RosterIssue[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const value: Record<string, string> = {};
    let invalid = false;
    for (const field of fields) {
      const c = line.cells[mapping[field]!] || { text: "" };
      value[field] = c.text;
      if (c.invalid) {
        errors.push({ row: line.row, field, message: c.invalid });
        invalid = true;
      }
    }
    value.seccion = value.seccion.toUpperCase();
    value.turno = normalize(value.turno).toUpperCase();
    const enabled = normalize(value.habilitado);
    value.habilitado = ["true", "si", "1"].includes(enabled)
      ? "true"
      : ["false", "no", "0"].includes(enabled)
        ? "false"
        : enabled;
    const result = rosterRowSchema.safeParse(value);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = String(issue.path[0]);
        const message = (
          {
            dni: "Documento: escribe exactamente 8 dígitos; conserva los ceros iniciales.",
            apellidos_nombres: "Nombres y apellidos: entre 3 y 150 caracteres.",
            grado: "Grado: utiliza un número de 1 a 6.",
            seccion: "Sección: una o dos letras.",
            turno: "Turno: Mañana o Tarde.",
            habilitado: "Habilitado: Sí/No o true/false.",
          } as Record<string, string>
        )[field];
        errors.push({ row: line.row, field, message });
      }
      continue;
    }
    if (invalid) continue;
    if (seen.has(result.data.dni)) {
      errors.push({
        row: line.row,
        field: "dni",
        message: "Documento duplicado en el archivo.",
      });
      continue;
    }
    seen.add(result.data.dni);
    rows.push({ row: line.row, data: result.data });
  }
  return {
    sheet: table.sheet,
    rows,
    errors,
    total: lines.length,
    warnings: table.warnings,
  };
}

export async function rosterTemplate() {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Padrón");
  sheet.columns = fields.map((f) => ({
    header: f,
    key: f,
    width: f === "apellidos_nombres" ? 35 : 18,
  }));
  sheet.getColumn("dni").numFmt = "@";
  sheet.addRow(["00000101", "Estudiante Ejemplo", 3, "A", "MANANA", "true"]);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  return book.xlsx.writeBuffer();
}
