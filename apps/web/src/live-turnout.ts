import { api, ApiError } from "./lib";

type Turnout = {
  eligible: number;
  voted: number;
  remaining: number;
  participationPct: number;
  state?: string;
};
// Close native EventSource retries and use bounded backoff. Never replay a write.
export function subscribeTurnout(options: {
  path: string;
  terminal: boolean;
  onData: (data: Turnout) => void;
  onConnection: (state: string) => void;
  onError: (message: string) => void;
}) {
  let stopped = false;
  let stream: EventSource | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let delay = 15000;
  const retry = (error?: unknown) => {
    stream?.close();
    stream = undefined;
    if (stopped || timer !== undefined) return;
    if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
      options.onConnection("Sin conexión");
      options.onError(error.message);
      return;
    }
    const wait = Math.max(
      delay,
      error instanceof ApiError ? (error.retryAfterSeconds || 0) * 1000 : 0,
    );
    options.onConnection("Reconexión en espera");
    options.onError(
      error instanceof Error
        ? error.message
        : "Se interrumpió la actualización en vivo. Se reintentará con una pausa.",
    );
    timer = setTimeout(
      () => {
        timer = undefined;
        void connect();
      },
      Math.min(wait, 2147483647),
    );
    delay = Math.min(delay * 2, 120000);
  };
  const connect = async () => {
    if (stopped) return;
    try {
      const initial = await api<Turnout>(options.path + "/turnout");
      if (stopped) return;
      options.onData(initial);
      options.onError("");
      if (options.terminal) {
        options.onConnection("Finalizada");
        return;
      }
      options.onConnection("Conectando");
      const source = new EventSource("/api/v1" + options.path + "/events");
      stream = source;
      source.addEventListener("turnout.updated", (event) => {
        if (stopped || stream !== source) return;
        try {
          const data: Turnout = JSON.parse((event as MessageEvent).data);
          options.onData(data);
          options.onError("");
          delay = 15000;
          if (data.state && ["PUBLICADA", "ANULADA"].includes(data.state)) {
            stream?.close();
            stream = undefined;
            options.onConnection("Finalizada");
          } else options.onConnection("En vivo");
        } catch {
          retry(
            new Error(
              "No se pudo leer la actualización. Se reintentará con una pausa.",
            ),
          );
        }
      });
      source.onerror = () => {
        if (stream === source) retry();
      };
    } catch (error) {
      if (!stopped) retry(error);
    }
  };
  void connect();
  return () => {
    stopped = true;
    stream?.close();
    if (timer !== undefined) clearTimeout(timer);
  };
}
