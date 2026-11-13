import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Link, Navigate } from "react-router-dom";
import { Landing, VoterFlow } from "./Public";
import {
  AdminLogin,
  AdminShell,
  AdminSection,
  Dashboard,
  ElectionDay,
  Lists,
  Results,
  Settings,
  AuditPage,
  Incidents,
  Security,
  Accounts,
} from "./Admin";
import { Roster } from "./Roster";
import { SiteProvider } from "./Site";
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
    <SiteProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/votar" element={<VoterFlow />} />
          <Route
            path="/cabina/activar"
            element={<Navigate to="/votar" replace />}
          />
          <Route
            path="/activar-cuenta"
            element={<Navigate to="/admin" replace />}
          />
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin" element={<AdminShell />}>
            <Route index element={<Dashboard />} />
            <Route
              path="jornada"
              element={
                <AdminSection permission="windows:manage">
                  <ElectionDay />
                </AdminSection>
              }
            />
            <Route
              path="padron"
              element={
                <AdminSection permission="roster:read">
                  <Roster />
                </AdminSection>
              }
            />
            <Route
              path="mesa"
              element={<Navigate to="/admin/jornada" replace />}
            />
            <Route
              path="listas"
              element={
                <AdminSection permission="lists:read">
                  <Lists />
                </AdminSection>
              }
            />
            <Route
              path="resultados"
              element={
                <AdminSection permission="results:read" results>
                  <Results />
                </AdminSection>
              }
            />
            <Route
              path="configuracion"
              element={
                <AdminSection permission="elections:write">
                  <Settings />
                </AdminSection>
              }
            />
            <Route
              path="auditoria"
              element={
                <AdminSection permission="audit:read">
                  <AuditPage />
                </AdminSection>
              }
            />
            <Route
              path="incidencias"
              element={
                <AdminSection permission="incidents:read">
                  <Incidents />
                </AdminSection>
              }
            />
            <Route
              path="seguridad"
              element={
                <AdminSection>
                  <Security />
                </AdminSection>
              }
            />
            <Route
              path="cuentas"
              element={
                <AdminSection permission="accounts:manage">
                  <Accounts />
                </AdminSection>
              }
            />
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
    </SiteProvider>
  </ErrorBoundary>,
);
