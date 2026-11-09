import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { DniIdentity } from "./DniIdentity";
import { useSite } from "./Site";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  ShieldCheck,
  LockKeyhole,
  GraduationCap,
  Users,
  Vote,
  Eye,
  EyeOff,
  HelpCircle,
  Clock,
  CheckCircle2,
  X,
  FileCheck2,
  Leaf,
} from "lucide-react";
import {
  api,
  tokens,
  ApiError,
  Badge,
  Field,
  Notice,
  Loading,
  SymbolIcon,
  Modal,
  shiftLabel,
} from "./lib";
export function Brand() {
  const site = useSite();
  return (
    <Link to="/" className="brand" aria-label="SIVEE, inicio">
      {site.crestUrl ? (
        <img
          className="school-crest"
          src={site.crestUrl}
          alt={"Escudo de " + site.institution}
        />
      ) : (
        <span className="brand-mark">
          <Vote size={25} />
        </span>
      )}
      <span>
        SIVEE<small>Tu voz cuenta.</small>
      </span>
    </Link>
  );
}
export function PublicHeader() {
  const site = useSite();
  return (
    <header className="public-header">
      <Brand />
      <div className="header-right">
        <span className="demo-pill">
          {site.mode === "DEMO"
            ? "ENTORNO DE SIMULACIÓN"
            : "ELECCIONES ESCOLARES"}
        </span>
        <Link to="/admin/login" className="staff-link">
          <LockKeyhole size={15} /> Acceso del comité <ArrowRight size={15} />
        </Link>
      </div>
    </header>
  );
}
export function PublicFooter() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <footer className="public-footer">
        <span>Comunidad educativa · Municipio Escolar 2026</span>
        <div>
          <button onClick={() => setOpen(true)}>
            Privacidad y accesibilidad
          </button>
          <span>Hecho para participar.</span>
        </div>
      </footer>
      {open && (
        <Modal
          title="Participa con tranquilidad"
          onClose={() => setOpen(false)}
        >
          <p>
            La identidad permite comprobar tu habilitación; la papeleta se
            guarda por separado. El sistema no entrega una constancia de tu
            preferencia.
          </p>
          <p>
            Puedes navegar con Tab, seleccionar opciones con el teclado y
            ampliar el texto del navegador. Solicita asistencia a la mesa si la
            necesitas.
          </p>
          <button className="button" onClick={() => setOpen(false)}>
            Entendido
          </button>
        </Modal>
      )}
    </>
  );
}
export function Landing() {
  const [e, setElection] = useState<any>(undefined);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/elections/active/public")
      .then(setElection)
      .catch((e) => setError(e.message));
  }, []);
  const open = e?.state === "EN_CURSO";
  return (
    <div className="public-page">
      <PublicHeader />
      <main className="landing">
        <section className="hero-copy">
          <div className="hero-kicker">
            <span className="mini-line" /> ELECCIONES ESCOLARES 2026
          </div>
          <h1>
            Tu escuela.
            <br />
            Tu voz.
            <br />
            <span>Tu decisión.</span>
          </h1>
          <p className="hero-description">
            Las grandes ideas empiezan contigo. Elige a quienes representarán a
            tu comunidad y construyamos, juntos, una mejor escuela.
          </p>
          <div className="hero-actions">
            <Link
              className={"button large " + (!open ? "secondary" : "")}
              to="/votar"
            >
              <Vote size={20} />
              {open ? "Iniciar mi votación" : "Consultar votación"}
              <ArrowRight size={19} />
            </Link>
            <span>
              <ShieldCheck size={16} /> Personal, libre y confidencial
            </span>
          </div>
          <div className="hero-status">
            {error ? (
              <Notice>{error}</Notice>
            ) : e === undefined ? (
              <Loading />
            ) : e ? (
              <>
                <Badge state={e.state} />
                <span>{e.scope}</span>
              </>
            ) : (
              <span>El comité está preparando la elección.</span>
            )}
          </div>
        </section>
        <section
          className="hero-visual"
          aria-label="Ilustración de una cédula entrando en una urna"
        >
          <div className="visual-grid" />
          <div className="visual-top">
            <span className="tiny-label">EL FUTURO LO ELEGIMOS JUNTOS</span>
            <Leaf size={23} />
          </div>
          <div className="ballot-paper">
            <span className="paper-mark">
              <Vote size={22} /> SIVEE
            </span>
            <span className="paper-line" />
            <div className="paper-option">
              <span />
              <i />
            </div>
            <div className="paper-option checked">
              <Check size={18} />
              <i />
            </div>
            <div className="paper-option">
              <span />
              <i />
            </div>
          </div>
          <div className="ballot-box">
            <div className="box-slot" />
            <div className="box-face">
              <Vote size={52} strokeWidth={1.2} />
              <span>
                MI VOZ
                <br />
                <strong>CUENTA</strong>
              </span>
            </div>
          </div>
          <span className="visual-spark s1">✳</span>
          <span className="visual-spark s2">+</span>
          <div className="floating-note">
            <span>
              <Check size={18} />
            </span>
            <div>
              Una elección.<strong>Muchas posibilidades.</strong>
            </div>
          </div>
          <div className="visual-caption">
            <span>01 — PARTICIPAR ES CONSTRUIR</span>
            <span>↗</span>
          </div>
        </section>
        <section className="steps-intro">
          <div>
            <p className="eyebrow">ASÍ DE SENCILLO</p>
            <h2>Tu participación, en tres pasos.</h2>
          </div>
          <p>
            {e?.authMode === "CODE"
              ? "Ten a mano tu documento y código de simulación."
              : "Ten a mano tu DNI. Puedes votar directamente cuando tu turno esté abierto."}
          </p>
        </section>
        <section className="landing-steps">
          {[
            {
              n: "01",
              icon: GraduationCap,
              title: "Identifícate",
              desc:
                e?.authMode === "CODE"
                  ? "Ingresa tu documento y el código de simulación."
                  : "Ingresa tu propio DNI para abrir la cédula. No necesitas autorización de mesa.",
            },
            {
              n: "02",
              icon: Users,
              title: "Elige con libertad",
              desc: "Conoce las listas, marca una opción y revisa tu elección.",
            },
            {
              n: "03",
              icon: FileCheck2,
              title: "Confirma tu voto",
              desc: "Registra tu participación. Cada estudiante tiene una sola voz.",
            },
          ].map((s) => (
            <article key={s.n}>
              <div className="step-top">
                <s.icon size={25} strokeWidth={1.5} />
                <span>{s.n}</span>
              </div>
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
            </article>
          ))}
        </section>
        <div className="school-note">
          <GraduationCap size={20} />
          <span>{e?.institution || "SIVEE · Comunidad educativa"}</span>
          {e?.mode === "DEMO" && <span>Datos ficticios · Demostración</span>}
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
export function VoterFlow() {
  const navigate = useNavigate();
  const [e, setElection] = useState<any>();
  const [step, setStep] = useState(0);
  const [identity, setIdentity] = useState<any>();
  const [ballot, setBallot] = useState<any>();
  const [choice, setChoice] = useState<string | null>(null);
  const [dni, setDni] = useState("");
  const [code, setCode] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lastAction = useRef(Date.now());
  const authorizationEnds = useRef<number | null>(null);
  const idem = useRef("");
  const [remaining, setRemaining] = useState(300);
  useEffect(() => {
    api("/elections/active/public")
      .then(setElection)
      .catch((e) => setError(e.message));
  }, []);
  async function clearSession() {
    try {
      await api("/voter/logout", { method: "POST", kind: "voter" });
    } catch {
      /* La sesión ya puede haber vencido. */
    }
    tokens.voter = "";
    setIdentity(undefined);
    setBallot(undefined);
    setChoice(null);
    setCode("");
    setDni("");
  }
  useEffect(() => {
    if (!identity || step === 4) return;
    const activity = () => {
      lastAction.current = Date.now();
    };
    window.addEventListener("pointerdown", activity);
    window.addEventListener("keydown", activity);
    const timer = setInterval(() => {
      const left =
        authorizationEnds.current !== null
          ? Math.max(
              0,
              Math.ceil((authorizationEnds.current - Date.now()) / 1000),
            )
          : 300 - Math.floor((Date.now() - lastAction.current) / 1000);
      setRemaining(left);
      if (left <= 0) {
        void clearSession();
        setStep(0);
        setError("La sesión terminó. Vuelve a ingresar tu DNI para continuar.");
      }
    }, 1000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
    };
  }, [identity, step]);
  useEffect(() => {
    if (step === 4) {
      const t = setTimeout(() => navigate("/", { replace: true }), 12000);
      return () => clearTimeout(t);
    }
  }, [step, navigate]);
  useEffect(() => {
    const pop = () => {
      void clearSession();
      setStep(0);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function finish() {
    setIdentity(undefined);
    setBallot(undefined);
    setChoice(null);
    setDni("");
    setCode("");
    setStep(4);
    void clearSession();
  }
  async function login(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      const data = await api("/voter/sessions", {
        method: "POST",
        kind: "voter",
        body: { electionId: e.id, dni, accessCode: code },
      });
      tokens.voter = data.csrfToken;
      authorizationEnds.current = null;
      setDni("");
      setCode("");
      lastAction.current = Date.now();
      if (data.alreadyRecorded) {
        await finish();
        return;
      }
      setIdentity(data.student);
      setStep(1);
    });
  }
  async function submit() {
    await run(async () => {
      if (!idem.current) idem.current = crypto.randomUUID();
      const body =
        choice === "BLANCO" || choice === "NULO"
          ? { electionId: e.id, kind: choice }
          : { electionId: e.id, kind: "VALIDO", listId: choice };
      try {
        await api("/voter/votes", {
          method: "POST",
          kind: "voter",
          body,
          headers: { "Idempotency-Key": idem.current },
        });
        await finish();
      } catch (err) {
        if (err instanceof ApiError && err.status === 0) {
          setError("Comprobando el estado de tu participación…");
          const status = await api("/voter/status", { kind: "voter" });
          if (status.status === "RECORDED") {
            setError("");
            await finish();
            return;
          }
          throw new Error(
            "Tu participación sigue pendiente. Cuando recuperes la conexión, puedes confirmar otra vez.",
          );
        }
        throw err;
      }
    });
  }
  const selected = ballot?.lists.find((l: any) => l.id === choice);
  const names = [
    "Identificación",
    "Verificación",
    "Tu voto",
    "Confirmación",
    "Finalizado",
  ];
  return (
    <div className="public-page">
      <PublicHeader />
      <main className="vote-main">
        <Link to="/" className="back-link" onClick={() => void clearSession()}>
          <ArrowLeft size={16} /> Volver al inicio
        </Link>
        <ol className="progress-steps" aria-label="Progreso de votación">
          {names.map((name, i) => (
            <li
              key={name}
              aria-current={i === step ? "step" : undefined}
              className={i <= step ? "done" : ""}
            >
              <span>{i < step ? <Check size={14} /> : i + 1}</span>
              <b>{name}</b>
            </li>
          ))}
        </ol>
        {identity && step < 4 && (
          <div className="session-clock">
            <Clock size={14} /> Sesión personal · {Math.floor(remaining / 60)}:
            {String(remaining % 60).padStart(2, "0")}
          </div>
        )}
        {error && <Notice>{error}</Notice>}
        {step === 0 && !e && (
          <Notice>
            {e === undefined
              ? "Cargando la jornada electoral…"
              : "Aún no hay una elección disponible. Consulta al comité."}
          </Notice>
        )}
        {step === 0 && e?.authMode === "DESK" && (
          <DniIdentity
            electionId={e.id}
            onAuthenticated={(data) => {
              tokens.voter = data.csrfToken;
              authorizationEnds.current =
                Date.now() + data.expiresInSeconds * 1000;
              lastAction.current =
                Date.now() - (300 - data.expiresInSeconds) * 1000;
              setRemaining(data.expiresInSeconds);
              setIdentity(data.student);
              setStep(1);
              setError("");
            }}
          />
        )}
        {step === 0 && e && e.authMode !== "DESK" && (
          <div className="login-grid">
            <section className="vote-intro">
              <p className="eyebrow">TU PARTICIPACIÓN EMPIEZA AQUÍ</p>
              <h1>
                Hola.
                <br />
                Hagamos que
                <br />
                <em>tu voz cuente.</em>
              </h1>
              <p>
                Verificaremos que estás habilitado para esta elección. Tu
                documento y código son personales.
              </p>
              <div className="privacy-note">
                <ShieldCheck size={24} />
                <p>Tu identidad y tu papeleta se guardan por separado.</p>
              </div>
            </section>
            <section className="panel login-panel">
              <div className="section-icon">
                <GraduationCap />
              </div>
              <h2>Identifícate para votar</h2>
              <p>Ingresa los datos entregados por tu mesa.</p>
              {e === undefined && !error ? (
                <Loading />
              ) : !e ? (
                <Notice>El comité aún no ha configurado una elección.</Notice>
              ) : (
                <form onSubmit={login}>
                  <Field
                    label="Documento de identidad"
                    hint="Usa los 8 dígitos de tu documento de prueba."
                  >
                    <input
                      aria-label="Documento de identidad"
                      inputMode="numeric"
                      pattern="[0-9]{8}"
                      maxLength={8}
                      value={dni}
                      onChange={(x) =>
                        setDni(x.target.value.replace(/\D/g, ""))
                      }
                      placeholder="00000000"
                      autoComplete="off"
                      required
                    />
                  </Field>
                  <Field label="Código individual de acceso">
                    <div className="password-field">
                      <input
                        type={visible ? "text" : "password"}
                        value={code}
                        onChange={(x) => setCode(x.target.value)}
                        placeholder="Tu código personal"
                        autoComplete="off"
                        required
                        minLength={6}
                      />
                      <button
                        type="button"
                        aria-label={
                          visible ? "Ocultar código" : "Mostrar código"
                        }
                        onClick={() => setVisible(!visible)}
                      >
                        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </Field>
                  <button
                    className="button full"
                    disabled={busy || dni.length !== 8 || !code}
                  >
                    {busy ? "Verificando…" : "Verificar mi identidad"}
                    <ArrowRight size={18} />
                  </button>
                  <div className="help-note">
                    <HelpCircle size={16} /> Si necesitas ayuda, acércate a tu
                    mesa.
                  </div>
                </form>
              )}
              {e?.mode === "DEMO" && (
                <div className="demo-help">
                  Prueba de mañana: <b>00000001</b> · código <b>DEMOCODE-001</b>
                  <br />
                  El comité debe abrir el turno antes de ingresar.
                </div>
              )}
            </section>
          </div>
        )}
        {step === 1 && identity && (
          <section className="panel centered-panel">
            <div className="section-icon">
              <GraduationCap size={28} />
            </div>
            <p className="eyebrow">VERIFICACIÓN DE IDENTIDAD</p>
            <h1>¿Estos son tus datos?</h1>
            <p>Revisa tu información antes de continuar.</p>
            <div className="identity-card">
              <div className="avatar">{identity.displayName[0]}</div>
              <h2>{identity.displayName}</h2>
              <div className="identity-meta">
                <span>
                  Grado <strong>{identity.grade}°</strong>
                </span>
                <span>
                  Sección <strong>{identity.section}</strong>
                </span>
                <span>
                  Turno <strong>{shiftLabel(identity.shift)}</strong>
                </span>
              </div>
            </div>
            <button
              className="button full"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setBallot(await api("/voter/ballot", { kind: "voter" }));
                  setStep(2);
                })
              }
            >
              Sí, soy yo <ArrowRight size={18} />
            </button>
            <button
              className="button text full"
              onClick={() => {
                void clearSession();
                setStep(0);
                setError("Solicita ayuda a tu mesa antes de continuar.");
              }}
            >
              Los datos no corresponden / Necesito ayuda
            </button>
          </section>
        )}
        {step === 2 && ballot && (
          <section className="ballot-section">
            <div className="center-heading">
              <p className="eyebrow">CÉDULA DE VOTACIÓN</p>
              <h1>Una opción. Tu decisión.</h1>
              <p>Conoce las propuestas y selecciona a tus representantes.</p>
            </div>
            <fieldset className="ballot-fieldset">
              <legend className="sr-only">
                Selecciona exactamente una opción
              </legend>
              <div className="ballot-lists">
                {ballot.lists.map((l: any) => (
                  <label
                    className={
                      "ballot-card " + (choice === l.id ? "selected" : "")
                    }
                    key={l.id}
                  >
                    <div className="ballot-card-top">
                      <span className="list-number">
                        LISTA {String(l.number).padStart(2, "0")}
                      </span>
                      <input
                        type="radio"
                        name="vote"
                        value={l.id}
                        checked={choice === l.id}
                        onChange={() => {
                          setChoice(l.id);
                          idem.current = "";
                        }}
                        aria-label={`Lista ${l.number}: ${l.name}`}
                      />
                    </div>
                    <div className="list-symbol">
                      <SymbolIcon name={l.symbol} size={42} />
                    </div>
                    <h2>{l.name}</h2>
                    <p>{l.proposal}</p>
                    <div className="candidate">
                      <small>CANDIDATURA A LA ALCALDÍA</small>
                      <strong>{l.candidates[0]?.name}</strong>
                    </div>
                  </label>
                ))}
              </div>
              <div className="other-votes">
                {[
                  {
                    kind: "BLANCO",
                    enabled: ballot.blankAllowed,
                    title: "Voto en blanco",
                    description: "No selecciono ninguna lista.",
                  },
                  {
                    kind: "NULO",
                    enabled: ballot.nullAllowed,
                    title: "Voto nulo",
                    description:
                      "Elijo la opción nula autorizada para esta elección.",
                  },
                ]
                  .filter((x) => x.enabled)
                  .map((x) => (
                    <label
                      key={x.kind}
                      className={
                        "other-card " + (choice === x.kind ? "selected" : "")
                      }
                    >
                      <input
                        type="radio"
                        name="vote"
                        checked={choice === x.kind}
                        onChange={() => {
                          setChoice(x.kind);
                          idem.current = "";
                        }}
                      />
                      <span>
                        <strong>{x.title}</strong>
                        <small>{x.description}</small>
                      </span>
                    </label>
                  ))}
              </div>
            </fieldset>
            <div className="ballot-actions">
              <button
                className="button text"
                onClick={() => {
                  void clearSession();
                  setStep(0);
                }}
              >
                Cancelar y salir
              </button>
              <button
                className="button"
                disabled={!choice}
                onClick={() => setStep(3)}
              >
                Revisar mi elección <ArrowRight size={18} />
              </button>
            </div>
          </section>
        )}
        {step === 3 && (
          <section className="panel centered-panel">
            <p className="eyebrow">ÚLTIMO PASO</p>
            <h1>Revisa tu elección</h1>
            <p>Esta es la opción que seleccionaste.</p>
            <div className="review-choice">
              <div className="list-symbol">
                {selected ? (
                  <SymbolIcon name={selected.symbol} size={36} />
                ) : choice === "BLANCO" ? (
                  <Vote size={36} />
                ) : (
                  <X size={36} />
                )}
              </div>
              {selected && (
                <span className="eyebrow">
                  LISTA {String(selected.number).padStart(2, "0")}
                </span>
              )}
              <h2>
                {selected?.name ||
                  (choice === "BLANCO" ? "Voto en blanco" : "Voto nulo")}
              </h2>
            </div>
            <div className="privacy-note">
              <LockKeyhole size={20} />
              <p>Después de confirmar, no podrás cambiar tu voto.</p>
            </div>
            <button
              className="button full"
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy ? "Registrando tu participación…" : "Confirmar mi voto"}
              <CheckCheck size={19} />
            </button>
            <button
              className="button text full"
              disabled={busy}
              onClick={() => setStep(2)}
            >
              <ArrowLeft size={16} /> Modificar mi elección
            </button>
          </section>
        )}
        {step === 4 && (
          <section className="panel centered-panel receipt">
            <div className="success-seal">
              <CheckCircle2 size={54} strokeWidth={1.5} />
            </div>
            <p className="eyebrow">PARTICIPACIÓN REGISTRADA</p>
            <h1>
              Gracias por
              <br />
              hacerte escuchar.
            </h1>
            <p>
              Tu participación fue registrada correctamente.
              <br />
              Ya puedes dar paso al siguiente estudiante.
            </p>
            <div className="privacy-note">
              <ShieldCheck size={21} />
              <p>Tu constancia no muestra tu preferencia.</p>
            </div>
            <Link to="/" className="button full" replace>
              Finalizar <ArrowRight size={18} />
            </Link>
            <small>Volveremos al inicio automáticamente.</small>
          </section>
        )}
      </main>
      <PublicFooter />
    </div>
  );
}
