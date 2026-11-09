import { z } from "zod";
import ExcelJS from "exceljs";
import { readSchoolTable } from "./roster-files.js";
import { AppError } from "./security.js";
import { schoolShift } from "./school-shifts.js";

export const schoolRowSchema = z
  .object({
    studentCode: z.string().trim().min(1).max(60),
    document: z.string().trim().max(30),
    displayName: z.string().trim().min(3).max(150),
    grade: z.string().trim().max(30),
    section: z.string().trim().max(100),
    shift: z.enum(["MANANA", "TARDE"]).nullable().default(null),
    enrollment: z.string().trim().max(60).default("DEFINITIVA"),
  })
  .strict();
export type SchoolRow = z.infer<typeof schoolRowSchema> & { sourceRow: number };
export const schoolSourceSchema = z
  .object({
    file: z
      .object({
        name: z.string().min(1).max(150),
        base64: z.string().max(7000000),
      })
      .strict()
      .optional(),
    csv: z.string().max(900000).optional(),
    individual: schoolRowSchema.optional(),
    requestId: z.uuid(),
  })
  .strict()
  .refine(
    (x) =>
      [!!x.file, x.csv !== undefined, !!x.individual].filter(Boolean).length ===
      1,
  );
const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replaceAll("_", " ");
const aliases: Record<string, string[]> = {
  document: ["NUMERO DE DOCUMENTO", "DNI"],
  studentCode: ["CODIGO DEL ESTUDIANTE", "CODIGO ESTUDIANTE"],
  displayName: ["ESTUDIANTE", "APELLIDOS NOMBRES", "NOMBRES Y APELLIDOS"],
  grade: ["GRADO"],
  section: ["SECCION"],
  enrollment: ["ESTADO DE MATRICULA"],
  shift: ["TURNO"],
};
export async function parseSchoolFile(
  input: z.infer<typeof schoolSourceSchema>,
) {
  if (input.individual)
    return {
      rows: [
        {
          ...input.individual,
          shift:
            schoolShift(input.individual.grade, input.individual.section) ??
            input.individual.shift,
          sourceRow: 1,
        },
      ],
      warnings: [] as string[],
    };
  const table = await readSchoolTable(input);
  const index = table.lines.findIndex(
    (r) =>
      r.row <= 50 &&
      r.cells.some((c) => aliases.document.includes(normalize(c.text))),
  );
  if (index < 0)
    throw new AppError(
      400,
      "HEADERS_NOT_FOUND",
      "No se encontró NÚMERO DE DOCUMENTO o DNI en las primeras 50 filas.",
    );
  const header = table.lines[index],
    previous = table.lines[index - 1];
  const columns: Record<string, number> = {};
  for (const [field, names] of Object.entries(aliases)) {
    const matches = header.cells.flatMap((c, i) =>
      names.includes(normalize(c.text)) ? [i] : [],
    );
    // The institutional report puts GRADO and SECCIÓN on the preceding row.
    if (
      !matches.length &&
      ["grade", "section"].includes(field) &&
      previous?.row === header.row - 1
    )
      previous.cells.forEach((c, i) => {
        if (names.includes(normalize(c.text))) matches.push(i);
      });
    if (matches.length > 1)
      throw new AppError(
        400,
        "AMBIGUOUS_HEADER",
        `Encabezado repetido: ${names[0]}.`,
      );
    if (matches.length) columns[field] = matches[0];
  }
  for (const field of [
    "document",
    "studentCode",
    "displayName",
    "grade",
    "section",
  ])
    if (columns[field] === undefined)
      throw new AppError(
        400,
        "MISSING_COLUMN",
        `Falta la columna ${aliases[field][0]}.`,
      );
  const rows: SchoolRow[] = [],
    codes = new Set<string>();
  for (const line of table.lines.filter(
    (r) => r.row > header.row && r.cells.some((c) => c.text),
  )) {
    const values: Record<string, string> = {};
    for (const [field, col] of Object.entries(columns)) {
      const cell = line.cells[col];
      if (cell?.invalid)
        throw new AppError(
          400,
          "INVALID_CELL",
          `Fila ${line.row}: ${cell.invalid}`,
        );
      values[field] = cell?.text || "";
    }
    const grades = [
      "PRIMERO",
      "SEGUNDO",
      "TERCERO",
      "CUARTO",
      "QUINTO",
      "SEXTO",
    ];
    const gradeIndex = grades.indexOf(normalize(values.grade));
    const parsed = schoolRowSchema.safeParse({
      ...values,
      grade: gradeIndex < 0 ? values.grade : String(gradeIndex + 1),
      section: values.section.toUpperCase(),
      enrollment: normalize(values.enrollment || "DEFINITIVA"),
      shift: values.shift ? normalize(values.shift) : null,
    });
    if (!parsed.success)
      throw new AppError(
        400,
        "INVALID_SCHOOL_ROW",
        `Fila ${line.row}: revisa código de estudiante, nombre, tamaños y turno. No se importó ninguna fila.`,
      );
    if (codes.has(parsed.data.studentCode))
      throw new AppError(
        400,
        "DUPLICATE_STUDENT_CODE",
        `Código de estudiante repetido en la fila ${line.row}.`,
      );
    codes.add(parsed.data.studentCode);
    rows.push({
      ...parsed.data,
      shift:
        schoolShift(parsed.data.grade, parsed.data.section) ??
        parsed.data.shift,
      sourceRow: line.row,
    });
  }
  if (!rows.length || rows.length > 5000)
    throw new AppError(
      400,
      "INVALID_ROW_COUNT",
      "El archivo debe tener entre 1 y 5000 estudiantes.",
    );
  return {
    rows,
    warnings: [
      ...table.warnings,
      "Sexo, nacimiento, edad y tipo de vacante se reconocen como columnas del reporte; no se almacenan ni se usan para autenticar.",
    ],
  };
}
export function schoolIssues(row: { document: string; excluded?: boolean }) {
  if (row.excluded) return [];
  return [
    !/^\d{8}$/.test(row.document) &&
      "Sin DNI válido de ocho dígitos: no puede votar hasta corregirlo.",
  ].filter(Boolean) as string[];
}
export const schoolHeaders = [
  "ITEM",
  "GRADO",
  "SECCIÓN",
  "NÚMERO DE DOCUMENTO",
  "CÓDIGO DEL ESTUDIANTE",
  "ESTUDIANTE",
  "SEXO",
  "FECHA DE NACIMIENTO",
  "EDAD (AL 31 DE MARZO)",
  "ESTADO DE MATRICULA",
  "TIPO DE VACANTE",
  "TURNO",
];
export async function schoolTemplate() {
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet("Estudiantes");
  sheet.addRow(schoolHeaders);
  sheet.getColumn(4).numFmt = "@";
  sheet.getColumn(5).numFmt = "@";
  sheet.addRow([
    1,
    "PRIMERO",
    "HONESTIDAD",
    "00000101",
    "MATRICULA-101",
    "Estudiante Ejemplo",
    "",
    "",
    "",
    "DEFINITIVA",
    "",
    "",
  ]);
  sheet.columns.forEach((c) => {
    c.width = 24;
  });
  sheet.getRow(1).font = { bold: true };
  return book.xlsx.writeBuffer();
}
