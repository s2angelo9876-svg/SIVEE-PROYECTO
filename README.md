# SIVEE · Sistema de Votación Electrónica Escolar

Implementación del SDD del 5 de noviembre de 2026 para la **simulación con datos ficticios**. React + Vite + TypeScript + Tailwind, Express, PostgreSQL 17, Prisma y eventos SSE.

## Iniciar en tu computadora

Necesitas **Node.js 24 con npm** y **Docker con Compose**. En Windows puedes usar **PowerShell directamente**, con Docker Desktop abierto y su motor de contenedores Linux listo. No necesitas ejecutar el proyecto dentro de WSL.

Desde la raíz del repositorio:

```powershell
npm install
npm run dev
```

Abre el navegador en `http://localhost:5173`. La API utiliza el puerto 5000 y PostgreSQL el 5432. Usa `localhost` de forma consistente: el origen está protegido contra CSRF y `127.0.0.1` representa otro origen.

`npm run dev` ejecuta automáticamente `setup:demo` antes de iniciar la web y la API. Genera claves aleatorias en `.env` solo si no existe, inicia PostgreSQL, genera Prisma, aplica migraciones y carga 50 estudiantes ficticios. Repetirlo conserva datos y credenciales. No uses `docker compose down -v`: eliminaría el volumen.

Puedes preparar solo la base con `npm run setup:demo`. Si ya tienes PostgreSQL preparado, `npm run dev:services` inicia únicamente API y web. Para instalaciones reproducibles, usa `npm ci` en lugar de `npm install`.

### Actualizar una instalación anterior

Cierra el servidor anterior, abre Docker Desktop y ejecuta:

```powershell
git pull origin main
npm install
npm run dev
```

Si instalaste dependencias con pnpm y npm informa conflictos en `node_modules`, cierra los procesos de Node de este proyecto, elimina **solo esa carpeta generada** con `Remove-Item -Recurse -Force node_modules` y repite `npm install`. Conserva `.env` y los datos de Docker.

### Si Docker no conecta en Windows

El proyecto usa la conexión seleccionada por Docker Desktop; no fija un socket de Linux. Comprueba desde la misma terminal:

```powershell
docker info
docker context ls
docker compose version
```

Si `docker info` falla, espera a que Docker Desktop indique que el motor está iniciado. Debe usar contenedores Linux. Si configuraste antes `DOCKER_HOST` o `DOCKER_CONTEXT` para apuntar a un socket antiguo, puedes quitarlas **solo de la terminal actual**:

```powershell
Remove-Item Env:DOCKER_HOST -ErrorAction SilentlyContinue
Remove-Item Env:DOCKER_CONTEXT -ErrorAction SilentlyContinue
```

Revisa `docker context ls`; si aparece `desktop-linux` y corresponde a tu Docker Desktop, selecciónalo con `docker context use desktop-linux`. Una vez que `docker info` funcione, repite `npm run dev`. Si Compose informa que el puerto 5432 está ocupado, detén la otra instancia de PostgreSQL que lo esté usando antes de reintentar.

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
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
npx playwright install chromium
npm run test:e2e                 # requiere npm run dev y Chromium
npx tsx scripts/accessibility-check.ts
npm run backup:verify
npx tsx scripts/production-smoke.ts
```

Las pruebas de integración crean y eliminan una base `sivee_test_*`, usando credenciales de migración. No operan sobre el padrón de la demo. Las E2E recorren la demo, archivan su elección de prueba y dejan una nueva simulación abierta. Por defecto usan Chromium instalado por Playwright; `CHROMIUM_PATH` permite indicar otro ejecutable.

`npm run demo:scenario` ensaya 50 votos completos vía API: 38 válidos, 7 blancos y 5 nulos; archiva la simulación anterior. Úsalo solo con el padrón ficticio original. Espera un minuto entre ejecuciones para respetar los límites de autenticación.

## Ejecutar la compilación

En PowerShell:

```powershell
npm run build
$env:WEB_ORIGIN = "http://localhost:5000"
npm start
```

En Linux/macOS: `npm run build` y `WEB_ORIGIN=http://localhost:5000 npm start`. La misma API sirve el frontend compilado. Al volver a desarrollo en la misma PowerShell, ejecuta `Remove-Item Env:WEB_ORIGIN` para recuperar el origen de `.env`. Para acceso desde otro equipo, configura el origen exacto y un proxy HTTPS institucional. El ejemplo Docker se documenta en `infra/README.md`.

## Alcance de la entrega

Esta entrega permite la simulación del SDD. No constituye una certificación de seguridad, autorización normativa ni despliegue oficial. Requiere validación del Comité, TLS y prueba en infraestructura final antes de usar datos reales. No implementa anonimato criptográfico verificable ni garantiza RPO=0 frente a pérdida física del servidor. El estado de cada requisito y los trabajos institucionales pendientes están en `docs/IMPLEMENTACION.md`.
