import ExcelJS from "exceljs";
import crypto from "node:crypto";
// Synthetic students only; mirrors the report's layout, never the uploaded data.
export async function schoolFixture(count = 1742, issues = true) {
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet("rptListadoEstudiantes");
  sheet.getCell("A1").value = "Reporte sintético de matrícula";
  sheet.getCell("B11").value = "GRADO";
  sheet.getCell("C11").value = "SECCIÓN";
  [
    "ITEM",
    "",
    "",
    "NÚMERO DE DOCUMENTO",
    "",
    "CÓDIGO DEL ESTUDIANTE",
    "",
    "ESTUDIANTE",
    "SEXO",
    "FECHA DE NACIMIENTO",
    "EDAD (AL 31 DE MARZO)",
    "ESTADO DE MATRICULA",
    "TIPO DE VACANTE",
  ].forEach((v, i) => (sheet.getRow(12).getCell(i + 1).value = v));
  for (let i = 0; i < count; i++) {
    const n = 13 + i;
    const document =
      issues && i < 20
        ? ""
        : issues && i < 25
          ? "123456789" + i
          : String(10000000 + i);
    sheet.getRow(n).values = [
      i + 1,
      "PRIMERO",
      "HONESTIDAD Y RESPETO",
      document,
      "",
      "MATRICULA-" + i,
      "",
      "Estudiante Sintético " + i,
      "M",
      new Date(2013, 0, 1),
      13,
      issues && [25, 26].includes(i) ? "EN PROCESO" : "DEFINITIVA",
      "REGULAR",
    ];
    sheet.mergeCells(`F${n}:G${n}`);
  }
  return {
    requestId: crypto.randomUUID(),
    file: {
      name: "sintetico.xlsx",
      base64: Buffer.from(await book.xlsx.writeBuffer()).toString("base64"),
    },
  };
}
