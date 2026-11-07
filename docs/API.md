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

## Modalidad presencial (`authMode: DESK`)

Las nuevas elecciones usan DESK; producción exige esta modalidad. CODE se conserva solo para simulaciones anteriores. `POST /voter/sessions` no autentica elecciones DESK u oficiales. El usuario no recibe códigos individuales.

- `GET /site`: modalidad, nombre institucional y URL del escudo. `GET /branding/crest`: PNG/JPEG. `POST /admin/institution/crest`: `{base64}`, requiere `elections:write`, límite 600 KB / 2048×2048.
- `/admin/elections/:id/roster/school` exige `roster:write` y alcance institucional. `GET /` devuelve registros con documentos enmascarados, totales y últimas 50 cargas; `GET /rows/:rowId` permite al operador revisar el documento completo; `GET /template.xlsx` genera una plantilla.
- `POST .../school/preview|import`: `{requestId:UUID, file:{name,base64}}`, `{requestId,csv}` o `{requestId,individual:{studentCode,document,displayName,grade,section,shift,enrollment}}`. Una sola fuente. La importación crea un borrador cifrado e idempotente, todavía sin electores habilitados.
- `PATCH .../school/rows/:rowId`: campos de registro, `version`, `enrollmentApproved`, `excluded`, `reason` (10–300 caracteres). Rechaza versiones antiguas y registros ya confirmados.
- `POST .../school/assign-shift`: `{groups:[{grade,section}],shift,reason}`. `POST .../school/publish`: `{reason,updateProfiles?}`. Se bloquea mientras existan documentos, duplicados, matrícula o turno pendientes. Solo en BORRADOR.
- `GET /admin/elections/:id/desk`: cabinas y verificaciones pendientes de la mesa; el comité ve todas. `POST .../desk/booths`: `{name,assignedAdminId}`. `POST .../booths/:boothId/pairing`: `{reason}`, devuelve enlace privado de un uso y 10 minutos. `PATCH .../booths/:boothId`: `{active,assignedAdminId,reason}`, revoca navegador y autorizaciones. Gestión requiere `desk:manage`.
- `POST .../desk/requests/:requestId/approve`: `{identityVerified:true,document,reason}`; el DNI cotejado debe coincidir. `POST .../cancel`: `{identityVerified:false,reason}`. Exigen `desk:verify` y cabina asignada o permiso de gestión.
- `POST /booth/pair`: `{id,token}` del fragmento del enlace; instala cookie HttpOnly `sivee_booth`. `GET /booth/status` exige esa cookie y devuelve CSRF y estado, sin identidad. `POST /booth/requests`: `{dni}`; `POST /booth/claim|cancel`: `{requestId}`. Estas mutaciones requieren CSRF de cabina y origen exacto.
- La sesión emitida por `claim` se usa en `/voter/me|ballot|votes|status|logout` con **ambas cookies** y CSRF del votante. Vence como máximo al vencer la autorización, cinco minutos desde la aprobación. La actividad no renueva esa autorización. `logout` cancela autorizaciones no consumidas. `votes` mantiene la transacción y la unicidad de participación.
- En producción, el primer login sin MFA devuelve `mfaSetupRequired:true` y una sesión `MFA_SETUP`: solo permite `/me`, `/mfa/setup`, `/mfa/confirm`, `/auth/logout`. Confirmar TOTP habilita el resto del panel; los siguientes logins requieren OTP.

No se registran documentos, secretos de activación ni preferencias en auditoría. Las papeletas no incluyen estudiante, autorización ni cabina. Las políticas de red privada, supervisión de equipos y verificación presencial se detallan en [Producción](PRODUCCION.md).
