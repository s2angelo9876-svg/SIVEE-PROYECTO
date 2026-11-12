import { useEffect, useState } from "react";
import { useAdmin } from "./Admin";
import {
  api,
  Field,
  Notice,
  PageTitle,
  Modal,
  DownloadLink,
  downloadText,
  csvCell,
  dateFormat,
  shiftLabel,
  readBase64,
} from "./lib";

export function SchoolRoster() {
  const { id } = useAdmin();
  return <SchoolRosterScreen key={id} />;
}
function SchoolRosterScreen() {
  const { id, election, can } = useAdmin(),
    root = `/admin/elections/${id}/roster/school`;
  const editable = can("roster:write") && election.state === "BORRADOR";
  const foreignEditable =
    can("roster:write") &&
    ["BORRADOR", "PREPARADA", "EN_CURSO", "PAUSADA"].includes(election.state);
  const [data, setData] = useState<any>(),
    [source, setSource] = useState<any>(),
    [preview, setPreview] = useState<any>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [query, setQuery] = useState(""),
    [accessFilter, setAccessFilter] = useState(""),
    [pendingOnly, setPendingOnly] = useState(false),
    [page, setPage] = useState(0);
  const [previewPage, setPreviewPage] = useState(0);
  const [form, setForm] = useState<any>(),
    [reason, setReason] = useState(""),
    [shiftFilter, setShiftFilter] = useState("");
  const load = async () => {
    if (editable) await api(root + "/register", { method: "POST", body: {} });
    setData(await api(root));
  };
  useEffect(() => {
    if (can("roster:write")) void load().catch((e) => setError(e.message));
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const rows = (data?.rows || []).filter(
    (r: any) =>
      (!pendingOnly || r.issues.length || (!r.publishedAt && !r.excluded)) &&
      (!accessFilter || (r.isForeign ? "FOREIGN" : "DNI") === accessFilter) &&
      (!shiftFilter || (r.shift || "UNKNOWN") === shiftFilter) &&
      `${r.displayName} ${r.studentCode} ${r.section}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  const foreignCandidates = (data?.rows || []).filter(
    (r: any) => r.foreignCandidate,
  );
  if (!can("roster:write"))
    return (
      <Notice>Esta pantalla requiere permiso de operador de padrón.</Notice>
    );
  const blank = () => ({
    requestId: crypto.randomUUID(),
    studentCode: "",
    document: "",
    displayName: "",
    grade: "1",
    section: "",
    shift: null,
    enrollment: "DEFINITIVA",
    enrollmentApproved: false,
    isForeign: false,
    excluded: false,
  });
  const inputFields = [
    "studentCode",
    "document",
    "displayName",
    "grade",
    "section",
    "enrollment",
  ];
  const labels: Record<string, string> = {
    studentCode: "Código del estudiante / matrícula",
    document: "Número de documento",
    displayName: "Estudiante: nombres y apellidos",
    grade: "Grado",
    section: "Sección",
    enrollment: "Estado de matrícula",
  };
  return (
    <>
      <PageTitle
        title="Padrón del colegio"
        description="Los estudiantes se registran automáticamente al importar. Los turnos se separan según el grado y la sección, sin limitar el acceso a votar."
        action={
          editable && (
            <button
              className="button"
              onClick={() => {
                setForm(blank());
                setReason("");
              }}
            >
              Registrar estudiante
            </button>
          )
        }
      />
      {error && <Notice>{error}</Notice>}
      {message && <Notice success>{message}</Notice>}
      {data && (
        <div className="compact-stats">
          <span>
            <strong>{data.total}</strong> registrados
          </span>
          <span>
            <strong>{data.eligible}</strong> habilitados para votar
          </span>
          <span>
            <strong>{data.unavailable}</strong> sin DNI habilitado
          </span>
          {data.foreign > 0 && (
            <span>
              <strong>{data.foreign}</strong> extranjeros con matrícula
            </span>
          )}
          <span>
            <strong>{data.shifts.MANANA}</strong> mañana
          </span>
          <span>
            <strong>{data.shifts.TARDE}</strong> tarde
          </span>
          {data.shifts.UNKNOWN > 0 && (
            <span>
              <strong>{data.shifts.UNKNOWN}</strong> sin turno identificado
            </span>
          )}
          <span>
            <strong>{data.excluded}</strong> excluidos con motivo
          </span>
        </div>
      )}
      {data && (
        <section
          className="panel"
          aria-label="Resumen de extranjeros por turno"
        >
          <h2>Extranjeros por turno</h2>
          <p>
            Registros clasificados como extranjeros en esta elección. Comprueba
            su habilitación en la columna Estado.
          </p>
          <div className="compact-stats">
            <span>
              <strong>{data.foreign}</strong> extranjeros en total
            </span>
            <span>
              <strong>{data.foreignShifts.MANANA}</strong> extranjeros de mañana
            </span>
            <span>
              <strong>{data.foreignShifts.TARDE}</strong> extranjeros de tarde
            </span>
            <span>
              <strong>{data.foreignShifts.UNKNOWN}</strong> extranjeros sin
              turno identificado
            </span>
          </div>
          <p>
            Estos totales corresponden al padrón completo de la elección y no
            cambian al filtrar la tabla.
          </p>
        </section>
      )}
      {foreignEditable && foreignCandidates.length > 0 && (
        <section className="panel">
          <h2>Estudiantes extranjeros sin DNI</h2>
          <p>
            Si el colegio identifica estos registros como estudiantes
            extranjeros, pueden usar su código de matrícula del Excel. No se
            genera un DNI ni un código nuevo.
          </p>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await api(root + "/foreign-students", {
                  method: "POST",
                  body: {
                    rowIds: foreignCandidates.map((r: any) => r.id),
                    reason:
                      "El colegio declara estos registros como extranjeros; acceso con su matrícula existente.",
                  },
                });
                await load();
                setMessage(
                  `${result.registered} estudiantes extranjeros habilitados con su matrícula.`,
                );
              })
            }
          >
            Habilitar {foreignCandidates.length} como extranjeros con matrícula
          </button>
        </section>
      )}
      {editable && (
        <section className="panel">
          <h2>Cargar Excel o CSV del colegio</h2>
          <p>
            Se reconocen los encabezados del reporte institucional, incluidos
            los de dos filas y celdas combinadas. Hasta 5000 estudiantes. Excel
            5 MB; CSV 900 KB.
          </p>
          <div className="roster-actions">
            <DownloadLink href={root + "/template.xlsx"}>
              Plantilla Excel del colegio
            </DownloadLink>
            <button
              className="button secondary"
              onClick={() =>
                downloadText(
                  "padron-colegio.csv",
                  "\uFEFFITEM,GRADO,SECCIÓN,NÚMERO DE DOCUMENTO,CÓDIGO DEL ESTUDIANTE,ESTUDIANTE,SEXO,FECHA DE NACIMIENTO,EDAD (AL 31 DE MARZO),ESTADO DE MATRICULA,TIPO DE VACANTE,TURNO\n1,PRIMERO,HONESTIDAD,00000101,MATRICULA-101,Estudiante Ejemplo,,,,DEFINITIVA,,\n",
                  "text/csv;charset=utf-8",
                )
              }
            >
              Plantilla CSV
            </button>
          </div>
          <Field label="Archivo institucional">
            <input
              type="file"
              accept=".xlsx,.csv"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                setSource(undefined);
                setPreview(undefined);
                setPreviewPage(0);
                if (!f) return;
                void run(async () => {
                  const excel = /\.xlsx$/i.test(f.name);
                  if (
                    (!excel && !/\.csv$/i.test(f.name)) ||
                    f.size > (excel ? 5 * 1024 * 1024 : 900000)
                  )
                    throw new Error(
                      "Selecciona un Excel .xlsx o CSV dentro del límite.",
                    );
                  const input = {
                    requestId: crypto.randomUUID(),
                    ...(excel
                      ? { file: { name: f.name, base64: await readBase64(f) } }
                      : { csv: await f.text() }),
                  };
                  setSource(input);
                  setPreview(
                    await api(root + "/preview", {
                      method: "POST",
                      body: input,
                    }),
                  );
                });
              }}
            />
          </Field>
          {preview && (
            <div role="region" aria-label="Vista previa del padrón">
              <h3>{preview.total} estudiantes encontrados</h3>
              <p>
                Al importar se registrarán automáticamente.{" "}
                {preview.unavailable} registros tienen un DNI faltante, inválido
                o repetido que impide habilitarlos para votar.
              </p>
              {preview.warnings.map((w: string) => (
                <p key={w}>{w}</p>
              ))}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Fila</th>
                      <th>Estudiante</th>
                      <th>Grado y sección</th>
                      <th>Turno</th>
                      <th>Datos del documento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows
                      .slice(previewPage * 50, (previewPage + 1) * 50)
                      .map((r: any) => (
                        <tr key={r.sourceRow}>
                          <td>{r.sourceRow}</td>
                          <td>{r.displayName}</td>
                          <td>
                            {r.grade}° {r.section}
                          </td>
                          <td>
                            {r.shift ? shiftLabel(r.shift) : "Sin clasificar"}
                          </td>
                          <td>{r.issues.join(" ") || "DNI válido"}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <nav
                className="roster-actions"
                aria-label="Paginación de la vista previa"
              >
                <button
                  className="button secondary"
                  disabled={busy || previewPage === 0}
                  onClick={() => setPreviewPage(previewPage - 1)}
                >
                  Anterior
                </button>
                <span role="status">
                  Mostrando {previewPage * 50 + 1}–
                  {Math.min((previewPage + 1) * 50, preview.total)} de{" "}
                  {preview.total} estudiantes · Página {previewPage + 1} de{" "}
                  {Math.ceil(preview.total / 50)}
                </span>
                <button
                  className="button secondary"
                  disabled={busy || (previewPage + 1) * 50 >= preview.total}
                  onClick={() => setPreviewPage(previewPage + 1)}
                >
                  Siguiente
                </button>
              </nav>
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const r = await api(root + "/import", {
                      method: "POST",
                      body: source,
                    });
                    await load();
                    setPage(0);
                    setPreview(undefined);
                    setMessage(
                      r.alreadyImported
                        ? "La carga ya estaba registrada; no se duplicó."
                        : `${r.count} estudiantes registrados automáticamente.`,
                    );
                  })
                }
              >
                {busy ? "Importando…" : "Importar padrón"}
              </button>
            </div>
          )}
        </section>
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Estudiantes registrados</h2>
            <p>
              Los documentos completos se muestran solo al abrir una corrección
              autorizada.
            </p>
          </div>
        </div>
        <Field label="Buscar por nombre, matrícula o sección">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </Field>
        <Field label="Filtrar por tipo de acceso">
          <select
            value={accessFilter}
            onChange={(e) => {
              setAccessFilter(e.target.value);
              setPage(0);
            }}
          >
            <option value="">Todos los tipos de acceso</option>
            <option value="DNI">DNI</option>
            <option value="FOREIGN">Extranjero con matrícula</option>
          </select>
        </Field>
        <Field label="Filtrar estudiantes por turno">
          <select
            value={shiftFilter}
            onChange={(e) => {
              setShiftFilter(e.target.value);
              setPage(0);
            }}
          >
            <option value="">Todos los turnos</option>
            <option value="MANANA">Mañana</option>
            <option value="TARDE">Tarde</option>
            <option value="UNKNOWN">Sin clasificar</option>
          </select>
        </Field>
        <label className="roster-check">
          <input
            type="checkbox"
            checked={pendingOnly}
            onChange={(e) => {
              setPendingOnly(e.target.checked);
              setPage(0);
            }}
          />
          Mostrar solo registros con observaciones o pendientes de habilitar
        </label>
        <button
          className="button text"
          onClick={() =>
            downloadText(
              "revision-padron.csv",
              "fila,matricula,estudiante,observaciones\n" +
                (data?.rows || [])
                  .filter((r: any) => r.issues.length)
                  .map((r: any) =>
                    [
                      r.sourceRow,
                      r.studentCode,
                      r.displayName,
                      r.issues.join(" "),
                    ]
                      .map(csvCell)
                      .join(","),
                  )
                  .join("\n"),
              "text/csv;charset=utf-8",
            )
          }
        >
          Descargar observaciones
        </button>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Estudiante</th>
                <th>Grado / sección</th>
                <th>Turno</th>
                <th>Tipo de acceso</th>
                <th>Estado</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    No hay estudiantes que coincidan con los filtros.
                  </td>
                </tr>
              )}
              {rows.slice(page * 50, (page + 1) * 50).map((r: any) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.displayName}</strong>
                    <small>
                      {r.isForeign ? "Extranjero · matrícula " : "Matrícula "}
                      {r.studentCode} · {r.document}
                    </small>
                  </td>
                  <td>
                    {r.grade}° {r.section}
                  </td>
                  <td>{r.shift ? shiftLabel(r.shift) : "Sin clasificar"}</td>
                  <td>{r.isForeign ? "Extranjero con matrícula" : "DNI"}</td>
                  <td>
                    {r.excluded
                      ? "Excluido con motivo"
                      : r.publishedAt
                        ? "Registrado · habilitado para votar"
                        : "Registrado · " +
                          (r.issues.join(" ") || "DNI no habilitado")}
                  </td>
                  <td>
                    {editable && !r.publishedAt && (
                      <button
                        className="button text"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            setForm(await api(root + "/rows/" + r.id));
                            setReason("");
                          })
                        }
                      >
                        Corregir datos
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="roster-actions">
          <button
            className="button secondary"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            Anterior
          </button>
          <span>
            {rows.length} coincidencias · Página {page + 1} de{" "}
            {Math.max(1, Math.ceil(rows.length / 50))}
          </span>
          <button
            className="button secondary"
            disabled={(page + 1) * 50 >= rows.length}
            onClick={() => setPage(page + 1)}
          >
            Siguiente
          </button>
        </div>
      </section>
      <section className="panel">
        <h2>Historial de cargas escolares</h2>
        {data?.history.map((h: any) => (
          <p key={h.id}>
            {dateFormat(h.createdAt)} · {h.source} · {h.total} estudiantes
          </p>
        ))}
      </section>
      {form && (
        <Modal
          title={form.id ? "Corregir datos" : "Registrar estudiante"}
          formId="school-student-form"
          confirmLabel="Guardar registro"
          busy={busy}
          wide
          onClose={() => !busy && setForm(undefined)}
        >
          <form
            id="school-student-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const row = Object.fromEntries(
                  [...inputFields, "shift", "isForeign"].map((k) => [
                    k,
                    form[k],
                  ]),
                );
                if (form.isForeign && !row.studentCode)
                  throw new Error(
                    "Ingresa el código de matrícula existente del estudiante extranjero.",
                  );
                if (!row.studentCode)
                  row.studentCode = "MANUAL-" + form.requestId;
                if (form.id)
                  await api(root + "/rows/" + form.id, {
                    method: "PATCH",
                    body: {
                      ...row,
                      version: form.version,
                      enrollmentApproved: form.enrollmentApproved,
                      excluded: form.excluded,
                      reason,
                    },
                  });
                else
                  await api(root + "/import", {
                    method: "POST",
                    body: { requestId: form.requestId, individual: row },
                  });
                setForm(undefined);
                await load();
                setMessage(
                  "Registro guardado. El DNI válido se habilita automáticamente.",
                );
              });
            }}
          >
            <div className="roster-field-grid">
              {inputFields.map((k) => (
                <Field key={k} label={labels[k]}>
                  <input
                    value={form[k]}
                    maxLength={
                      k === "displayName" ? 150 : k === "section" ? 100 : 60
                    }
                    onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                    required={[
                      "displayName",
                      "grade",
                      "section",
                      "enrollment",
                    ].includes(k)}
                  />
                </Field>
              ))}
            </div>
            {!form.id && (
              <label className="roster-check">
                <input
                  type="checkbox"
                  checked={form.isForeign}
                  onChange={(e) =>
                    setForm({ ...form, isForeign: e.target.checked })
                  }
                />
                Estudiante extranjero: ingresar con su código de matrícula en
                lugar de DNI.
              </label>
            )}
            {form.id && (
              <>
                <label className="roster-check">
                  <input
                    type="checkbox"
                    checked={form.excluded}
                    onChange={(e) =>
                      setForm({ ...form, excluded: e.target.checked })
                    }
                  />
                  Excluir del padrón electoral con motivo documentado.
                </label>
                <Field label="Motivo de la corrección">
                  <textarea
                    minLength={10}
                    maxLength={300}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    required
                  />
                </Field>
              </>
            )}

            {error && <Notice>{error}</Notice>}
          </form>
        </Modal>
      )}
    </>
  );
}
