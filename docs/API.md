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
- `POST /admin/elections/:id/roster/file-inspect|import-preview|import-commit` — CSV, Excel o registro individual; contrato detallado abajo.
- `GET .../roster/template.xlsx` — plantilla Excel con DNI como texto; permiso `roster:write`.
- `GET .../roster/imports` — últimos 50 comprobantes de carga; sin códigos ni DNI; permiso `roster:write`.
- `POST .../roster/reissue` — `{studentId,reason}` o `{batchId,reason}` (exactamente uno). Motivo de 10–300 caracteres; `roster:write` y alcance institucional.
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

## Padrón

Los tres endpoints de inspección, vista previa y confirmación reciben exactamente una fuente: `{csv: texto}`, `{file:{name,base64}}` para `.xlsx`, o `{individual:{dni,apellidos_nombres,grado,seccion,turno,habilitado}}`. Todo se transporta en JSON. Límite JSON del prefijo roster: 8 MB; el Excel decodificado admite hasta 5 MB. La inspección devuelve hojas, encabezados, asociación sugerida, muestra y avisos; no guarda datos.

Opciones: `sheet`, `headerRow` (1–50, predeterminado 1), `mapping` con las seis claves del padrón y sus índices de columna desde cero, `skipExisting`, `updateProfiles` y `reason`. La actualización institucional requiere confirmación y motivo de al menos diez caracteres; conserva las instantáneas de participaciones anteriores.

El cliente envía un UUID `requestId` estable al confirmar. Un reintento con la misma identidad y contenido devuelve `alreadyImported:true`, `batchId`, cantidad y `credentials:[]`; un contenido diferente con el mismo UUID devuelve 409. Los clientes CSV antiguos sin UUID siguen aceptándose, pero no disponen de ese comprobante idempotente propio. La primera respuesta entrega los códigos en memoria; no se guardan en texto claro. La nueva interfaz conserva el UUID mientras reintenta y permite consultar el historial tras recargar.

La vista previa devuelve `total`, `valid`, `invalid`, `newCount`, `skipped`, errores por fila/campo, cambios institucionales, avisos y vigencia prevista. Cuenta filas únicas con error, no cantidad de mensajes. Muestra como máximo 100 filas; valida el lote completo. Una confirmación con cualquier error no guarda filas.

Reemisión: por lote únicamente en BORRADOR; individual también en PREPARADA/EN_CURSO/PAUSADA, para electores pendientes habilitados con turno no cerrado. Toma bloqueo exclusivo de elección, vuelve a comprobar condiciones, reemplaza hashes y revoca sesiones en una transacción. Los accesos y votos vuelven a comprobar la credencial/sesión tras adquirir su bloqueo para evitar carreras con la reemisión. Los motivos se auditan sin incluir códigos ni papeletas.
