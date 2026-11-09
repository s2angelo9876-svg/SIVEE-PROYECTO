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
  const [data, setData] = useState<any>(),
    [source, setSource] = useState<any>(),
    [preview, setPreview] = useState<any>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [query, setQuery] = useState(""),
    [pendingOnly, setPendingOnly] = useState(false),
    [page, setPage] = useState(0);
  const [previewPage, setPreviewPage] = useState(0);
  const [form, setForm] = useState<any>(),
    [reason, setReason] = useState(""),
    [publish, setPublish] = useState(false),
    [updateProfiles, setUpdateProfiles] = useState(false);
  const [groups, setGroups] = useState<string[]>([]),
    [shift, setShift] = useState("MANANA"),
    [shiftReason, setShiftReason] = useState("");
  const load = async () => setData(await api(root));
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
      (!pendingOnly || r.issues.length) &&
      `${r.displayName} ${r.studentCode} ${r.section}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  const groupNames = [
    ...new Set<string>(
      (data?.rows || [])
        .filter((r: any) => !r.publishedAt && !r.excluded)
        .map((r: any) => JSON.stringify([r.grade, r.section])),
    ),
  ];
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
        description="Revisa documentos, matrículas y turnos antes de habilitar la elección. El estudiante votará directamente con su DNI."
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
            <strong>{data.pending}</strong> pendientes de revisión
          </span>
          <span>
            <strong>{data.ready}</strong> listos para confirmar
          </span>
          <span>
            <strong>{data.published}</strong> confirmados
          </span>
          <span>
            <strong>{data.excluded}</strong> excluidos con motivo
          </span>
        </div>
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
                {preview.pending} necesitan revisión. Guardar esta carga crea un
                borrador; todavía no habilita votos.
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
                      <th>Revisión</th>
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
                          <td>{r.issues.join(" ") || "Listo"}</td>
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
                        : `${r.count} estudiantes guardados para revisión.`,
                    );
                  })
                }
              >
                {busy ? "Guardando…" : "Guardar en borrador"}
              </button>
            </div>
          )}
        </section>
      )}
      {editable && groupNames.length > 0 && (
        <section className="panel">
          <h2>Asignar turnos por grado y sección</h2>
          <p>
            Selecciona únicamente los grupos cuya distribución haya confirmado
            el colegio.
          </p>
          <Field label="Grupos a asignar">
            <select
              multiple
              size={Math.min(8, groupNames.length)}
              value={groups}
              disabled={busy}
              onChange={(e) =>
                setGroups([...e.target.selectedOptions].map((o) => o.value))
              }
            >
              {groupNames.map((g) => {
                const [grade, section] = JSON.parse(g);
                return (
                  <option key={g} value={g}>
                    {grade}° · {section}
                  </option>
                );
              })}
            </select>
          </Field>
          <Field label="Turno para los grupos seleccionados">
            <select value={shift} onChange={(e) => setShift(e.target.value)}>
              {election.windows.map((w: any) => (
                <option key={w.shift} value={w.shift}>
                  {shiftLabel(w.shift)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Motivo y referencia de asignación">
            <input
              value={shiftReason}
              maxLength={300}
              onChange={(e) => setShiftReason(e.target.value)}
            />
          </Field>
          <button
            className="button secondary"
            disabled={busy || !groups.length || shiftReason.trim().length < 10}
            onClick={() =>
              void run(async () => {
                const r = await api(root + "/assign-shift", {
                  method: "POST",
                  body: {
                    groups: groups.map((g) => {
                      const [grade, section] = JSON.parse(g);
                      return { grade, section };
                    }),
                    shift,
                    reason: shiftReason,
                  },
                });
                setGroups([]);
                await load();
                setMessage(`Turno asignado a ${r.count} registros.`);
              })
            }
          >
            Asignar turno confirmado
          </button>
        </section>
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Revisar estudiantes</h2>
            <p>
              Los documentos completos se muestran solo al abrir una corrección
              autorizada.
            </p>
          </div>
          {editable && data?.rows.some((r: any) => !r.publishedAt) && (
            <button
              className="button"
              disabled={busy || data.pending > 0}
              onClick={() => {
                setPublish(true);
                setReason("");
                setUpdateProfiles(false);
              }}
            >
              Confirmar padrón revisado
            </button>
          )}
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
        <label className="roster-check">
          <input
            type="checkbox"
            checked={pendingOnly}
            onChange={(e) => {
              setPendingOnly(e.target.checked);
              setPage(0);
            }}
          />
          Mostrar pendientes de revisión
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
                <th>Estado</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(page * 50, (page + 1) * 50).map((r: any) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.displayName}</strong>
                    <small>
                      {r.studentCode} · {r.document}
                    </small>
                  </td>
                  <td>
                    {r.grade}° {r.section}
                  </td>
                  <td>{r.shift ? shiftLabel(r.shift) : "Pendiente"}</td>
                  <td>
                    {r.excluded
                      ? "Excluido con motivo"
                      : r.publishedAt
                        ? "Confirmado"
                        : r.issues.join(" ") || "Listo para confirmar"}
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
                        Revisar
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
            {rows.length} coincidencias · Página {page + 1}
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
          title={form.id ? "Revisar registro" : "Registrar estudiante"}
          onClose={() => !busy && setForm(undefined)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const row = Object.fromEntries(
                  [...inputFields, "shift"].map((k) => [k, form[k]]),
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
                  "Registro guardado. Revisa los pendientes antes de confirmar el padrón.",
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
              <Field label="Turno del estudiante">
                <select
                  value={form.shift || ""}
                  onChange={(e) =>
                    setForm({ ...form, shift: e.target.value || null })
                  }
                >
                  <option value="">Pendiente de confirmar</option>
                  {election.windows.map((w: any) => (
                    <option value={w.shift} key={w.shift}>
                      {shiftLabel(w.shift)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {form.id && (
              <>
                <label className="roster-check">
                  <input
                    type="checkbox"
                    checked={form.enrollmentApproved}
                    onChange={(e) =>
                      setForm({ ...form, enrollmentApproved: e.target.checked })
                    }
                  />
                  El comité autorizó esta matrícula para participar.
                </label>
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
            <button className="button" disabled={busy}>
              {busy ? "Guardando…" : "Guardar registro"}
            </button>
            {error && <Notice>{error}</Notice>}
          </form>
        </Modal>
      )}
      {publish && (
        <Modal
          title="Confirmar padrón revisado"
          onClose={() => !busy && setPublish(false)}
        >
          <p>
            Se incorporarán {data.ready} estudiantes habilitados. Los registros
            excluidos conservarán su motivo. Después de confirmar, sus datos de
            inscripción quedarán fijados para esta elección.
          </p>
          <label className="roster-check">
            <input
              type="checkbox"
              checked={updateProfiles}
              onChange={(e) => setUpdateProfiles(e.target.checked)}
            />
            Autorizo actualizar los datos institucionales que cambiaron,
            conservando las elecciones anteriores.
          </label>
          <Field label="Referencia de revisión del padrón">
            <textarea
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <button
            className="button"
            disabled={busy || reason.trim().length < 10}
            onClick={() =>
              void run(async () => {
                const r = await api(root + "/publish", {
                  method: "POST",
                  body: { reason, updateProfiles },
                });
                setPublish(false);
                await load();
                setMessage(
                  `${r.count} estudiantes habilitados para la elección.`,
                );
              })
            }
          >
            Confirmar incorporación
          </button>
          {error && <Notice>{error}</Notice>}
        </Modal>
      )}
    </>
  );
}
