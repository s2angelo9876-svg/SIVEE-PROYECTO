import { useEffect, useState } from "react";
import { useAdmin } from "./Admin";
import { hasPermission } from "../../../packages/shared/domain";
import { api, Field, Notice, Modal, dateFormat } from "./lib";

type Copy = {
  id: string;
  label: string;
  createdAt: string;
  summary: {
    name: string;
    rows: number;
    eligible: number;
    foreign: number;
    lists: number;
    shifts: string[];
  };
};
export function ElectionCopies({
  configurationDirty,
  onRecovered,
}: {
  configurationDirty: boolean;
  onRecovered: (election: { id: string }) => Promise<void>;
}) {
  const { id, election, user, can } = useAdmin();
  const [copies, setCopies] = useState<Copy[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [save, setSave] = useState<{ requestId: string; label: string }>();
  const [recover, setRecover] = useState<{
    copy: Copy;
    requestId: string;
    name: string;
  }>();
  const [confirmation, setConfirmation] = useState("");
  const allowed = ["elections:write", "roster:write", "lists:write"].every(can);
  const canRecover = ["elections:write", "roster:write", "lists:write"].every(
    (permission) => hasPermission(user.grants, permission),
  );
  const root = `/admin/elections/${id}/copies`;
  const load = () => api<Copy[]>(root).then(setCopies);
  useEffect(() => {
    if (allowed && election.authMode === "DESK")
      void load().catch((e) => setError(e.message));
  }, []);
  if (!allowed || election.authMode !== "DESK") return null;
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
  return (
    <section className="panel" aria-label="Copias de configuración">
      <div className="panel-heading">
        <div>
          <h2>Copias de configuración</h2>
          <p>
            Guarda los datos de la elección, el padrón con sus extranjeros, las
            listas, sus logos y los horarios. Recuperar crea una elección nueva
            sin votos y conserva la anterior.
          </p>
        </div>
        <button
          className="button secondary"
          disabled={busy || configurationDirty || election.state === "ANULADA"}
          onClick={() => {
            setError("");
            setSave({
              requestId: crypto.randomUUID(),
              label: "Configuración lista para votar",
            });
          }}
        >
          Guardar copia
        </button>
      </div>
      {configurationDirty && (
        <p>Guarda los datos y horarios pendientes antes de crear la copia.</p>
      )}
      <p>
        La copia incluye los cambios ya guardados en cada pantalla. Las cuentas,
        los datos de la institución y su escudo se mantienen.
      </p>
      {error && <Notice>{error}</Notice>}
      {message && <Notice success>{message}</Notice>}
      {copies.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Copia</th>
                <th>Guardada</th>
                <th>Contenido</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {copies.map((copy) => (
                <tr key={copy.id}>
                  <td>
                    <strong>{copy.label}</strong>
                    <small className="block">{copy.summary.name}</small>
                  </td>
                  <td>{dateFormat(copy.createdAt)}</td>
                  <td>
                    {copy.summary.rows} registros · {copy.summary.eligible}{" "}
                    habilitados · {copy.summary.foreign} extranjeros ·{" "}
                    {copy.summary.lists} listas
                  </td>
                  <td>
                    <button
                      className="button secondary"
                      disabled={busy || !canRecover}
                      onClick={() => {
                        setError("");
                        setConfirmation("");
                        setRecover({
                          copy,
                          requestId: crypto.randomUUID(),
                          name:
                            copy.summary.name.slice(0, 130) + " · Recuperada",
                        });
                      }}
                    >
                      Recuperar como nueva elección
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>Se muestran las últimas 20 copias de esta elección.</p>
        </div>
      ) : (
        <p>Aún no hay copias guardadas para esta elección.</p>
      )}
      {!canRecover && (
        <p>
          La recuperación requiere permisos para crear elecciones, administrar
          el padrón y las listas de toda la institución.
        </p>
      )}
      {save && (
        <Modal
          title="Guardar copia de configuración"
          onClose={() => !busy && setSave(undefined)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await api(root, { method: "POST", body: save });
                setSave(undefined);
                await load();
                setMessage("La copia de configuración quedó guardada.");
              });
            }}
          >
            <Field label="Nombre de la copia">
              <input
                value={save.label}
                minLength={3}
                maxLength={100}
                required
                onChange={(e) => setSave({ ...save, label: e.target.value })}
              />
            </Field>
            <p>
              Se guardará la configuración actual de esta elección. Los votos no
              forman parte de esta copia.
            </p>
            {error && <Notice>{error}</Notice>}
            <button
              className="button"
              disabled={busy || save.label.trim().length < 3}
            >
              {busy ? "Guardando…" : "Confirmar copia"}
            </button>
          </form>
        </Modal>
      )}
      {recover && (
        <Modal
          title="Recuperar como nueva elección"
          onClose={() => !busy && setRecover(undefined)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const created = await api(
                  root + "/" + recover.copy.id + "/recover",
                  {
                    method: "POST",
                    body: {
                      requestId: recover.requestId,
                      name: recover.name,
                      confirmation,
                    },
                  },
                );
                setRecover(undefined);
                await onRecovered(created);
              });
            }}
          >
            <p>
              Se recuperará «{recover.copy.label}», guardada el{" "}
              {dateFormat(recover.copy.createdAt)}. La elección anterior
              conservará sus votos y su auditoría.
            </p>
            <p>
              La nueva elección quedará en borrador, con cero votos y turnos
              programados. Revisa los horarios y la autorización institucional
              antes de prepararla. Para recuperar, primero deben estar cerradas
              las elecciones preparadas o en curso.
            </p>
            <p>
              La nueva elección aparecerá en el enlace de votación. Solo
              aceptará votos cuando la prepares y abras un turno.
            </p>
            <Field label="Nombre de la elección recuperada">
              <input
                value={recover.name}
                minLength={5}
                maxLength={150}
                required
                onChange={(e) =>
                  setRecover({ ...recover, name: e.target.value })
                }
              />
            </Field>
            <Field label="Escribe CREAR NUEVA ELECCION para confirmar">
              <input
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="off"
                required
              />
            </Field>
            {error && <Notice>{error}</Notice>}
            <button
              className="button"
              disabled={
                busy ||
                confirmation !== "CREAR NUEVA ELECCION" ||
                recover.name.trim().length < 5
              }
            >
              {busy ? "Recuperando…" : "Confirmar recuperación"}
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
