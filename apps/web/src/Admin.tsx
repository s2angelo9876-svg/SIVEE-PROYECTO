import { createContext, useContext, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Leaf,
  Users,
  Vote,
  Settings2,
  ClipboardCheck,
  ShieldCheck,
  LogOut,
  ArrowRight,
  ArrowLeft,
  ArrowUpRight,
  LockKeyhole,
  TrendingUp,
  CheckCircle2,
  Clock,
  Sun,
  Sunset,
  Play,
  Pause,
  Square,
  RefreshCw,
  Download,
  Plus,
  FileText,
  AlertTriangle,
  Activity,
  Check,
  KeyRound,
  Menu,
  X,
} from "lucide-react";
import {
  api,
  tokens,
  Badge,
  Field,
  Notice,
  Loading,
  PageTitle,
  Empty,
  SymbolIcon,
  Modal,
  DownloadLink,
  dateFormat,
  shiftLabel,
  downloadText,
} from "./lib";
import { Brand } from "./Public";
import { hasPermission } from "../../../packages/shared/domain";
const AdminContext = createContext<any>(null);
export function useAdmin() {
  return useContext(AdminContext);
}
export function AdminLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [mfa, setMfa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="admin-login">
      <section className="admin-login-art">
        <Brand />
        <div>
          <p className="eyebrow">ACOMPAÑAMOS CADA VOZ</p>
          <h1>
            Una jornada
            <br />
            transparente.
            <br />
            <em>
              Una escuela
              <br />
              que participa.
            </em>
          </h1>
          <p>
            El espacio de trabajo del Comité Electoral.
            <br />
            Organiza, acompaña y verifica cada etapa.
          </p>
        </div>
        <span>SIVEE · MUNICIPIO ESCOLAR 2026</span>
      </section>
      <section className="admin-login-form">
        <Link className="back-link" to="/">
          <ArrowLeft size={16} /> Volver al inicio
        </Link>
        <div>
          <div className="section-icon">
            <ShieldCheck size={28} />
          </div>
          <p className="eyebrow">ACCESO RESTRINGIDO</p>
          <h1>Bienvenido al comité</h1>
          <p>Ingresa con tu cuenta de personal autorizado.</p>
          {error && <Notice>{error}</Notice>}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const d = await api("/admin/auth/login", {
                  method: "POST",
                  body: { email, password, ...(mfa ? { otp } : {}) },
                });
                tokens.admin = d.csrfToken;
                navigate("/admin", { replace: true });
              } catch (e: any) {
                setError(e.message);
                if (e.code === "MFA_REQUIRED") setMfa(true);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Correo electrónico">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="comite@institucion.edu.pe"
                autoComplete="username"
                required
              />
            </Field>
            <Field label="Contraseña">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Tu contraseña"
                autoComplete="current-password"
                required
              />
            </Field>
            {mfa && (
              <Field label="Código de autenticación">
                <input
                  inputMode="numeric"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  pattern="[0-9]{6}"
                  required
                />
              </Field>
            )}
            <button className="button full" disabled={busy}>
              {busy ? "Ingresando…" : "Ingresar al panel"}
              <ArrowRight size={18} />
            </button>
          </form>
          <div className="demo-help">
            <strong>Cuenta de demostración</strong>
            <br />
            comite@sivee.demo
            <br />
            Contraseña: DemoSivee2026!
          </div>
        </div>
        <small>
          <LockKeyhole size={14} /> Las acciones administrativas quedan
          registradas.
        </small>
      </section>
    </div>
  );
}
export function AdminShell() {
  const [user, setUser] = useState<any>();
  const [elections, setElections] = useState<any[]>([]);
  const [id, setId] = useState("");
  const [error, setError] = useState("");
  const [mobile, setMobile] = useState(false);
  const navigate = useNavigate();
  const load = async () => {
    const all = await api("/admin/elections");
    setElections(all);
    setId((previous: string) =>
      all.some((e: any) => e.id === previous)
        ? previous
        : all.find((e: any) => e.state !== "ANULADA")?.id || all[0]?.id || "",
    );
  };
  useEffect(() => {
    api("/admin/me")
      .then((u) => {
        tokens.admin = u.csrfToken;
        setUser(u);
        return load();
      })
      .catch((e) => {
        if (e.status === 401) navigate("/admin/login", { replace: true });
        else setError(e.message);
      });
  }, []);
  const election = elections.find((e) => e.id === id);
  const can = (p: string) => user && hasPermission(user.grants, p, id);
  const nav = [
    {
      to: "/admin",
      label: "Vista general",
      icon: LayoutDashboard,
      p: "turnout:read",
    },
    {
      to: "/admin/jornada",
      label: "Jornada electoral",
      icon: Clock,
      p: "windows:manage",
    },
    {
      to: "/admin/padron",
      label: "Padrón electoral",
      icon: Users,
      p: "roster:read",
    },
    {
      to: "/admin/listas",
      label: "Listas participantes",
      icon: Vote,
      p: "lists:read",
    },
    {
      to: "/admin/resultados",
      label: "Resultados y actas",
      icon: TrendingUp,
      p: "results:read",
    },
    {
      to: "/admin/incidencias",
      label: "Incidencias",
      icon: AlertTriangle,
      p: "incidents:read",
    },
    {
      to: "/admin/auditoria",
      label: "Auditoría",
      icon: ClipboardCheck,
      p: "audit:read",
    },
    {
      to: "/admin/configuracion",
      label: "Configuración",
      icon: Settings2,
      p: "elections:write",
    },
    {
      to: "/admin/cuentas",
      label: "Cuentas del personal",
      icon: Users,
      p: "accounts:manage",
    },
    {
      to: "/admin/seguridad",
      label: "Seguridad de cuenta",
      icon: KeyRound,
      p: null,
    },
  ];
  if (error)
    return (
      <div className="error-page">
        <Notice>{error}</Notice>
        <button onClick={() => location.reload()}>Reintentar</button>
      </div>
    );
  if (!user) return <Loading />;
  return (
    <AdminContext.Provider
      value={{ user, elections, election, id, setId, refresh: load, can }}
    >
      <div className="admin-layout">
        <aside
          className={"sidebar " + (mobile ? "is-open" : "")}
          aria-label="Menú de administración"
          tabIndex={0}
        >
          <Brand />
          <button
            className="mobile-close"
            onClick={() => setMobile(false)}
            aria-label="Cerrar menú"
          >
            <X />
          </button>
          <div className="workspace-tag">
            <span className="dot" /> COMITÉ ELECTORAL{" "}
            <small>Simulación 2026</small>
          </div>
          <nav>
            {nav
              .filter((n) => !n.p || can(n.p))
              .map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.to === "/admin"}
                  onClick={() => setMobile(false)}
                >
                  <n.icon size={18} />
                  {n.label}
                </NavLink>
              ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="demo-box">
              <ShieldCheck size={21} />
              <strong>Un espacio de prueba</strong>
              <p>Esta jornada utiliza únicamente datos ficticios.</p>
            </div>
            <div className="user-line">
              <div className="avatar small">{user.name[0]}</div>
              <div>
                <strong>{user.name}</strong>
                <small>{user.grants[0]?.role.toLowerCase()}</small>
              </div>
              <button
                title="Cerrar sesión"
                aria-label="Cerrar sesión"
                onClick={async () => {
                  await api("/admin/auth/logout", { method: "POST" });
                  tokens.admin = "";
                  navigate("/admin/login", { replace: true });
                }}
              >
                <LogOut size={18} />
              </button>
            </div>
          </div>
        </aside>
        <div className="admin-content">
          <header className="admin-topbar">
            <div>
              <button
                className="mobile-menu"
                onClick={() => setMobile(true)}
                aria-label="Abrir menú"
              >
                <Menu />
              </button>
              <span className="breadcrumb">
                Espacio electoral <span>/</span> Municipio Escolar
              </span>
            </div>
            <span className="demo-pill">MODO DEMO</span>
          </header>
          <main className="admin-main">
            {elections.length > 1 && (
              <div className="election-picker">
                <label htmlFor="active-election">Elección activa</label>
                <select
                  id="active-election"
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                >
                  {elections.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} ·{" "}
                      {e.state === "ANULADA" ? "Archivada" : e.id.slice(0, 6)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <Outlet />
          </main>
          <footer className="admin-footer">
            <span>SIVEE · Sistema de Votación Electrónica Escolar</span>
            <span>Hora local · Lima, Perú</span>
          </footer>
        </div>
      </div>
    </AdminContext.Provider>
  );
}
export function Dashboard() {
  const { election, id, refresh, can } = useAdmin();
  const [p, setP] = useState<any>();
  const [connection, setConnection] = useState("Conectando");
  const [time, setTime] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!id || !can("turnout:read")) return;
    setP(undefined);
    api(`/admin/elections/${id}/turnout`)
      .then(setP)
      .catch((e) => setError(e.message));
    const source = new EventSource(`/api/v1/admin/elections/${id}/events`);
    source.addEventListener("turnout.updated", (event: any) => {
      const d = JSON.parse(event.data);
      setP(d);
      setConnection("En vivo");
      setTime(dateFormat(new Date()));
      if (d.state !== election.state) void refresh();
    });
    source.onerror = () => setConnection("Reconectando");
    return () => source.close();
  }, [id, election?.state]);
  if (!can("turnout:read"))
    return (
      <PageTitle
        title="Tu espacio de trabajo"
        description="Usa el menú para administrar las funciones de tu perfil."
      />
    );
  if (!election) return <Empty>Crea una elección para comenzar.</Empty>;
  return (
    <>
      <PageTitle
        eyebrow="TU COMUNIDAD, EN MOVIMIENTO"
        title="Cada participación cuenta."
        description="Acompaña la jornada electoral desde un solo lugar."
        action={
          <span className="live-indicator">
            <span className="dot" />
            {connection}
          </span>
        }
      />
      {error && <Notice>{error}</Notice>}
      <section className="election-banner">
        <div>
          <span className="tiny-label">
            MUNICIPIO ESCOLAR · {election.year}
          </span>
          <h2>{election.name}</h2>
          <p>{election.institution.name}</p>
        </div>
        <Badge state={election.state} />
      </section>
      {!p ? (
        <Loading />
      ) : (
        <>
          <section className="stats-grid">
            {[
              {
                label: "Electores habilitados",
                value: p.eligible,
                sub: "Padrón de esta elección",
                icon: Users,
              },
              {
                label: "Ya participaron",
                value: p.voted,
                sub: "Votos registrados",
                icon: CheckCircle2,
              },
              {
                label: "Faltan por participar",
                value: p.remaining,
                sub: "Participación pendiente",
                icon: Clock,
              },
              {
                label: "Participación",
                value: p.participationPct.toFixed(1) + "%",
                sub: "Del padrón habilitado",
                icon: TrendingUp,
              },
            ].map((s, i) => (
              <article
                className={"stat-card " + (i === 1 ? "highlight" : "")}
                key={s.label}
              >
                <div>
                  <span>{s.label}</span>
                  <s.icon size={19} />
                </div>
                <strong>{s.value}</strong>
                <small>{s.sub}</small>
              </article>
            ))}
          </section>
          <div className="dashboard-grid">
            <section className="panel participation-panel">
              <div className="panel-heading">
                <div>
                  <h2>Así va nuestra participación</h2>
                  <p>Cada voto representa una voz.</p>
                </div>
                <Activity size={20} />
              </div>
              <div className="participation-body">
                <div className="donut">
                  <svg
                    viewBox="0 0 160 160"
                    aria-label={`${p.participationPct}% de participación`}
                    role="img"
                  >
                    <circle
                      cx="80"
                      cy="80"
                      r="65"
                      fill="none"
                      stroke="#edf1ed"
                      strokeWidth="13"
                    />
                    <circle
                      cx="80"
                      cy="80"
                      r="65"
                      fill="none"
                      stroke="#187364"
                      strokeWidth="13"
                      strokeDasharray={`${p.participationPct * 4.084} 408.4`}
                      strokeLinecap="round"
                      transform="rotate(-90 80 80)"
                    />
                  </svg>
                  <div>
                    <strong>
                      {p.participationPct.toFixed(0)}
                      <small>%</small>
                    </strong>
                    <span>de participación</span>
                  </div>
                </div>
                <div className="participation-legend">
                  <p>
                    <i /> Participaron <strong>{p.voted}</strong>
                  </p>
                  <p>
                    <i className="muted" /> Pendientes{" "}
                    <strong>{p.remaining}</strong>
                  </p>
                  <div className="soft-note">
                    <Leaf size={19} />
                    <span>
                      Una escuela se construye
                      <br />
                      con todas sus voces.
                    </span>
                  </div>
                </div>
              </div>
              <div className="panel-foot">
                <span>
                  <RefreshCw size={13} />{" "}
                  {time ? "Actualizado " + time : "Conectando con el servidor"}
                </span>
                <span>Cifras agregadas</span>
              </div>
            </section>
            <section className="panel windows-panel">
              <div className="panel-heading">
                <div>
                  <h2>Turnos de la jornada</h2>
                  <p>Una elección, dos momentos.</p>
                </div>
                <Clock size={19} />
              </div>
              {election.windows.map((w: any) => (
                <div className="window-summary" key={w.id}>
                  <div className="shift-icon">
                    {w.shift === "MANANA" ? (
                      <Sun size={22} />
                    ) : (
                      <Sunset size={22} />
                    )}
                  </div>
                  <div>
                    <strong>Turno {shiftLabel(w.shift).toLowerCase()}</strong>
                    <span>
                      {w.state === "PROGRAMADA"
                        ? "Pendiente de apertura"
                        : w.state === "CERRADA"
                          ? "Jornada finalizada"
                          : "Gestionado por el comité"}
                    </span>
                  </div>
                  <Badge state={w.state} />
                </div>
              ))}
              {can("windows:manage") && (
                <Link className="text-link" to="/admin/jornada">
                  Gestionar jornada <ArrowUpRight size={17} />
                </Link>
              )}
            </section>
          </div>
        </>
      )}
      {election.state !== "PUBLICADA" ? (
        <section className="embargo-banner">
          <div className="lock-medallion">
            <LockKeyhole size={24} />
          </div>
          <div>
            <h3>La participación es visible. Las preferencias, reservadas.</h3>
            <p>
              Los resultados por lista estarán disponibles después del cierre,
              la conciliación y la autorización del comité.
            </p>
          </div>
          <ShieldCheck size={26} />
        </section>
      ) : (
        <Link className="publication-banner" to="/admin/resultados">
          <CheckCircle2 />
          <div>
            <h3>Los resultados ya están publicados</h3>
            <p>
              Consulta el escrutinio verificado y descarga el acta de esta
              elección.
            </p>
          </div>
          <ArrowRight />
        </Link>
      )}
      <section className="quick-links">
        {can("roster:read") && (
          <Link to="/admin/padron">
            <Users />
            <span>
              <strong>Padrón electoral</strong>
              <small>Revisa la preparación de tus electores</small>
            </span>
            <ArrowUpRight size={18} />
          </Link>
        )}
        {can("audit:read") && (
          <Link to="/admin/auditoria">
            <ClipboardCheck />
            <span>
              <strong>Transparencia en cada paso</strong>
              <small>Consulta la bitácora de la jornada</small>
            </span>
            <ArrowUpRight size={18} />
          </Link>
        )}
      </section>
    </>
  );
}
export function ElectionDay() {
  const { election, id, refresh, can } = useAdmin();
  const [full, setFull] = useState<any>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [action, setAction] = useState<any>();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api(`/admin/elections/${id}`).then(setFull);
  useEffect(() => {
    if (id) void load().catch((e) => setError(e.message));
  }, [id, election?.state]);
  if (!election) return <Empty>Selecciona una elección.</Empty>;
  async function execute() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(`/admin/elections/${id}/${action.path}`, {
        method: "POST",
        body: action.body || { reason },
      });
      setAction(undefined);
      setReason("");
      await refresh();
      await load();
      setMessage("La acción fue registrada correctamente.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const request = (path: string, title: string, body?: unknown) => {
    setAction({ path, title, body });
    setReason("");
  };
  const pending = (type: string) =>
    full?.approvals.find((a: any) => a.type === type && a.state === "PENDING");
  return (
    <>
      <PageTitle
        title="El ritmo de la jornada"
        description="Abre, pausa y cierra cada turno con control y trazabilidad."
        action={<Badge state={election.state} />}
      />
      {error && <Notice>{error}</Notice>}
      {message && <Notice success>{message}</Notice>}
      <div className="two-columns">
        {election.windows.map((w: any) => (
          <section className="panel shift-panel" key={w.id}>
            <div className="shift-heading">
              <div className="section-icon">
                {w.shift === "MANANA" ? <Sun /> : <Sunset />}
              </div>
              <Badge state={w.state} />
            </div>
            <h2>Turno {shiftLabel(w.shift).toLowerCase()}</h2>
            <p>
              {w.shift === "MANANA"
                ? "Primer momento de participación."
                : "Se habilita al finalizar el turno mañana."}
            </p>
            <div className="button-row">
              {["PROGRAMADA", "PAUSADA"].includes(w.state) &&
                ["PREPARADA", "EN_CURSO", "PAUSADA"].includes(
                  election.state,
                ) && (
                  <button
                    className="button"
                    onClick={() =>
                      request(
                        `windows/${w.shift}/open`,
                        "Abrir turno " + shiftLabel(w.shift),
                      )
                    }
                  >
                    <Play size={16} />
                    {w.state === "PAUSADA" ? "Reanudar" : "Abrir turno"}
                  </button>
                )}
              {w.state === "ABIERTA" && (
                <button
                  className="button secondary"
                  onClick={() =>
                    request(`windows/${w.shift}/pause`, "Pausar turno")
                  }
                >
                  <Pause size={16} />
                  Pausar
                </button>
              )}
              {w.state !== "CERRADA" &&
                ["PREPARADA", "EN_CURSO", "PAUSADA"].includes(
                  election.state,
                ) && (
                  <button
                    className="button secondary"
                    onClick={() =>
                      request(
                        `windows/${w.shift}/close`,
                        "Cerrar turno de forma definitiva",
                      )
                    }
                  >
                    <Square size={14} />
                    Cerrar turno
                  </button>
                )}
              {w.state === "CERRADA" && (
                <span className="text-success">
                  <CheckCircle2 size={18} /> Turno finalizado
                </span>
              )}
            </div>
          </section>
        ))}
      </div>
      <section className="panel closing-panel">
        <div>
          <p className="eyebrow">CIERRE Y ESCRUTINIO</p>
          <h2>Finaliza con todas las cuentas claras.</h2>
          <p>
            Completa estos pasos después de cerrar ambos turnos. Los resultados
            seguirán reservados hasta el último paso.
          </p>
        </div>
        <div className="closing-steps">
          {[
            {
              n: 1,
              title: "Cierre global",
              desc: "Termina de forma definitiva la emisión de votos.",
              done: ["CERRADA", "CONCILIADA", "PUBLICADA"].includes(
                election.state,
              ),
              action: pending("close") ? (
                <button
                  className="button"
                  onClick={() =>
                    request("close-approve", "Aprobar cierre global", {
                      approvalId: pending("close").id,
                    })
                  }
                >
                  Aprobar cierre
                </button>
              ) : (
                <button
                  className="button secondary"
                  disabled={
                    !election.windows.every(
                      (w: any) => w.state === "CERRADA",
                    ) || !["PAUSADA", "EN_CURSO"].includes(election.state)
                  }
                  onClick={() =>
                    request("close-request", "Solicitar cierre global")
                  }
                >
                  Solicitar cierre
                </button>
              ),
            },
            {
              n: 2,
              title: "Conciliación",
              desc: "Comprueba participaciones, papeletas y sumas.",
              done: ["CONCILIADA", "PUBLICADA"].includes(election.state),
              action: (
                <button
                  className="button secondary"
                  disabled={election.state !== "CERRADA"}
                  onClick={() =>
                    request("reconcile", "Ejecutar conciliación", {})
                  }
                >
                  Conciliar elección
                </button>
              ),
            },
            {
              n: 3,
              title: "Publicación autorizada",
              desc: "Habilita los resultados y el acta a personal autorizado.",
              done: election.state === "PUBLICADA",
              action: pending("publish") ? (
                <button
                  className="button"
                  onClick={() =>
                    request(
                      "publish-approve",
                      "Autorizar publicación de resultados",
                      { approvalId: pending("publish").id },
                    )
                  }
                >
                  Aprobar publicación
                </button>
              ) : (
                <button
                  className="button secondary"
                  disabled={
                    election.state !== "CONCILIADA" || !can("results:publish")
                  }
                  onClick={() =>
                    request("publish-request", "Solicitar publicación")
                  }
                >
                  Solicitar publicación
                </button>
              ),
            },
          ].map((s) => (
            <div className="closing-step" key={s.n}>
              <span className={"step-number " + (s.done ? "complete" : "")}>
                {s.done ? <Check size={18} /> : s.n}
              </span>
              <div>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </div>
              {s.done ? (
                <span className="text-success">Completado</span>
              ) : (
                s.action
              )}
            </div>
          ))}
        </div>
      </section>
      {election.state === "BORRADOR" && (
        <Notice>
          Primero revisa la configuración y prepara la elección para habilitar
          la apertura.
        </Notice>
      )}
      {action && (
        <Modal
          title={action.title}
          onClose={() => !busy && setAction(undefined)}
        >
          <p>
            Esta acción quedará registrada en la auditoría. El cierre de un
            turno o elección no puede deshacerse.
          </p>
          {!action.body && (
            <Field label="Motivo de la operación">
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Describe el motivo para la bitácora"
                minLength={5}
              />
            </Field>
          )}
          <div className="button-row">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setAction(undefined)}
            >
              Cancelar
            </button>
            <button
              className="button"
              disabled={busy || (!action.body && reason.trim().length < 5)}
              onClick={() => void execute()}
            >
              {busy ? "Procesando…" : "Confirmar acción"}
            </button>
          </div>
          {error && <Notice>{error}</Notice>}
        </Modal>
      )}
    </>
  );
}
export function Lists() {
  const { id, election, can } = useAdmin();
  const [lists, setLists] = useState<any[]>([]);
  const [form, setForm] = useState<any>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api(`/admin/elections/${id}/lists`).then(setLists);
  useEffect(() => {
    if (id) void load().catch((e) => setError(e.message));
  }, [id]);
  if (!election) return <Empty>Crea una elección.</Empty>;
  const editable = election.state === "BORRADOR" && can("lists:write");
  return (
    <>
      <PageTitle
        title="Ideas que representan"
        description="Entre dos y cuatro listas, con las mismas oportunidades de ser escuchadas."
        action={
          editable && (
            <button
              className="button"
              disabled={lists.filter((l) => l.active).length >= 4}
              onClick={() =>
                setForm({
                  number: lists.length + 1,
                  name: "",
                  symbol: "sprout",
                  color: "#167568",
                  candidates: [{ name: "", position: "Alcaldía escolar" }],
                  proposal: "",
                  active: true,
                })
              }
            >
              <Plus size={17} /> Nueva lista
            </button>
          )
        }
      />
      {error && <Notice>{error}</Notice>}
      <div className="managed-lists">
        {lists.map((l) => (
          <article className="panel managed-list" key={l.id}>
            <div className="list-top">
              <span className="eyebrow">
                LISTA {String(l.number).padStart(2, "0")}
              </span>
              <span className={"badge " + (l.active ? "positive" : "")}>
                {l.active ? "Activa" : "Retirada"}
              </span>
            </div>
            <div className="list-symbol">
              <SymbolIcon name={l.symbol} size={37} />
            </div>
            <h2>{l.name}</h2>
            <p>{l.proposal}</p>
            <div className="candidates-list">
              {l.candidates.map((c: any, i: number) => (
                <div key={i}>
                  <span>{c.position}</span>
                  <strong>{c.name}</strong>
                </div>
              ))}
            </div>
            {editable && (
              <button
                className="button secondary full"
                onClick={() => setForm({ ...l })}
              >
                Editar lista
              </button>
            )}
          </article>
        ))}
      </div>
      {!lists.length && (
        <Empty>Agrega las listas aprobadas para esta elección.</Empty>
      )}
      {form && (
        <Modal
          title={form.id ? "Editar lista" : "Nueva lista"}
          onClose={() => setForm(undefined)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const { id: lid, electionId: _e, ...body } = form;
                await api(
                  `/admin/elections/${id}/lists${lid ? "/" + lid : ""}`,
                  { method: lid ? "PATCH" : "POST", body },
                );
                setForm(undefined);
                await load();
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="two-columns">
              <Field label="Número">
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={form.number}
                  onChange={(e) =>
                    setForm({ ...form, number: +e.target.value })
                  }
                  required
                />
              </Field>
              <Field label="Símbolo">
                <select
                  value={form.symbol}
                  onChange={(e) => setForm({ ...form, symbol: e.target.value })}
                >
                  <option value="sprout">Brote</option>
                  <option value="sun">Sol</option>
                  <option value="book">Libro</option>
                  <option value="star">Estrella</option>
                </select>
              </Field>
            </div>
            <Field label="Nombre de la lista">
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                minLength={3}
                maxLength={100}
                required
              />
            </Field>
            <Field label="Propuesta">
              <textarea
                value={form.proposal}
                onChange={(e) => setForm({ ...form, proposal: e.target.value })}
                maxLength={600}
              />
            </Field>
            {form.candidates.map((c: any, i: number) => (
              <div className="candidate-form" key={i}>
                <Field label="Nombre de candidatura">
                  <input
                    value={c.name}
                    minLength={3}
                    required
                    onChange={(e) =>
                      setForm({
                        ...form,
                        candidates: form.candidates.map((x: any, j: number) =>
                          j === i ? { ...x, name: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </Field>
                <Field label="Cargo">
                  <input
                    value={c.position}
                    minLength={3}
                    required
                    onChange={(e) =>
                      setForm({
                        ...form,
                        candidates: form.candidates.map((x: any, j: number) =>
                          j === i ? { ...x, position: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </Field>
                {i > 0 && (
                  <button
                    type="button"
                    className="button text"
                    onClick={() =>
                      setForm({
                        ...form,
                        candidates: form.candidates.filter(
                          (_: any, j: number) => j !== i,
                        ),
                      })
                    }
                  >
                    Quitar
                  </button>
                )}
              </div>
            ))}
            {form.candidates.length < 7 && (
              <button
                type="button"
                className="button text"
                onClick={() =>
                  setForm({
                    ...form,
                    candidates: [
                      ...form.candidates,
                      { name: "", position: "Regiduría" },
                    ],
                  })
                }
              >
                <Plus size={15} /> Agregar candidatura
              </button>
            )}
            <label className="check-label">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />{" "}
              Lista activa y aprobada para la simulación
            </label>
            {error && <Notice>{error}</Notice>}
            <button className="button full" disabled={busy}>
              Guardar lista
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function Results() {
  const { id, election, can } = useAdmin();
  const [report, setReport] = useState<any>();
  const [error, setError] = useState("");
  useEffect(() => {
    setReport(undefined);
    if (id && election?.state === "PUBLICADA")
      api(`/admin/elections/${id}/results`)
        .then(setReport)
        .catch((e) => setError(e.message));
  }, [id, election?.state]);
  return (
    <>
      <PageTitle
        title="Las voces de nuestra escuela"
        description="Escrutinio agregado y verificado. Sujeto a proclamación del Comité Electoral."
      />
      {error && <Notice>{error}</Notice>}
      {election?.state !== "PUBLICADA" ? (
        <section className="panel results-locked">
          <div className="lock-medallion">
            <LockKeyhole size={36} />
          </div>
          <p className="eyebrow">RESULTADOS RESERVADOS</p>
          <h2>Cada voto merece su momento.</h2>
          <p>
            Los resultados por lista se habilitarán cuando todos los turnos
            hayan finalizado, la conciliación sea exacta y el comité autorice la
            publicación.
          </p>
          <Badge state={election?.state || "BORRADOR"} />
          {can("windows:manage") && (
            <Link className="button secondary" to="/admin/jornada">
              Ir a la jornada <ArrowRight size={16} />
            </Link>
          )}
        </section>
      ) : !report ? (
        <Loading />
      ) : (
        <>
          <div className="reconciled-banner">
            <CheckCircle2 />
            <div>
              <strong>
                Conciliación exacta · Acta versión {report.version}
              </strong>
              <span>
                {report.summary.voted} participaciones = {report.summary.valid}{" "}
                válidos + {report.summary.blank} blancos + {report.summary.null}{" "}
                nulos
              </span>
            </div>
            <Badge state="PUBLICADA" />
          </div>
          <div className="stats-grid">
            {[
              ["Emitidos", report.summary.voted],
              ["Válidos", report.summary.valid],
              ["En blanco", report.summary.blank],
              ["Nulos", report.summary.null],
            ].map(([label, value]) => (
              <article className="stat-card" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
                <small>Votos de esta elección</small>
              </article>
            ))}
          </div>
          <section className="panel results-chart">
            <div className="panel-heading">
              <div>
                <h2>Resultados por lista</h2>
                <p>Porcentaje sobre {report.summary.valid} votos válidos.</p>
              </div>
              <span className="badge">
                {report.summary.outcome.status === "EMPATE"
                  ? "EMPATE"
                  : report.summary.outcome.status === "SIN_VOTOS_VALIDOS"
                    ? "SIN VOTOS VÁLIDOS"
                    : "RESULTADO INTERNO"}
              </span>
            </div>
            {report.summary.lists.map((l: any) => (
              <div className="result-row" key={l.id}>
                <div className="result-list">
                  <div className="shift-icon">
                    <SymbolIcon name={l.symbol} />
                  </div>
                  <span>
                    <small>LISTA {String(l.number).padStart(2, "0")}</small>
                    <strong>{l.name}</strong>
                  </span>
                </div>
                <div className="result-track">
                  <div
                    style={{
                      width: `${report.summary.valid ? (100 * l.votes) / report.summary.valid : 0}%`,
                    }}
                  />
                </div>
                <strong>
                  {l.votes}
                  <small>
                    {(report.summary.valid
                      ? (100 * l.votes) / report.summary.valid
                      : 0
                    ).toFixed(1)}
                    %
                  </small>
                </strong>
              </div>
            ))}
            <div className="result-totals">
              <span>
                Habilitados <b>{report.summary.eligible}</b>
              </span>
              <span>
                Abstenciones <b>{report.summary.remaining}</b>
              </span>
              <span>
                Participación <b>{report.summary.participationPct}%</b>
              </span>
            </div>
          </section>
          <section className="panel report-panel">
            <div>
              <p className="eyebrow">EVIDENCIA DE LA JORNADA</p>
              <h2>Acta y datos agregados</h2>
              <p>
                Aprobada por {report.approvedBy} ·{" "}
                {dateFormat(report.createdAt)}
              </p>
              <label>SHA-256 del resumen canónico</label>
              <code className="report-hash">{report.sha256}</code>
            </div>
            {can("reports:read") && (
              <div className="report-actions">
                <DownloadLink href={`/admin/elections/${id}/reports/final.pdf`}>
                  <FileText size={17} /> Acta PDF
                </DownloadLink>
                <DownloadLink href={`/admin/elections/${id}/reports/final.csv`}>
                  <Download size={17} /> Agregados CSV
                </DownloadLink>
                <button
                  className="button text"
                  onClick={() =>
                    downloadText(
                      "sivee-acta.json",
                      JSON.stringify(report, null, 2),
                      "application/json",
                    )
                  }
                >
                  Descargar resumen verificable
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
export function Settings() {
  const { election, id, refresh, setId, can } = useAdmin();
  const [form, setForm] = useState<any>();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [newElection, setNew] = useState(false);
  const [modal, setModal] = useState("");
  const [confirmation, setConfirmation] = useState("");
  useEffect(() => {
    if (election && !newElection)
      setForm({
        name: election.name,
        year: election.year,
        scope: election.scope,
        blankAllowed: election.blankAllowed,
        nullAllowed: election.nullAllowed,
        regulation: election.regulation,
        contact: election.contact,
        shifts: election.windows.map((w: any) => w.shift),
      });
  }, [id, election?.state, newElection]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await fn();
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function create() {
    setNew(true);
    setForm({
      name: "Elecciones del Municipio Escolar 2026",
      year: 2026,
      scope: "Municipio escolar · Secundaria",
      blankAllowed: true,
      nullAllowed: true,
      regulation: "Reglamento de simulación 2026",
      contact: "Solicita ayuda a tu mesa de votación.",
      shifts: ["MANANA", "TARDE"],
    });
  }
  const editable = newElection || election?.state === "BORRADOR";
  return (
    <>
      <PageTitle
        title="Prepara una buena elección"
        description="Define el proceso, revisa los requisitos y habilita la jornada."
        action={
          <button className="button secondary" onClick={create}>
            <Plus size={17} /> Nueva elección
          </button>
        }
      />
      {error && <Notice>{error}</Notice>}
      {success && <Notice success>{success}</Notice>}
      {form ? (
        <form
          className="panel settings-panel"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const r = await api(
                "/admin/elections" + (newElection ? "" : "/" + id),
                { method: newElection ? "POST" : "PATCH", body: form },
              );
              if (newElection) {
                setNew(false);
                await refresh();
                setId(r.id);
              }
              setSuccess("La configuración fue guardada.");
            });
          }}
        >
          <div className="panel-heading">
            <h2>{newElection ? "Nueva elección" : "Datos de la elección"}</h2>
            <span className="demo-pill">DEMO · DATOS FICTICIOS</span>
          </div>
          <fieldset disabled={!editable || busy}>
            <Field label="Nombre de la elección">
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                minLength={5}
              />
            </Field>
            <div className="two-columns">
              <Field label="Año">
                <input
                  type="number"
                  min={2026}
                  value={form.year}
                  onChange={(e) => setForm({ ...form, year: +e.target.value })}
                  required
                />
              </Field>
              <Field label="Ámbito">
                <input
                  value={form.scope}
                  onChange={(e) => setForm({ ...form, scope: e.target.value })}
                  required
                />
              </Field>
            </div>
            <Field label="Versión del reglamento">
              <input
                value={form.regulation}
                onChange={(e) =>
                  setForm({ ...form, regulation: e.target.value })
                }
                required
              />
            </Field>
            <Field label="Contacto de ayuda">
              <input
                value={form.contact}
                onChange={(e) => setForm({ ...form, contact: e.target.value })}
                required
              />
            </Field>
            <div className="check-options">
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={form.blankAllowed}
                  onChange={(e) =>
                    setForm({ ...form, blankAllowed: e.target.checked })
                  }
                />{" "}
                Autorizar voto en blanco
              </label>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={form.nullAllowed}
                  onChange={(e) =>
                    setForm({ ...form, nullAllowed: e.target.checked })
                  }
                />{" "}
                Autorizar opción de voto nulo
              </label>
            </div>
            {newElection && (
              <div className="check-options">
                {["MANANA", "TARDE"].map((s) => (
                  <label className="check-label" key={s}>
                    <input
                      type="checkbox"
                      checked={form.shifts.includes(s)}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          shifts: e.target.checked
                            ? [...form.shifts, s]
                            : form.shifts.filter((x: string) => x !== s),
                        })
                      }
                    />{" "}
                    Turno {shiftLabel(s)}
                  </label>
                ))}
              </div>
            )}
            {editable && (
              <button className="button" disabled={!form.shifts.length || busy}>
                {busy
                  ? "Guardando…"
                  : newElection
                    ? "Crear elección"
                    : "Guardar configuración"}
              </button>
            )}
          </fieldset>
        </form>
      ) : (
        <Empty>Comienza creando una elección.</Empty>
      )}
      {!newElection && election && (
        <>
          <InstitutionSchedule />
          <section className="panel preparation-panel">
            <div>
              <h2>Lista para recibir las voces</h2>
              <p>
                Al preparar se comprobarán el padrón, las credenciales y las 2–4
                listas aprobadas. La configuración quedará protegida.
              </p>
            </div>
            {election.state === "BORRADOR" && can("elections:prepare") ? (
              <button className="button" onClick={() => setModal("prepare")}>
                <ShieldCheck size={18} /> Preparar elección
              </button>
            ) : (
              <Badge state={election.state} />
            )}
          </section>
          {can("demo:reset") && (
            <section className="panel reset-panel">
              <div>
                <h2>Volver a ensayar</h2>
                <p>
                  Crea una nueva simulación con el mismo padrón y listas. La
                  jornada anterior se conserva archivada.
                </p>
              </div>
              <button
                className="button secondary"
                onClick={() => setModal("reset")}
              >
                <RefreshCw size={16} /> Nueva simulación
              </button>
            </section>
          )}
        </>
      )}
      {modal && (
        <Modal
          title={
            modal === "reset" ? "Crear otra simulación" : "Preparar elección"
          }
          onClose={() => setModal("")}
        >
          <p>
            {modal === "reset"
              ? "La elección anterior y sus papeletas se conservarán. La nueva simulación empezará sin votos, en preparación."
              : "Verifica que el padrón y las listas corresponden a esta simulación. Después de preparar no podrás modificarlos."}
          </p>
          {modal === "reset" && (
            <Field label="Escribe NUEVA SIMULACION">
              <input
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </Field>
          )}
          <button
            className="button"
            disabled={
              busy || (modal === "reset" && confirmation !== "NUEVA SIMULACION")
            }
            onClick={() =>
              void run(async () => {
                if (modal === "prepare")
                  await api(`/admin/elections/${id}/prepare`, {
                    method: "POST",
                    body: {},
                  });
                else {
                  const r = await api(`/admin/demo/${id}/reset`, {
                    method: "POST",
                    body: { confirmation },
                  });
                  await refresh();
                  setId(r.id);
                }
                setModal("");
                setConfirmation("");
                setSuccess("Operación completada y registrada.");
              })
            }
          >
            {busy ? "Procesando…" : "Confirmar"}
          </button>
          {error && <Notice>{error}</Notice>}
        </Modal>
      )}
    </>
  );
}
const auditLabels: Record<string, string> = {
  DEMO_SEEDED: "Datos ficticios preparados",
  ELECTION_PREPARED: "Elección preparada",
  WINDOW_OPEN: "Turno abierto",
  WINDOW_PAUSE: "Turno pausado",
  WINDOW_CLOSE: "Turno cerrado",
  CLOSE_REQUESTED: "Cierre solicitado",
  CLOSE_APPROVED: "Cierre aprobado",
  RECONCILED: "Conciliación verificada",
  PUBLISH_REQUESTED: "Publicación solicitada",
  PUBLISH_APPROVED: "Publicación autorizada",
  ROSTER_IMPORTED: "Padrón importado",
  CREDENTIALS_REISSUED: "Códigos de acceso reemitidos",
  LIST_CREATED: "Lista registrada",
  LIST_UPDATED: "Lista actualizada",
  ELECTION_UPDATED: "Configuración actualizada",
  DEMO_REPLACED: "Simulación archivada",
  DEMO_CREATED_FROM_PREVIOUS: "Nueva simulación creada",
  REPORT_PDF_EXPORTED: "Acta PDF descargada",
  REPORT_CSV_EXPORTED: "Agregados exportados",
  INCIDENT_CREATED: "Incidencia registrada",
};
export function AuditPage() {
  const { id } = useAdmin();
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (id)
      api(`/admin/elections/${id}/audit`)
        .then(setRows)
        .catch((e) => setError(e.message));
  }, [id]);
  return (
    <>
      <PageTitle
        title="Cada paso deja constancia"
        description="Historial administrativo de la elección, sin preferencias individuales."
        action={
          id && (
            <DownloadLink href={`/admin/elections/${id}/audit/export`}>
              <Download size={17} /> Exportar auditoría
            </DownloadLink>
          )
        }
      />
      {error && <Notice>{error}</Notice>}
      <section className="panel">
        {rows.length ? (
          <div className="audit-timeline">
            {rows.map((r) => (
              <article key={r.id}>
                <div className="audit-node">
                  <Check size={14} />
                </div>
                <div>
                  <h3>
                    {auditLabels[r.action] || r.action.replaceAll("_", " ")}
                  </h3>
                  <p>
                    {r.admin?.name || "Sistema de demostración"}
                    {r.detail.shift
                      ? " · Turno " + shiftLabel(r.detail.shift)
                      : ""}
                  </p>
                </div>
                <time>{dateFormat(r.createdAt)}</time>
              </article>
            ))}
          </div>
        ) : (
          <Empty>Aún no hay acciones registradas.</Empty>
        )}
      </section>
    </>
  );
}
export function Incidents() {
  const { id, can } = useAdmin();
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState<any>();
  const [busy, setBusy] = useState(false);
  const load = () => api(`/admin/elections/${id}/incidents`).then(setRows);
  useEffect(() => {
    if (id) void load().catch((e) => setError(e.message));
  }, [id]);
  return (
    <>
      <PageTitle
        title="Acompañar también es resolver"
        description="Registra incidencias operativas sin incluir documentos ni preferencias de estudiantes."
        action={
          can("incidents:write") && (
            <button
              className="button"
              onClick={() =>
                setForm({
                  shift: "MANANA",
                  type: "OPERACION",
                  severity: "BAJA",
                  description: "",
                })
              }
            >
              <Plus size={17} /> Registrar incidencia
            </button>
          )
        }
      />
      {error && <Notice>{error}</Notice>}
      <section className="panel">
        {rows.length ? (
          <div className="incident-list">
            {rows.map((r) => (
              <article key={r.id}>
                <AlertTriangle size={21} />
                <div>
                  <div className="button-row">
                    <strong>
                      {r.type} · {shiftLabel(r.shift)}
                    </strong>
                    <span className="badge">{r.severity}</span>
                    <span className="badge">{r.state}</span>
                  </div>
                  <p>{r.description}</p>
                  <small>{dateFormat(r.createdAt)}</small>
                </div>
                {can("incidents:write") && r.state !== "RESUELTO" && (
                  <button
                    className="button secondary"
                    onClick={async () => {
                      try {
                        await api(`/admin/elections/${id}/incidents/${r.id}`, {
                          method: "PATCH",
                          body: { state: "RESUELTO" },
                        });
                        await load();
                      } catch (e: any) {
                        setError(e.message);
                      }
                    }}
                  >
                    Resolver
                  </button>
                )}
              </article>
            ))}
          </div>
        ) : (
          <Empty>
            <ShieldCheck size={36} />
            <h2>Todo en orden por aquí</h2>
            <p>Aún no se han registrado incidencias en esta elección.</p>
          </Empty>
        )}
      </section>
      {form && (
        <Modal title="Registrar incidencia" onClose={() => setForm(undefined)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await api(`/admin/elections/${id}/incidents`, {
                  method: "POST",
                  body: form,
                });
                setForm(undefined);
                await load();
              } catch (e: any) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="two-columns">
              <Field label="Turno">
                <select
                  value={form.shift}
                  onChange={(e) => setForm({ ...form, shift: e.target.value })}
                >
                  <option value="MANANA">Mañana</option>
                  <option value="TARDE">Tarde</option>
                </select>
              </Field>
              <Field label="Severidad">
                <select
                  value={form.severity}
                  onChange={(e) =>
                    setForm({ ...form, severity: e.target.value })
                  }
                >
                  {["BAJA", "MEDIA", "ALTA"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Tipo">
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                {["CONECTIVIDAD", "EQUIPO", "PADRON", "OPERACION", "OTRO"].map(
                  (s) => (
                    <option key={s}>{s}</option>
                  ),
                )}
              </select>
            </Field>
            <Field
              label="Descripción"
              hint="Describe el problema sin nombres, documentos ni preferencias personales."
            >
              <textarea
                value={form.description}
                minLength={10}
                maxLength={1000}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                required
              />
            </Field>
            {error && <Notice>{error}</Notice>}
            <button className="button full" disabled={busy}>
              Registrar incidencia
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function Security() {
  const { user } = useAdmin();
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<any>();
  const [code, setCode] = useState("");
  const [enabled, setEnabled] = useState(user.mfaEnabled);
  const [error, setError] = useState("");
  return (
    <>
      <PageTitle
        title="Protege tu cuenta"
        description="Agrega un código temporal de tu aplicación de autenticación."
      />
      {error && <Notice>{error}</Notice>}
      <section className="panel security-panel">
        <div className="section-icon">
          <KeyRound />
        </div>
        <h2>Verificación en dos pasos</h2>
        {enabled ? (
          <Notice success>
            La autenticación TOTP está activada para tu cuenta.
          </Notice>
        ) : !setup ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                setSetup(
                  await api("/admin/mfa/setup", {
                    method: "POST",
                    body: { password },
                  }),
                );
                setPassword("");
              } catch (e: any) {
                setError(e.message);
              }
            }}
          >
            <p>
              Compatible con aplicaciones de autenticación TOTP. Confirma tu
              contraseña para comenzar.
            </p>
            <Field label="Tu contraseña actual">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            <button className="button">Configurar autenticación</button>
          </form>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api("/admin/mfa/confirm", {
                  method: "POST",
                  body: { code },
                });
                setSetup(undefined);
                setCode("");
                setEnabled(true);
              } catch (e: any) {
                setError(e.message);
              }
            }}
          >
            <p>
              Agrega una cuenta TOTP en tu aplicación e introduce esta clave
              manualmente. No la compartas.
            </p>
            <code className="report-hash">{setup.secret}</code>
            <Field label="Código de 6 dígitos">
              <input
                value={code}
                inputMode="numeric"
                pattern="[0-9]{6}"
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </Field>
            <button className="button">Verificar y activar</button>
          </form>
        )}
      </section>
    </>
  );
}
export function Accounts() {
  const { elections } = useAdmin();
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState<any>();
  const [error, setError] = useState("");
  const load = () => api("/admin/accounts").then(setRows);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <PageTitle
        title="Responsabilidades claras"
        description="Administra cuentas del personal y sus permisos."
        action={
          <button
            className="button"
            onClick={() =>
              setForm({
                name: "",
                email: "",
                password: "",
                role: "OBSERVADOR",
                electionScope: "*",
              })
            }
          >
            <Plus size={17} /> Nueva cuenta
          </button>
        }
      />
      {error && <Notice>{error}</Notice>}
      <section className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Personal</th>
              <th>Rol</th>
              <th>MFA</th>
              <th>Estado</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.name}</strong>
                  <small className="block">{r.email}</small>
                </td>
                <td>{r.grants.map((g: any) => g.role).join(", ")}</td>
                <td>{r.mfaEnabled ? "Activado" : "Pendiente"}</td>
                <td>{r.active ? "Activa" : "Desactivada"}</td>
                <td>
                  <button
                    className="button text"
                    onClick={async () => {
                      try {
                        await api(`/admin/accounts/${r.id}`, {
                          method: "PATCH",
                          body: { active: !r.active },
                        });
                        await load();
                      } catch (e: any) {
                        setError(e.message);
                      }
                    }}
                  >
                    {r.active ? "Desactivar" : "Activar"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {form && (
        <Modal
          title="Crear cuenta del personal"
          onClose={() => setForm(undefined)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api("/admin/accounts", { method: "POST", body: form });
                setForm(undefined);
                await load();
              } catch (e: any) {
                setError(e.message);
              }
            }}
          >
            {[
              ["name", "Nombre", "text"],
              ["email", "Correo", "email"],
              [
                "password",
                "Contraseña inicial (mínimo 12 caracteres)",
                "password",
              ],
            ].map(([key, label, type]) => (
              <Field label={label} key={key}>
                <input
                  type={type}
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  required
                  minLength={key === "password" ? 12 : 3}
                />
              </Field>
            ))}
            <Field label="Rol">
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                {[
                  "COMITE",
                  "OPERADOR",
                  "OBSERVADOR",
                  "MESA",
                  "ADMIN_TECNICO",
                ].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </Field>
            <Field label="Alcance">
              <select
                value={form.electionScope}
                onChange={(e) =>
                  setForm({ ...form, electionScope: e.target.value })
                }
              >
                <option value="*">
                  Todas las elecciones de la institución
                </option>
                {elections.map((e: any) => (
                  <option value={e.id} key={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </Field>
            {error && <Notice>{error}</Notice>}
            <button className="button full">Crear cuenta</button>
          </form>
        </Modal>
      )}
    </>
  );
}

function InstitutionSchedule() {
  const { election, id, refresh } = useAdmin();
  const [institution, setInstitution] = useState<any>();
  const [times, setTimes] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const local = (s: string | null) =>
    s
      ? new Date(new Date(s).getTime() - 5 * 3600000).toISOString().slice(0, 16)
      : "";
  useEffect(() => {
    api("/admin/institution")
      .then(setInstitution)
      .catch((e) => setError(e.message));
    setTimes(
      election.windows.map((w: any) => ({
        shift: w.shift,
        start: local(w.startsAt),
        end: local(w.endsAt),
      })),
    );
  }, [id]);
  return (
    <section className="panel settings-panel">
      <h2>Institución y horarios</h2>
      <p>
        Horas de Lima. La apertura es autorizada manualmente por el comité; los
        horarios limitan cuándo se puede votar.
      </p>
      {error && <Notice>{error}</Notice>}
      {message && <Notice success>{message}</Notice>}
      {institution && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await api("/admin/institution", {
                method: "PATCH",
                body: { name: institution.name, code: institution.code },
              });
              await refresh();
              setMessage("Institución guardada.");
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={election.state !== "BORRADOR" || busy}>
            <div className="two-columns">
              <Field label="Nombre de la institución">
                <input
                  value={institution.name}
                  onChange={(e) =>
                    setInstitution({ ...institution, name: e.target.value })
                  }
                  minLength={5}
                  required
                />
              </Field>
              <Field label="Código institucional">
                <input
                  value={institution.code}
                  onChange={(e) =>
                    setInstitution({ ...institution, code: e.target.value })
                  }
                  minLength={2}
                  required
                />
              </Field>
            </div>
            <button className="button secondary">Guardar institución</button>
          </fieldset>
        </form>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            for (const t of times)
              await api(`/admin/elections/${id}/windows/${t.shift}`, {
                method: "PATCH",
                body: {
                  startsAt: t.start
                    ? new Date(t.start + ":00-05:00").toISOString()
                    : null,
                  endsAt: t.end
                    ? new Date(t.end + ":00-05:00").toISOString()
                    : null,
                },
              });
            await refresh();
            setMessage("Horarios guardados.");
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={election.state !== "BORRADOR" || busy}>
          {times.map((t, i) => (
            <div key={t.shift} className="schedule-block">
              <h3>Turno {shiftLabel(t.shift).toLowerCase()}</h3>
              <div className="two-columns">
                <Field label="Inicio permitido (opcional)">
                  <input
                    type="datetime-local"
                    value={t.start}
                    onChange={(e) =>
                      setTimes(
                        times.map((x, j) =>
                          i === j ? { ...x, start: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="Fin permitido (opcional)">
                  <input
                    type="datetime-local"
                    value={t.end}
                    onChange={(e) =>
                      setTimes(
                        times.map((x, j) =>
                          i === j ? { ...x, end: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </Field>
              </div>
            </div>
          ))}
          <button className="button secondary">Guardar horarios</button>
        </fieldset>
      </form>
    </section>
  );
}
