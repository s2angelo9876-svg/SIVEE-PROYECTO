import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, tokens, Field, Notice } from "./lib";

export function BoothPairing() {
  const navigate = useNavigate();
  const [pairing] = useState(() =>
    Object.fromEntries(new URLSearchParams(location.hash.slice(1))),
  );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    history.replaceState(null, "", location.pathname);
  }, []);
  return (
    <main className="standalone-panel panel">
      <h1>Activar esta cabina</h1>
      <p>
        Confirma que este navegador pertenece a un equipo de votación del
        colegio. La activación sustituye cualquier equipo anterior asociado a
        esta cabina.
      </p>
      {error && <Notice>{error}</Notice>}
      <button
        className="button"
        disabled={busy || !pairing.id || !pairing.token}
        onClick={async () => {
          setBusy(true);
          try {
            await api("/booth/pair", {
              method: "POST",
              kind: "booth",
              body: pairing,
            });
            navigate("/votar", { replace: true });
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Activando…" : "Activar este equipo"}
      </button>
      {!pairing.id && <p>Solicita un enlace vigente desde Mesa y cabinas.</p>}
      <p>
        <Link to="/">Volver al inicio</Link>
      </p>
    </main>
  );
}
export function BoothIdentity({
  electionId,
  onAuthenticated,
}: {
  electionId: string;
  onAuthenticated: (data: any) => void;
}) {
  const [status, setStatus] = useState<any>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [dni, setDni] = useState("");
  const onSuccess = useRef(onAuthenticated);
  onSuccess.current = onAuthenticated;
  useEffect(() => {
    let ended = false,
      inflight = false;
    const poll = async () => {
      if (inflight) return;
      inflight = true;
      try {
        const r = await api("/booth/status", { kind: "booth" });
        if (ended) return;
        tokens.booth = r.csrfToken;
        setStatus(r);
        if (r.electionId !== electionId) {
          setError(
            "Esta cabina corresponde a otra elección. Solicita al comité que la active para la jornada actual.",
          );
          return;
        }
        if (r.request?.state === "APPROVED") {
          const data = await api("/booth/claim", {
            method: "POST",
            kind: "booth",
            body: { requestId: r.request.id },
          });
          if (!ended) {
            ended = true;
            onSuccess.current(data);
          }
        }
      } catch (e: any) {
        if (!ended) setError(e.message);
      } finally {
        inflight = false;
      }
    };
    void poll();
    const t = setInterval(() => void poll(), 2000);
    return () => {
      ended = true;
      clearInterval(t);
    };
  }, [electionId]);
  const waiting =
    status?.request && ["WAITING", "APPROVED"].includes(status.request.state);
  return (
    <section className="panel centered-panel">
      <h1>
        {waiting
          ? "La mesa verificará tu identidad"
          : "Identifícate con tu DNI"}
      </h1>
      {status && <p>{status.name}</p>}
      {error && <Notice>{error}</Notice>}
      {waiting ? (
        <>
          <p>
            Acércate al responsable con tu documento. La cédula se abrirá aquí
            cuando autorice tu participación.
          </p>
          <button
            className="button secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api("/booth/cancel", {
                  method: "POST",
                  kind: "booth",
                  body: { requestId: status.request.id },
                });
                setStatus({ ...status, request: null });
                setError("");
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Cancelar solicitud
          </button>
        </>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const request = await api("/booth/requests", {
                method: "POST",
                kind: "booth",
                body: { dni },
              });
              setStatus({ ...status, request });
              setDni("");
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <p>
            La mesa comprobará que eres tú. No necesitas un código de acceso.
          </p>
          {status?.request?.state === "CONSUMED" && (
            <Notice success>
              La última participación de esta cabina quedó registrada. El
              siguiente estudiante puede identificarse.
            </Notice>
          )}
          <Field
            label="Documento de identidad"
            hint="Ocho dígitos. Si tienes otro documento o necesitas ayuda, consulta a la mesa."
          >
            <input
              aria-label="Documento de identidad"
              value={dni}
              onChange={(e) => setDni(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              pattern="[0-9]{8}"
              maxLength={8}
              autoComplete="off"
              required
              disabled={!status || status.electionId !== electionId || busy}
            />
          </Field>
          <button
            className="button full"
            disabled={
              busy ||
              dni.length !== 8 ||
              !status ||
              status.electionId !== electionId
            }
          >
            Solicitar verificación de mesa
          </button>
        </form>
      )}
    </section>
  );
}
