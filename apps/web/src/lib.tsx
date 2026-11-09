import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  LoaderCircle,
  Sprout,
  Sun,
  BookOpen,
  Star,
  ArrowUpRight,
} from "lucide-react";
export const tokens = { admin: "", voter: "" };
export function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("No se pudo abrir el archivo."));
    reader.readAsDataURL(file);
  });
}
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    kind?: "admin" | "voter";
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  const kind = options.kind || "admin";
  let response: Response;
  try {
    response = await fetch("/api/v1" + path, {
      method: options.method || "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(tokens[kind] ? { "X-CSRF-Token": tokens[kind] } : {}),
        ...options.headers,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(
      "NETWORK",
      "No hay conexión. Comprueba tu red y vuelve a intentar.",
      0,
    );
  }
  const result = await response.json().catch(() => ({
    error: {
      code: "UNAVAILABLE",
      message: "El servidor no está disponible. Inténtalo de nuevo.",
    },
  }));
  if (!response.ok)
    throw new ApiError(
      result.error?.code || "ERROR",
      result.error?.message || "No se pudo completar la operación.",
      response.status,
    );
  return result.data;
}
export const dateFormat = (d: string | Date) =>
  new Date(d).toLocaleString("es-PE", {
    timeZone: "America/Lima",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
export const stateLabel: Record<string, string> = {
  BORRADOR: "En preparación",
  PREPARADA: "Lista para abrir",
  EN_CURSO: "Votación en curso",
  PAUSADA: "Jornada en pausa",
  CERRADA: "Elección cerrada",
  CONCILIADA: "Conciliación verificada",
  PUBLICADA: "Resultados publicados",
  ANULADA: "Simulación archivada",
  PROGRAMADA: "Por abrir",
  ABIERTA: "Abierto",
};
export const shiftLabel = (s: string) => (s === "MANANA" ? "Mañana" : "Tarde");
export function SymbolIcon({
  name,
  size = 26,
}: {
  name: string;
  size?: number;
}) {
  if (/^data:image\/(png|jpeg);base64,/.test(name))
    return (
      <img className="list-logo" src={name} width={size} height={size} alt="" />
    );
  const I =
    ({ sprout: Sprout, sun: Sun, book: BookOpen, star: Star } as any)[name] ||
    Sprout;
  return <I size={size} strokeWidth={1.6} />;
}
export function Badge({ state }: { state: string }) {
  return (
    <span
      className={
        "badge " +
        (["EN_CURSO", "ABIERTA", "PUBLICADA"].includes(state) ? "positive" : "")
      }
    >
      <span className="dot" />
      {stateLabel[state] || state}
    </span>
  );
}
export function Notice({
  children,
  success = false,
}: {
  children: React.ReactNode;
  success?: boolean;
}) {
  return (
    <div
      className={"notice " + (success ? "success" : "")}
      role={success ? "status" : "alert"}
    >
      {success ? <Check size={19} /> : <AlertCircle size={19} />}
      <span>{children}</span>
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" /> Cargando…
    </div>
  );
}
export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog ref={ref} onCancel={onClose} className="modal">
      <button
        className="modal-close"
        aria-label="Cerrar diálogo"
        onClick={onClose}
      >
        ×
      </button>
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}
export function DownloadLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const [error, setError] = useState("");
  return (
    <>
      <button
        className="button secondary"
        onClick={async () => {
          setError("");
          try {
            const r = await fetch("/api/v1" + href);
            if (!r.ok) throw new Error((await r.json()).error.message);
            const b = await r.blob();
            const u = URL.createObjectURL(b);
            const a = document.createElement("a");
            a.href = u;
            a.download = href.split("/").pop() || "archivo";
            a.click();
            setTimeout(() => URL.revokeObjectURL(u), 1000);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        {children}
        <ArrowUpRight size={16} />
      </button>
      {error && <Notice>{error}</Notice>}
    </>
  );
}
export function downloadText(name: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function csvCell(value: unknown) {
  return (
    '"' +
    String(value)
      .replace(/^[=+@-]/, "'")
      .replaceAll('"', '""') +
    '"'
  );
}
