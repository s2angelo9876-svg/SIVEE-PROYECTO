import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { Landing, VoterFlow } from "./Public";
import {
  AdminLogin,
  AdminShell,
  Dashboard,
  ElectionDay,
  Roster,
  Lists,
  Results,
  Settings,
  AuditPage,
  Incidents,
  Security,
  Accounts,
} from "./Admin";
import "./styles.css";
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="error-page">
        <h1>No pudimos cargar esta pantalla.</h1>
        <p>
          Actualiza para volver a conectarte. Los votos confirmados se conservan
          en el servidor.
        </p>
        <button onClick={() => location.reload()}>Volver a intentar</button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/votar" element={<VoterFlow />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin" element={<AdminShell />}>
          <Route index element={<Dashboard />} />
          <Route path="jornada" element={<ElectionDay />} />
          <Route path="padron" element={<Roster />} />
          <Route path="listas" element={<Lists />} />
          <Route path="resultados" element={<Results />} />
          <Route path="configuracion" element={<Settings />} />
          <Route path="auditoria" element={<AuditPage />} />
          <Route path="incidencias" element={<Incidents />} />
          <Route path="seguridad" element={<Security />} />
          <Route path="cuentas" element={<Accounts />} />
        </Route>
        <Route
          path="*"
          element={
            <main className="error-page">
              <h1>Página no encontrada</h1>
              <Link to="/">Volver al inicio</Link>
            </main>
          }
        />
      </Routes>
    </BrowserRouter>
  </ErrorBoundary>,
);
