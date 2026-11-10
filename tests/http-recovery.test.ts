import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../apps/web/src/lib";
import { subscribeTurnout } from "../apps/web/src/live-turnout";
const data = { eligible: 100, voted: 5, remaining: 95, participationPct: 5 };
const ok = () =>
  new Response(JSON.stringify({ data }), {
    headers: { "Content-Type": "application/json" },
  });
class FakeSource extends EventTarget {
  static all: FakeSource[] = [];
  onerror?: () => void;
  closed = false;
  constructor(public url: string) {
    super();
    FakeSource.all.push(this);
  }
  close() {
    this.closed = true;
  }
  update(payload: unknown) {
    this.dispatchEvent(
      new MessageEvent("turnout.updated", { data: JSON.stringify(payload) }),
    );
  }
}
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-10T16:00:00Z"));
  fetchMock = vi.fn().mockImplementation(async () => ok());
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("EventSource", FakeSource);
  FakeSource.all = [];
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const observe = (terminal = false) => {
  const callbacks = {
    onData: vi.fn(),
    onConnection: vi.fn(),
    onError: vi.fn(),
  };
  return {
    callbacks,
    stop: subscribeTurnout({
      path: "/admin/elections/synthetic",
      terminal,
      ...callbacks,
    }),
  };
};
describe("Respuestas 429 del proveedor o aplicación", () => {
  it("explica un 429 HTML, respeta Retry-After y no repite una creación", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>Too many requests</html>", {
        status: 429,
        headers: { "Retry-After": "120" },
      }),
    );
    const error = await api("/admin/elections", {
      method: "POST",
      body: { name: "Ensayo" },
    }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.retryAfterSeconds).toBe(120);
    expect(error.message).toContain("120 segundos");
    await vi.advanceTimersByTimeAsync(300000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("interpreta una fecha Retry-After y conserva el mensaje de la API", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "RATE_LIMITED",
            message: "Demasiados intentos de acceso.",
          },
        }),
        {
          status: 429,
          headers: { "Retry-After": "Tue, 10 Nov 2026 16:02:00 GMT" },
        },
      ),
    );
    const error = await api("/admin/auth/login").catch((e) => e);
    expect(error.retryAfterSeconds).toBe(120);
    expect(error.message).toBe("Demasiados intentos de acceso.");
  });
  it("usa una pausa de un minuto si falta Retry-After", async () => {
    fetchMock.mockResolvedValue(new Response("Rate limited", { status: 429 }));
    const error = await api("/admin/institution").catch((e) => e);
    expect(error.retryAfterSeconds).toBe(60);
    expect(error.message).toContain("60 segundos");
  });
});
describe("Reconexión de participación sin ráfagas", () => {
  it("espera el Retry-After antes de consultar o abrir un stream", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("Limited", {
        status: 429,
        headers: { "Retry-After": "120" },
      }),
    );
    const { callbacks, stop } = observe();
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeSource.all).toHaveLength(0);
    expect(callbacks.onError).toHaveBeenCalledWith(
      expect.stringContaining("120 segundos"),
    );
    await vi.advanceTimersByTimeAsync(119999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(FakeSource.all).toHaveLength(1);
    stop();
  });
  it("cierra reintentos nativos y aumenta las pausas entre fallos sucesivos", async () => {
    const { stop } = observe();
    await vi.advanceTimersByTimeAsync(0);
    const first = FakeSource.all[0];
    first.onerror?.();
    first.onerror?.();
    expect(first.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(14999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    FakeSource.all[1].onerror?.();
    await vi.advanceTimersByTimeAsync(29999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    stop();
  });
  it("no abre actualizaciones en vivo para una elección publicada", async () => {
    const { callbacks, stop } = observe(true);
    await vi.advanceTimersByTimeAsync(600000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(FakeSource.all).toHaveLength(0);
    expect(callbacks.onConnection).toHaveBeenLastCalledWith("Finalizada");
    stop();
  });
  it("cierra el stream al recibir el estado publicado", async () => {
    const { callbacks, stop } = observe();
    await vi.advanceTimersByTimeAsync(0);
    FakeSource.all[0].update({ ...data, state: "PUBLICADA" });
    expect(FakeSource.all[0].closed).toBe(true);
    expect(callbacks.onConnection).toHaveBeenLastCalledWith("Finalizada");
    await vi.advanceTimersByTimeAsync(600000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
  });
  it("deja de reintentar si la sesión vence o se revoca el permiso", async () => {
    for (const status of [401, 403]) {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: "Acceso no autorizado" } }),
          { status },
        ),
      );
      const count = fetchMock.mock.calls.length,
        { stop } = observe();
      await vi.advanceTimersByTimeAsync(600000);
      expect(fetchMock).toHaveBeenCalledTimes(count + 1);
      expect(FakeSource.all).toHaveLength(0);
      stop();
    }
  });
  it("cancela el reintento al salir del dashboard", async () => {
    const { stop } = observe();
    await vi.advanceTimersByTimeAsync(0);
    FakeSource.all[0].onerror?.();
    stop();
    await vi.advanceTimersByTimeAsync(600000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
