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
  const [identityType, setIdentityType] = useState("DNI");
  const foreign = identityType === "EXTRANJERO";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="panel centered-panel">
      <h1>
        {foreign ? "Identifícate con tu matrícula" : "Identifícate con tu DNI"}
      </h1>
      <p>
        Usa tu identificación personal. Los estudiantes extranjeros habilitados
        pueden ingresar con su código de matrícula del colegio. Solo puedes
        votar una vez.
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
              body: foreign
                ? {
                    electionId,
                    identityType: "EXTRANJERO",
                    studentCode: dni.trim(),
                  }
                : { electionId, dni },
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
        <Field label="Tipo de identificación">
          <select
            value={identityType}
            disabled={busy}
            onChange={(e) => {
              setIdentityType(e.target.value);
              setDni("");
              setError("");
            }}
          >
            <option value="DNI">DNI</option>
            <option value="EXTRANJERO">Extranjero · código de matrícula</option>
          </select>
        </Field>
        <Field
          label={foreign ? "Código de matrícula" : "Documento de identidad"}
          hint={
            foreign
              ? "Usa el código de matrícula que ya figura en el Excel del colegio. No se genera un código nuevo."
              : "Ocho dígitos. No necesitas código ni autorización de mesa."
          }
        >
          <input
            aria-label={
              foreign ? "Código de matrícula" : "Documento de identidad"
            }
            value={dni}
            onChange={(e) =>
              setDni(
                foreign ? e.target.value : e.target.value.replace(/\D/g, ""),
              )
            }
            inputMode={foreign ? "text" : "numeric"}
            pattern={foreign ? undefined : "[0-9]{8}"}
            maxLength={foreign ? 60 : 8}
            autoComplete="off"
            required
            disabled={busy}
          />
        </Field>
        <button
          className="button full"
          disabled={busy || (foreign ? !dni.trim() : dni.length !== 8)}
        >
          {busy
            ? "Comprobando…"
            : foreign
              ? "Continuar con mi matrícula"
              : "Continuar con mi DNI"}
        </button>
      </form>
    </section>
  );
}
