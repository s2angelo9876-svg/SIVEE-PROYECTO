import { useState } from "react";
import { api, Field, Notice } from "./lib";

export function DniIdentity({
  electionId,
  onAuthenticated,
}: {
  electionId: string;
  onAuthenticated: (data: any) => void;
}) {
  const [dni, setDni] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="panel centered-panel">
      <h1>Identifícate con tu DNI</h1>
      <p>
        Ingresa tu propio DNI para votar. La jornada debe estar abierta y solo
        puedes votar una vez, sin importar tu turno.
      </p>
      {error && <Notice>{error}</Notice>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const data = await api("/voter/dni-sessions", {
              method: "POST",
              kind: "voter",
              body: { electionId, dni },
            });
            setDni("");
            onAuthenticated(data);
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field
          label="Documento de identidad"
          hint="Ocho dígitos. No necesitas código ni autorización de mesa."
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
            disabled={busy}
          />
        </Field>
        <button className="button full" disabled={busy || dni.length !== 8}>
          {busy ? "Comprobando…" : "Continuar con mi DNI"}
        </button>
      </form>
    </section>
  );
}
