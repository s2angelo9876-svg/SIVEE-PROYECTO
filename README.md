# SIVEE · Sistema de Votación Electrónica Escolar

Implementación del SDD del 5 de noviembre de 2026 para la **simulación con datos ficticios**. React + Vite + TypeScript + Tailwind, Express, PostgreSQL 17, Prisma y eventos SSE.

## Iniciar en tu computadora

Necesitas **Node.js 24**, **pnpm 11.25.0** y **Docker con Compose** (Linux, macOS o WSL2). Desde la raíz del repositorio:

```bash
npm install -g pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm setup:demo
pnpm dev
```

Abre el navegador en `http://localhost:5173`. La API utiliza el puerto 5000 y PostgreSQL el 5432. Usa `localhost` de forma consistente: el origen está protegido contra CSRF y `127.0.0.1` representa otro origen.

`setup:demo` genera claves aleatorias en `.env` solo si no existe, inicia PostgreSQL, genera Prisma, aplica migraciones y carga 50 estudiantes ficticios. Repetirlo conserva datos y credenciales. No uses `docker compose down -v`: eliminaría el volumen.

En este entorno cloud el código está en `/workspace/SIVEE-PROYECTO`. El repositorio remoto estaba vacío al comenzar; no presupongas que los archivos ya están publicados en GitHub.

## Accesos exclusivos de demostración

| Perfil                | Usuario                 | Contraseña       |
| --------------------- | ----------------------- | ---------------- |
| Comité                | `comite@sivee.demo`     | `DemoSivee2026!` |
| Observador            | `observador@sivee.demo` | `DemoSivee2026!` |
| Operador de padrón    | `operador@sivee.demo`   | `DemoSivee2026!` |
| Administrador técnico | `tecnico@sivee.demo`    | `DemoSivee2026!` |

| Elector | Documento ficticio | Código ficticio |
| ------- | ------------------ | --------------- |
| Mañana  | `00000001`         | `DEMOCODE-001`  |
| Tarde   | `00000026`         | `DEMOCODE-026`  |

Hay 25 electores por turno: documentos `00000001`–`00000050`, códigos `DEMOCODE-001`–`DEMOCODE-050`. No son datos reales ni credenciales para producción.

## Lo que puedes presentar

- Portada y sufragio responsive: documento + código, confirmación de identidad, cédula, revisión, emisión y constancia neutra.
- Padrón CSV con vista previa, errores, unicidad, confirmación y entrega de códigos individuales.
- Elecciones y listas configurables; 2–4 listas antes de preparar. Opciones blanco y nulo autorizables.
- Ventanas mañana/tarde: apertura, pausa, reanudación y cierre definitivo.
- Registro atómico, idempotente y concurrente de votos. La papeleta no contiene identidad ni fecha exacta de emisión.
- Panel privado de participación por SSE. Resultados bloqueados en servidor hasta cierre, conciliación y publicación.
- Acta PDF, agregados CSV, resumen JSON canónico con SHA-256, auditoría e incidencias.
- Roles por institución/elección, sesiones HttpOnly, CSRF, Argon2id, HMAC para documentos, MFA TOTP y cuentas del personal.
- Nueva simulación que archiva la anterior sin borrar papeletas.
- Respaldo cifrado y ensayo de restauración aislada.

Empieza por la [guía de presentación](docs/DEMO.md). Consulta [operación y recuperación](docs/RUNBOOK.md), [API](docs/API.md) y [alcance y trazabilidad](docs/IMPLEMENTACION.md).

## Validación

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build
pnpm test:e2e                 # requiere pnpm dev y Chromium
pnpm exec tsx scripts/accessibility-check.ts
pnpm backup:verify
pnpm exec tsx scripts/production-smoke.ts
```

Las pruebas de integración crean y eliminan una base `sivee_test_*`, usando credenciales de migración. No operan sobre el padrón de la demo. Las E2E recorren la demo, archivan su elección de prueba y dejan una nueva simulación abierta. `CHROMIUM_PATH` permite indicar un ejecutable Chromium; por defecto se usa `/usr/bin/chromium`.

`pnpm demo:scenario` ensaya 50 votos completos vía API: 38 válidos, 7 blancos y 5 nulos; archiva la simulación anterior. Úsalo solo con el padrón ficticio original. Espera un minuto entre ejecuciones para respetar los límites de autenticación.

## Ejecutar la compilación

```bash
pnpm build
WEB_ORIGIN=http://localhost:5000 pnpm start
```

La misma API sirve el frontend compilado. Para acceso desde otro equipo, configura el origen exacto y un proxy HTTPS institucional. El ejemplo Docker se documenta en `infra/README.md`.

## Alcance de la entrega

Esta entrega permite la simulación del SDD. No constituye una certificación de seguridad, autorización normativa ni despliegue oficial. Requiere validación del Comité, TLS y prueba en infraestructura final antes de usar datos reales. No implementa anonimato criptográfico verificable ni garantiza RPO=0 frente a pérdida física del servidor. El estado de cada requisito y los trabajos institucionales pendientes están en `docs/IMPLEMENTACION.md`.
