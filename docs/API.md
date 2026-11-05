# Contrato HTTP

Base `/api/v1`. Respuestas `{data: ...}`; errores `{error:{code,message,requestId}}`. API privada con `Cache-Control: no-store, private`. En métodos mutantes: JSON, `Origin` igual a `WEB_ORIGIN` y `X-CSRF-Token` de la sesión. Autenticación inicial también exige origen autorizado. Cookies `sivee_voter` y `sivee_admin` separadas, HttpOnly y SameSite=Strict; Secure configurable.

## Público y elector

- `GET /health/live`, `/health/ready` — salud sin secretos.
- `GET /elections/active/public` — configuración pública mínima de la elección más reciente no archivada.
- `POST /voter/sessions` — `{electionId,dni,accessCode}`; devuelve identidad mínima y csrfToken.
- `GET /voter/me`, `/voter/status`, `/voter/ballot` — solo sesión propia.
- `POST /voter/votes` — `{electionId,kind,listId?}`, encabezado UUID `Idempotency-Key`. Kind: VALIDO, BLANCO, NULO. VALIDO exige lista de esa elección. Devuelve RECORDED (201) o ALREADY_RECORDED (200), sin preferencia.
- `POST /voter/logout` — revoca y elimina cookie.

La sesión consumida solo permite reconocer participación/reintentos hasta el logout o vencimiento; no obtiene otra cédula. La UI limpia inmediatamente identidad y selección, cierra sesión y vuelve al inicio.

## Personal

- `POST /admin/auth/login`, `/admin/auth/logout`; `GET /admin/me`.
- `GET/POST /admin/elections`; `GET/PATCH /admin/elections/:id`.
- `POST /admin/elections/:id/prepare`.
- `POST /admin/elections/:id/windows/:shift/open|pause|close` — `{reason}`.
- `POST /admin/elections/:id/close-request|publish-request` — `{reason}`; correspondientes `close-approve|publish-approve` — `{approvalId}`.
- `POST /admin/elections/:id/reconcile` — devuelve integridad, no preferencias antes de publicación.
- `POST /admin/elections/:id/roster/import-preview|import-commit` — `{csv}`. Se transporta el texto CSV como JSON; no multipart. Los códigos de la importación solo se entregan una vez.
- `GET /admin/elections/:id/roster/summary`; `POST .../roster/search` — `{dni}`; `PATCH .../roster/:studentId` — `{enabled}`.
- `GET/POST .../lists`; `PATCH .../lists/:listId`.
- `GET .../turnout`, `.../events` — SSE privado `turnout.updated`, ID monotónico por versión electoral/participación. Siempre contiene únicamente participación; el cliente consulta resultados por otra ruta autorizada.
- `GET .../results`, `.../reports/final.pdf`, `.../reports/final.csv` — publicación requerida.
- `GET .../audit`, `.../audit/export`; `GET/POST .../incidents`; `PATCH .../incidents/:incidentId` — `{state}`.
- `POST /admin/demo/:id/reset` — `{confirmation:"NUEVA SIMULACION"}`; archiva y crea nueva elección.
- `POST /admin/mfa/setup` — `{password}`; `POST /admin/mfa/confirm` — `{code}`.
- `GET/POST /admin/accounts`; `PATCH /admin/accounts/:accountId` — `{active}`; solo ADMIN_TECNICO.

## Integridad

Orden de bloqueo: elección → ventana → participación. Emisión usa FOR SHARE, cierre FOR UPDATE; la actualización PENDIENTE → VOTO_EMITIDO y la inserción de papeleta pertenecen a la misma transacción. El rol API no puede actualizar, borrar ni truncar papeletas. No hay columnas de identidad ni timestamp exacto en la urna.

Los endpoints de preferencias usan una guarda de PUBLICADA y verifican el hash del acta. Ningún desglose de preferencias por turno/grupo pequeño se exporta. Los permisos se comprueban en servidor por institución y alcance de elección.

Configuración adicional: `GET/PATCH /admin/institution` y `PATCH /admin/elections/:id/windows/:shift` con `{startsAt,endsAt}` (ISO UTC o null), solo en BORRADOR.
