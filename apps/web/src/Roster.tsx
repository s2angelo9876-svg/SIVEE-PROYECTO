import { useEffect, useState } from "react";
import { Download, Upload, Plus, LockKeyhole, RefreshCw } from "lucide-react";
import { useAdmin } from "./Admin";
import { SchoolRoster } from "./SchoolRoster";
import {
  api,
  Badge,
  Field,
  Notice,
  PageTitle,
  Empty,
  Modal,
  DownloadLink,
  dateFormat,
  shiftLabel,
  downloadText,
  csvCell,
} from "./lib";

const fields = [
  "dni",
  "apellidos_nombres",
  "grado",
  "seccion",
  "turno",
  "habilitado",
] as const;
const labels: Record<string, string> = {
  dni: "DNI",
  apellidos_nombres: "Nombres y apellidos",
  grado: "Grado",
  seccion: "Sección",
  turno: "Turno",
  habilitado: "Habilitado",
};
const csvTemplate =
  "dni,apellidos_nombres,grado,seccion,turno,habilitado\n00000101,Estudiante Ejemplo,3,A,MANANA,true\n";
type Source = { csv: string } | { file: { name: string; base64: string } };
function base64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("No se pudo abrir el archivo."));
    reader.readAsDataURL(file);
  });
}
export function Roster() {
  const context = useAdmin();
  if (!context.election) return <Empty>Crea una elección.</Empty>;
  if (context.election.authMode === "DESK") return <SchoolRoster />;
  return <RosterScreen key={context.id} {...context} />;
}
function RosterScreen({ id, election, can }: any) {
  const path = `/admin/elections/${id}/roster`;
  const edit = can("roster:write") && election.state === "BORRADOR";
  const [summary, setSummary] = useState<any>();
  const [history, setHistory] = useState<any[]>([]);
  const [mode, setMode] = useState<"file" | "individual">("file");
  const [source, setSource] = useState<Source>();
  const [info, setInfo] = useState<any>();
  const [sheet, setSheet] = useState("");
  const [headerRow, setHeaderRow] = useState(1);
  const [inspectedHeader, setInspectedHeader] = useState(1);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [skipExisting, setSkipExisting] = useState(false);
  const [updateProfiles, setUpdateProfiles] = useState(false);
  const [profileReason, setProfileReason] = useState("");
  const [individual, setIndividual] = useState({
    dni: "",
    apellidos_nombres: "",
    grado: "1",
    seccion: "A",
    turno: election.windows[0]?.shift || "MANANA",
    habilitado: "true",
  });
  const [preview, setPreview] = useState<any>();
  const [pending, setPending] = useState<any>();
  const [issued, setIssued] = useState<any>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [dni, setDni] = useState("");
  const [student, setStudent] = useState<any>();
  const [searched, setSearched] = useState(false);
  const [reissue, setReissue] = useState<{
    studentId?: string;
    batchId?: string;
    label: string;
  }>();
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  async function load() {
    const [s, h] = await Promise.all([
      api(path + "/summary"),
      can("roster:write") ? api(path + "/imports") : Promise.resolve([]),
    ]);
    setSummary(s);
    setHistory(h);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  function changed() {
    setPreview(undefined);
    setPending(undefined);
    setMessage("");
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function inspect(s: Source, selected?: string, header = 1) {
    changed();
    setInfo(undefined);
    setMapping({});
    const result = await api(path + "/file-inspect", {
      method: "POST",
      body: {
        ...s,
        ...(selected ? { sheet: selected } : {}),
        headerRow: header,
      },
    });
    setInfo(result);
    setSheet(result.sheet);
    setHeaderRow(header);
    setInspectedHeader(header);
    setMapping(result.mapping);
  }
  function payload() {
    return {
      ...(mode === "individual"
        ? { individual }
        : { ...source, sheet, headerRow, mapping }),
      skipExisting,
      updateProfiles,
      reason: profileReason,
      requestId: crypto.randomUUID(),
    };
  }
  async function validate() {
    const input = payload();
    const result = await api(path + "/import-preview", {
      method: "POST",
      body: input,
    });
    setPending(input);
    setPreview(result);
    setMessage("");
  }
  function downloadCodes() {
    downloadText(
      "codigos-padron.csv",
      "nombre,grado,seccion,turno,codigo,vence\n" +
        issued.credentials
          .map((r: any) =>
            [
              r.displayName,
              r.grade,
              r.section,
              r.shift,
              r.accessCode,
              r.expiresAt,
            ]
              .map(csvCell)
              .join(","),
          )
          .join("\n"),
      "text/csv;charset=utf-8",
    );
  }
  const canReissue =
    can("roster:write") &&
    ["BORRADOR", "PREPARADA", "EN_CURSO", "PAUSADA"].includes(election.state);
  return (
    <>
      <PageTitle
        title="Cada estudiante, una voz"
        description="Carga Excel o CSV, registra estudiantes y administra sus códigos de acceso."
        action={
          <div className="roster-actions">
            {edit && (
              <DownloadLink href={path + "/template.xlsx"}>
                Plantilla Excel
              </DownloadLink>
            )}
            <button
              className="button secondary"
              onClick={() =>
                downloadText(
                  "plantilla-padron.csv",
                  csvTemplate,
                  "text/csv;charset=utf-8",
                )
              }
            >
              <Download size={16} /> Plantilla CSV
            </button>
          </div>
        }
      />
      {error && <Notice>{error}</Notice>}
      {message && <Notice success>{message}</Notice>}
      {summary && (
        <div className="compact-stats">
          <span>
            <strong>{summary.eligible}</strong> habilitados
          </span>
          <span>
            <strong>{summary.voted}</strong> participaron
          </span>
          <span>
            <strong>{summary.remaining}</strong> pendientes
          </span>
        </div>
      )}
      <div className="two-columns roster-columns">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Incorporar estudiantes</h2>
              <p>Disponible mientras la elección está en borrador.</p>
            </div>
            <UsersIcon />
          </div>
          {!edit ? (
            <div className="locked-note">
              <LockKeyhole />
              <p>
                El padrón está protegido. Las incorporaciones se permiten
                únicamente en BORRADOR y con permiso de operador.
              </p>
            </div>
          ) : (
            <>
              <div className="roster-actions">
                <button
                  disabled={busy}
                  className={"button " + (mode === "file" ? "" : "secondary")}
                  aria-pressed={mode === "file"}
                  onClick={() => {
                    setMode("file");
                    changed();
                  }}
                >
                  <Upload size={16} /> Excel o CSV
                </button>
                <button
                  disabled={busy}
                  className={
                    "button " + (mode === "individual" ? "" : "secondary")
                  }
                  aria-pressed={mode === "individual"}
                  onClick={() => {
                    setMode("individual");
                    changed();
                  }}
                >
                  <Plus size={16} /> Registrar estudiante
                </button>
              </div>
              {mode === "file" ? (
                <>
                  <label className="upload-zone">
                    <Upload size={28} />
                    <strong>Selecciona Excel (.xlsx) o CSV</strong>
                    <span>
                      Hasta 5000 estudiantes · Excel 5 MB · CSV 900 KB
                    </span>
                    <input
                      type="file"
                      aria-label="Archivo del padrón"
                      accept=".xlsx,.csv"
                      disabled={busy}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        setSource(undefined);
                        setInfo(undefined);
                        changed();
                        setIssued(undefined);
                        void run(async () => {
                          const xlsx = /\.xlsx$/i.test(file.name),
                            csv = /\.csv$/i.test(file.name);
                          if (!xlsx && !csv)
                            throw new Error(
                              "Usa .xlsx o .csv. Guarda los Excel antiguos .xls como .xlsx.",
                            );
                          if (file.size > (xlsx ? 5 * 1024 * 1024 : 900000))
                            throw new Error(
                              "El archivo supera el tamaño permitido.",
                            );
                          const s: Source = xlsx
                            ? {
                                file: {
                                  name: file.name,
                                  base64: await base64(file),
                                },
                              }
                            : { csv: await file.text() };
                          setSource(s);
                          await inspect(s);
                        });
                      }}
                    />
                  </label>
                  {source && (
                    <div className="roster-selectors">
                      {info?.sheets.length > 0 && (
                        <Field label="Hoja del Excel">
                          <select
                            value={sheet}
                            disabled={busy}
                            onChange={(e) => {
                              setSheet(e.target.value);
                              changed();
                            }}
                          >
                            {info.sheets.map((s: any) => (
                              <option key={s.name} value={s.name}>
                                {s.name}
                                {s.hidden ? " (oculta)" : ""}
                              </option>
                            ))}
                          </select>
                        </Field>
                      )}
                      <Field label="Fila de encabezados">
                        <input
                          type="number"
                          min={1}
                          max={50}
                          value={headerRow}
                          disabled={busy}
                          onChange={(e) => {
                            setHeaderRow(Number(e.target.value));
                            changed();
                          }}
                        />
                      </Field>
                      <button
                        className="button secondary"
                        disabled={busy || headerRow < 1 || headerRow > 50}
                        onClick={() =>
                          void run(() =>
                            inspect(source, sheet || undefined, headerRow),
                          )
                        }
                      >
                        Leer encabezados
                      </button>
                    </div>
                  )}
                  {info &&
                    sheet === info.sheet &&
                    headerRow === inspectedHeader && (
                      <>
                        {info.warnings.map((w: string) => (
                          <Notice key={w}>{w}</Notice>
                        ))}
                        <p className="roster-help">
                          Asocia cada campo con una columna. El DNI debe
                          conservar sus ocho dígitos.
                        </p>
                        <div className="roster-field-grid">
                          {fields.map((field) => (
                            <Field
                              key={field}
                              label={labels[field] + " · columna"}
                            >
                              <select
                                disabled={busy}
                                value={mapping[field] ?? ""}
                                onChange={(e) => {
                                  setMapping({
                                    ...mapping,
                                    [field]: Number(e.target.value),
                                  });
                                  changed();
                                }}
                              >
                                <option value="" disabled>
                                  Selecciona una columna
                                </option>
                                {info.headers.map((h: string, i: number) => (
                                  <option key={i} value={i}>
                                    {i + 1}. {h || "Sin encabezado"}
                                  </option>
                                ))}
                              </select>
                            </Field>
                          ))}
                        </div>
                        <details className="roster-sample">
                          <summary>Ver primeras filas del archivo</summary>
                          <div className="table-wrap">
                            <table>
                              <thead>
                                <tr>
                                  <th>Fila</th>
                                  {info.headers.map((h: string, i: number) => (
                                    <th key={i}>{h || `Columna ${i + 1}`}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {info.sample.map((r: any) => (
                                  <tr key={r.row}>
                                    <td>{r.row}</td>
                                    {info.headers.map(
                                      (_h: string, i: number) => (
                                        <td key={i}>{r.values[i]}</td>
                                      ),
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </details>
                      </>
                    )}
                </>
              ) : (
                <div className="roster-field-grid">
                  <Field
                    label="DNI del estudiante"
                    hint="Ocho dígitos, incluidos los ceros iniciales."
                  >
                    <input
                      value={individual.dni}
                      inputMode="numeric"
                      maxLength={8}
                      autoComplete="off"
                      disabled={busy}
                      onChange={(e) => {
                        setIndividual({ ...individual, dni: e.target.value });
                        changed();
                      }}
                    />
                  </Field>
                  <Field label="Nombres y apellidos del estudiante">
                    <input
                      value={individual.apellidos_nombres}
                      maxLength={150}
                      autoComplete="off"
                      disabled={busy}
                      onChange={(e) => {
                        setIndividual({
                          ...individual,
                          apellidos_nombres: e.target.value,
                        });
                        changed();
                      }}
                    />
                  </Field>
                  <Field label="Grado del estudiante">
                    <select
                      value={individual.grado}
                      disabled={busy}
                      onChange={(e) => {
                        setIndividual({ ...individual, grado: e.target.value });
                        changed();
                      }}
                    >
                      {[1, 2, 3, 4, 5, 6].map((g) => (
                        <option key={g}>{g}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Sección del estudiante">
                    <input
                      value={individual.seccion}
                      maxLength={2}
                      disabled={busy}
                      onChange={(e) => {
                        setIndividual({
                          ...individual,
                          seccion: e.target.value.toUpperCase(),
                        });
                        changed();
                      }}
                    />
                  </Field>
                  <Field label="Turno del estudiante">
                    <select
                      value={individual.turno}
                      disabled={busy}
                      onChange={(e) => {
                        setIndividual({ ...individual, turno: e.target.value });
                        changed();
                      }}
                    >
                      {election.windows.map((w: any) => (
                        <option key={w.shift} value={w.shift}>
                          {shiftLabel(w.shift)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Habilitación del estudiante">
                    <select
                      value={individual.habilitado}
                      disabled={busy}
                      onChange={(e) => {
                        setIndividual({
                          ...individual,
                          habilitado: e.target.value,
                        });
                        changed();
                      }}
                    >
                      <option value="true">Habilitado para votar</option>
                      <option value="false">No habilitado</option>
                    </select>
                  </Field>
                </div>
              )}
              <div className="roster-options">
                {mode === "file" && (
                  <label className="roster-check">
                    <input
                      type="checkbox"
                      checked={skipExisting}
                      disabled={busy}
                      onChange={(e) => {
                        setSkipExisting(e.target.checked);
                        changed();
                      }}
                    />{" "}
                    Omitir estudiantes ya inscritos con los mismos datos.
                  </label>
                )}
                <label className="roster-check">
                  <input
                    type="checkbox"
                    checked={updateProfiles}
                    disabled={busy}
                    onChange={(e) => {
                      setUpdateProfiles(e.target.checked);
                      changed();
                    }}
                  />{" "}
                  Confirmo los cambios de datos institucionales para esta nueva
                  inscripción; se conserva el historial de otras elecciones.
                </label>
                {updateProfiles && (
                  <Field label="Motivo de actualización de datos">
                    <textarea
                      minLength={10}
                      maxLength={300}
                      value={profileReason}
                      disabled={busy}
                      onChange={(e) => {
                        setProfileReason(e.target.value);
                        changed();
                      }}
                    />
                  </Field>
                )}
              </div>
              <button
                className="button full"
                disabled={
                  busy ||
                  (mode === "file" &&
                    (!info ||
                      sheet !== info.sheet ||
                      headerRow !== inspectedHeader ||
                      fields.some((f) => mapping[f] === undefined)))
                }
                onClick={() => void run(validate)}
              >
                {busy
                  ? "Procesando…"
                  : mode === "individual"
                    ? "Validar estudiante"
                    : "Validar padrón"}
              </button>
            </>
          )}
        </section>
        <section className="panel">
          <h2>Consultar un elector</h2>
          <p>Verifica su habilitación y la vigencia del código.</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                setStudent(
                  await api(path + "/search", {
                    method: "POST",
                    body: { dni },
                  }),
                );
                setSearched(true);
                setDni("");
              });
            }}
          >
            <Field label="Documento a consultar">
              <input
                inputMode="numeric"
                pattern="[0-9]{8}"
                maxLength={8}
                value={dni}
                onChange={(e) => setDni(e.target.value)}
                required
                autoComplete="off"
              />
            </Field>
            <button className="button secondary" disabled={busy}>
              Consultar
            </button>
          </form>
          {searched &&
            (student ? (
              <div className="student-result">
                <strong>{student.displayName}</strong>
                <p>
                  {student.grade}° {student.section} ·{" "}
                  {shiftLabel(student.shift)}
                </p>
                <Badge
                  state={
                    student.state === "VOTO_EMITIDO"
                      ? "Participación registrada"
                      : student.state === "PENDIENTE"
                        ? "Habilitado"
                        : "No habilitado"
                  }
                />
                {student.credential && (
                  <p>
                    Código {student.credential.active ? "activo" : "inactivo"} ·
                    vence {dateFormat(student.credential.expiresAt)}
                    {new Date(student.credential.expiresAt) < new Date()
                      ? " · Vencido"
                      : ""}
                  </p>
                )}
                {student.credential?.lockedUntil &&
                  new Date(student.credential.lockedUntil) > new Date() && (
                    <Notice>
                      Acceso bloqueado temporalmente hasta{" "}
                      {dateFormat(student.credential.lockedUntil)}.
                    </Notice>
                  )}
                <div className="roster-actions">
                  {edit && (
                    <button
                      className="button text"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api(path + `/${student.id}`, {
                            method: "PATCH",
                            body: {
                              enabled: student.state === "ANULADA_POR_COMITE",
                            },
                          });
                          setSearched(false);
                          await load();
                        })
                      }
                    >
                      {student.state === "ANULADA_POR_COMITE"
                        ? "Habilitar"
                        : "Deshabilitar"}
                    </button>
                  )}
                  {canReissue &&
                    student.state === "PENDIENTE" &&
                    election.windows.some(
                      (w: any) =>
                        w.shift === student.shift && w.state !== "CERRADA",
                    ) && (
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => {
                          setReissue({
                            studentId: student.id,
                            label: student.displayName,
                          });
                          setReason("");
                          setConfirmed(false);
                        }}
                      >
                        <RefreshCw size={16} /> Reemitir código
                      </button>
                    )}
                </div>
              </div>
            ) : (
              <p>No hay coincidencias en esta elección.</p>
            ))}
        </section>
      </div>
      {preview && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Vista previa de importación</h2>
              <p>
                {preview.sheet} · {preview.total} filas · {preview.newCount}{" "}
                nuevas · {preview.skipped} ya inscritas · {preview.invalid}{" "}
                filas con errores
              </p>
            </div>
            {edit && !preview.errors.length && preview.newCount > 0 && (
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await api(path + "/import-commit", {
                      method: "POST",
                      body: pending,
                    });
                    setIssued(result.credentials.length ? result : undefined);
                    setMessage(
                      result.alreadyImported
                        ? "Esta carga ya quedó registrada. Si no guardaste los códigos, utiliza la reemisión desde el historial."
                        : `${result.count} estudiantes registrados correctamente.`,
                    );
                    setPreview(undefined);
                    setPending(undefined);
                    await load();
                  })
                }
              >
                {busy ? "Guardando…" : "Confirmar importación"}
              </button>
            )}
          </div>
          <p>
            Vigencia prevista de los códigos: {dateFormat(preview.expiresAt)}.
          </p>
          {preview.updates.length > 0 && (
            <Notice>
              Revisa los cambios de datos institucionales:{" "}
              {preview.updates
                .map((u: any) => `fila ${u.row}: ${u.changes.join(", ")}`)
                .join("; ")}
              .
            </Notice>
          )}
          {preview.errors.length > 0 && (
            <>
              <Notice>
                Corrige las filas indicadas y vuelve a validar. No se guardará
                una carga con errores.
              </Notice>
              <button
                className="button secondary"
                onClick={() =>
                  downloadText(
                    "errores-padron.csv",
                    "hoja,fila,campo,error\n" +
                      preview.errors
                        .map((r: any) =>
                          [preview.sheet, r.row, r.field || "", r.message]
                            .map(csvCell)
                            .join(","),
                        )
                        .join("\n"),
                    "text/csv;charset=utf-8",
                  )
                }
              >
                Descargar errores
              </button>
              <ul className="roster-errors">
                {preview.errors.slice(0, 100).map((r: any, i: number) => (
                  <li key={i}>
                    Fila {r.row} · {labels[r.field] || r.field}: {r.message}
                  </li>
                ))}
              </ul>
              {preview.errors.length > 100 && (
                <p>
                  Se muestran los primeros 100 errores; descarga el informe
                  completo.
                </p>
              )}
            </>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fila</th>
                  <th>Nombre</th>
                  <th>Grado / sección</th>
                  <th>Turno</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {preview.preview.map((r: any) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>{r.name}</td>
                    <td>
                      {r.grade}° {r.section}
                    </td>
                    <td>{shiftLabel(r.shift)}</td>
                    <td>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.total > 100 && (
            <p>
              Vista previa limitada a las primeras 100 filas válidas por
              formato. Los totales y la validación incluyen todo el archivo.
            </p>
          )}
        </section>
      )}
      {issued && (
        <section className="panel">
          <h2>Códigos listos para entregar</h2>
          <Notice success>
            {issued.count} códigos generados. Descárgalos antes de salir y
            entrégalos individualmente a sus titulares.
          </Notice>
          <p>
            Si pierdes esta descarga podrás emitir códigos nuevos. Los códigos
            anteriores quedarán invalidados.
          </p>
          <div className="roster-actions">
            <button className="button" onClick={downloadCodes}>
              <Download size={16} /> Descargar códigos individuales
            </button>
            <button
              className="button text"
              onClick={() => setIssued(undefined)}
            >
              Ocultar esta entrega
            </button>
          </div>
        </section>
      )}
      {can("roster:write") && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Últimas cargas del padrón</h2>
              <p>
                Comprueba aquí si una carga terminó cuando se interrumpió la
                conexión. Se muestran los últimos 50 lotes.
              </p>
            </div>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void run(load)}
            >
              Actualizar historial
            </button>
          </div>
          {!history.length ? (
            <Empty>
              Todavía no hay cargas registradas con el nuevo importador.
            </Empty>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Origen</th>
                    <th>Fecha</th>
                    <th>Estudiantes</th>
                    <th>Códigos</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((batch) => (
                    <tr key={batch.batchId}>
                      <td>
                        {batch.source}
                        <small className="roster-batch-id">
                          Lote {batch.batchId.slice(0, 8)}
                        </small>
                      </td>
                      <td>{dateFormat(batch.createdAt)}</td>
                      <td>{batch.count}</td>
                      <td>
                        {edit ? (
                          <button
                            className="button text"
                            disabled={busy}
                            onClick={() => {
                              setReissue({
                                batchId: batch.batchId,
                                label: `Lote de ${batch.count} estudiantes`,
                              });
                              setReason("");
                              setConfirmed(false);
                            }}
                          >
                            Reemitir códigos del lote
                          </button>
                        ) : (
                          "Consulta individual"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {reissue && (
        <Modal
          title="Reemitir códigos de acceso"
          onClose={() => {
            if (!busy) setReissue(undefined);
          }}
        >
          <p>
            <strong>{reissue.label}</strong>
          </p>
          <p>
            Se generarán códigos nuevos y se cerrarán las sesiones de los
            estudiantes afectados. La participación registrada se conserva.
          </p>
          <Field label="Motivo de reemisión">
            <textarea
              value={reason}
              minLength={10}
              maxLength={300}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <label className="roster-check">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{" "}
            He verificado a los titulares y entiendo que los códigos anteriores
            dejarán de funcionar.
          </label>
          <button
            className="button full"
            disabled={busy || !confirmed || reason.trim().length < 10}
            onClick={() =>
              void run(async () => {
                const { label: _label, ...target } = reissue;
                setIssued(undefined);
                const result = await api(path + "/reissue", {
                  method: "POST",
                  body: { ...target, reason },
                });
                setIssued(result);
                setReissue(undefined);
                setSearched(false);
                setMessage("Códigos reemplazados. Descarga la nueva entrega.");
                await load();
              })
            }
          >
            {busy ? "Generando…" : "Confirmar reemisión"}
          </button>
          {error && <Notice>{error}</Notice>}
        </Modal>
      )}
    </>
  );
}
function UsersIcon() {
  return <Plus size={22} />;
}
