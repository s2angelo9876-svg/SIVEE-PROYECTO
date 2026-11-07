import { useEffect, useState } from "react";
import { useAdmin } from "./Admin";
import {
  api,
  Field,
  Modal,
  Notice,
  PageTitle,
  dateFormat,
  shiftLabel,
} from "./lib";
export function Desk() {
  const { id } = useAdmin();
  return <DeskScreen key={id} />;
}
function DeskScreen() {
  const { id, election, can } = useAdmin(),
    root = `/admin/elections/${id}/desk`;
  const [data, setData] = useState<any>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(""),
    [staff, setStaff] = useState(""),
    [link, setLink] = useState("");
  const [action, setAction] = useState<any>(),
    [reason, setReason] = useState(""),
    [verified, setVerified] = useState(false),
    [document, setDocument] = useState("");
  const load = async () => setData(await api(root));
  useEffect(() => {
    if (!id || election?.authMode !== "DESK") return;
    let ended = false,
      inflight = false;
    const update = async () => {
      if (inflight) return;
      inflight = true;
      try {
        const d = await api(root);
        if (!ended) setData(d);
      } catch (e: any) {
        if (!ended) setError(e.message);
      } finally {
        inflight = false;
      }
    };
    void update();
    const t = setInterval(() => void update(), 3000);
    return () => {
      ended = true;
      clearInterval(t);
    };
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!election) return <Notice>Crea una elección.</Notice>;
  if (election.authMode !== "DESK")
    return (
      <Notice>
        Esta elección utiliza el recorrido anterior de simulación. Crea una
        nueva elección para usar cabinas y verificación presencial.
      </Notice>
    );
  const active = ["BORRADOR", "PREPARADA", "EN_CURSO", "PAUSADA"].includes(
    election.state,
  );
  function open(a: any) {
    setAction(a);
    setReason("");
    setVerified(false);
    setDocument("");
  }
  return (
    <>
      <PageTitle
        title="Mesa y cabinas"
        description="Comprueba presencialmente la identidad y autoriza únicamente la cabina donde está el estudiante."
      />
      {error && <Notice>{error}</Notice>}
      <section className="panel">
        <h2>Solicitudes de verificación</h2>
        {!data?.requests.length && <p>No hay solicitudes pendientes.</p>}
        <div className="desk-requests">
          {data?.requests.map((r: any) => (
            <article className="desk-request" key={r.id}>
              <p className="eyebrow">
                {data.booths.find((b: any) => b.id === r.boothId)?.name}
              </p>
              <h3>{r.student?.displayName}</h3>
              <p>
                {r.student?.grade}° · {r.student?.section} ·{" "}
                {shiftLabel(r.student?.shift)}
              </p>
              <p>
                {r.state === "WAITING"
                  ? "Espera verificación presencial"
                  : "Autorizado; esperando el voto"}{" "}
                · vence {dateFormat(r.expiresAt)}
              </p>
              <div className="roster-actions">
                {r.state === "WAITING" && (
                  <button
                    className="button"
                    disabled={busy || !active}
                    onClick={() => open({ kind: "approve", request: r })}
                  >
                    Verificar identidad
                  </button>
                )}
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => open({ kind: "cancel", request: r })}
                >
                  Cancelar autorización
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>Cabinas registradas</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cabina</th>
                <th>Estado</th>
                <th>Responsable</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {data?.booths.map((b: any) => (
                <tr key={b.id}>
                  <td>{b.name}</td>
                  <td>
                    {!b.active
                      ? "Desactivada"
                      : b.paired
                        ? "Activada"
                        : "Pendiente de activar"}
                  </td>
                  <td>
                    {data.staff.find((s: any) => s.id === b.assignedAdminId)
                      ?.name || "Tu mesa"}
                  </td>
                  <td>
                    {can("desk:manage") && active && (
                      <div className="roster-actions">
                        {b.active && (
                          <button
                            className="button secondary"
                            disabled={busy}
                            onClick={() => open({ kind: "pairing", booth: b })}
                          >
                            Activar en un equipo
                          </button>
                        )}
                        <button
                          className="button text"
                          disabled={busy}
                          onClick={() =>
                            open({
                              kind: "update",
                              booth: b,
                              assignedAdminId: b.assignedAdminId,
                              active: !b.active,
                            })
                          }
                        >
                          {b.active
                            ? "Desactivar / reasignar"
                            : "Reactivar / reasignar"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {can("desk:manage") && active && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api(root + "/booths", {
                  method: "POST",
                  body: { name, assignedAdminId: staff },
                });
                setName("");
              });
            }}
          >
            <div className="roster-field-grid">
              <Field label="Nombre de la nueva cabina">
                <input
                  value={name}
                  minLength={2}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </Field>
              <Field label="Responsable de mesa">
                <select
                  value={staff}
                  onChange={(e) => setStaff(e.target.value)}
                  required
                >
                  <option value="">Selecciona una cuenta</option>
                  {data?.staff.map((s: any) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <button className="button" disabled={busy}>
              Registrar cabina
            </button>
          </form>
        )}
      </section>
      {link && (
        <section className="panel">
          <h2>Enlace de activación del equipo</h2>
          <p>
            Ábrelo únicamente en el navegador de la cabina. Es de un solo uso y
            vence en diez minutos. No se entrega a los estudiantes.
          </p>
          <Field label="Enlace privado de activación">
            <textarea readOnly value={link} />
          </Field>
          <button className="button secondary" onClick={() => setLink("")}>
            Ocultar enlace
          </button>
        </section>
      )}
      {action && (
        <Modal
          title={
            action.kind === "approve"
              ? "Verificar identidad presencial"
              : "Confirmar operación de mesa"
          }
          onClose={() => !busy && setAction(undefined)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                if (action.request)
                  await api(
                    root + `/requests/${action.request.id}/${action.kind}`,
                    {
                      method: "POST",
                      body: {
                        reason,
                        identityVerified: verified,
                        ...(action.kind === "approve" ? { document } : {}),
                      },
                    },
                  );
                else if (action.kind === "pairing") {
                  const r = await api(
                    root + `/booths/${action.booth.id}/pairing`,
                    { method: "POST", body: { reason } },
                  );
                  setLink(r.url);
                } else
                  await api(root + `/booths/${action.booth.id}`, {
                    method: "PATCH",
                    body: {
                      active: action.active,
                      assignedAdminId: action.assignedAdminId,
                      reason,
                    },
                  });
                setAction(undefined);
              });
            }}
          >
            {action.kind === "approve" && (
              <>
                <p>
                  <strong>{action.request.student?.displayName}</strong> ·{" "}
                  {
                    data.booths.find(
                      (b: any) => b.id === action.request.boothId,
                    )?.name
                  }
                </p>
                <Field label="DNI cotejado en el documento">
                  <input
                    inputMode="numeric"
                    pattern="[0-9]{8}"
                    maxLength={8}
                    value={document}
                    onChange={(e) =>
                      setDocument(e.target.value.replace(/\D/g, ""))
                    }
                    required
                  />
                </Field>
                <label className="roster-check">
                  <input
                    type="checkbox"
                    checked={verified}
                    onChange={(e) => setVerified(e.target.checked)}
                    required
                  />
                  He comprobado presencialmente que el documento y la persona
                  corresponden a este estudiante.
                </label>
              </>
            )}
            {action.kind === "update" && (
              <>
                <p>
                  Se cerrarán las autorizaciones vigentes. El equipo requerirá
                  una nueva activación.
                </p>
                <Field label="Responsable asignado">
                  <select
                    value={action.assignedAdminId}
                    onChange={(e) =>
                      setAction({ ...action, assignedAdminId: e.target.value })
                    }
                  >
                    {data.staff.map((s: any) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <label className="roster-check">
                  <input
                    type="checkbox"
                    checked={action.active}
                    onChange={(e) =>
                      setAction({ ...action, active: e.target.checked })
                    }
                  />
                  Cabina habilitada
                </label>
              </>
            )}
            <Field label="Motivo o comprobación realizada">
              <textarea
                value={reason}
                minLength={10}
                maxLength={300}
                onChange={(e) => setReason(e.target.value)}
                required
              />
            </Field>
            <p>
              No escribas el DNI completo ni una preferencia electoral en el
              motivo.
            </p>
            <button
              className="button"
              disabled={
                busy ||
                reason.trim().length < 10 ||
                (action.kind === "approve" && !verified)
              }
            >
              Confirmar
            </button>
            {error && <Notice>{error}</Notice>}
          </form>
        </Modal>
      )}
    </>
  );
}
