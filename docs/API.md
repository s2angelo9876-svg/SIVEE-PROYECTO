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
- `POST /admin/elections/:id/close-request|publish-request` — `{reason}`; correspondientes `close-approve|publish-approve` — `{approvalId}`. El cierre global permite temporalmente la aprobación de su solicitante si tiene los permisos; una solicitud pendiente sigue siendo necesaria. La publicación oficial también permite temporalmente aprobar al mismo solicitante, con los permisos correspondientes y después de conciliar y verificar el acta. Ambas aprobaciones auditan la regla aplicada y si actuó la misma cuenta.
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
- El personal ingresa con `{email, password}` en `POST /admin/auth/login`. Las rutas `/admin/mfa/setup` y `/admin/mfa/confirm` se retiraron (404).
- `GET/POST /admin/accounts`; `PATCH /admin/accounts/:accountId` — `{active}`; solo ADMIN_TECNICO.

El rol `OBSERVADOR` solo consulta la vista general y los resultados/actas publicados. Tiene `reports:read` también para cuentas existentes; nunca utiliza permisos de escritura almacenados dentro de un grant de observador. Las demás secciones del panel están bloqueadas y el servidor comprueba permisos en cada operación. El menú de resultados se habilita al cerrar todos los turnos; las API de resultados/PDF/CSV mantienen el embargo hasta `PUBLICADA`. Véase [Acceso del observador](OBSERVADOR.md). Los eventos de participación incluyen estados de turnos (`windows: [{shift,state}]`) para actualizar este bloqueo en vivo, sin preferencias.

## Integridad

Orden de bloqueo: elección → ventana → participación. Emisión usa FOR SHARE, cierre FOR UPDATE; la actualización PENDIENTE → VOTO_EMITIDO y la inserción de papeleta pertenecen a la misma transacción. El rol API no puede actualizar, borrar ni truncar papeletas. No hay columnas de identidad ni timestamp exacto en la urna.

Los endpoints de preferencias usan una guarda de PUBLICADA y verifican el hash del acta. Ningún desglose de preferencias por turno/grupo pequeño se exporta. Los permisos se comprueban en servidor por institución y alcance de elección.

Configuración adicional: `GET /admin/institution` requiere `elections:write` y devuelve el colegio compartido y `identityLocked`, que indica si ya existen elecciones iniciadas o finalizadas. `PATCH /admin/institution` recibe `{name,code}`; un guardado sin cambios devuelve 200 y no añade `INSTITUTION_UPDATED`, incluso tras un ensayo publicado. Cambiar realmente nombre/código se rechaza con 409 si `identityLocked` es true; no es necesario volver a guardarlos para crear otra elección. Mantiene los permisos institucionales existentes. `PATCH /admin/elections/:id/windows/:shift` recibe `{startsAt,endsAt}` (ISO UTC o null) y requiere que esa elección esté en BORRADOR, independientemente del historial de otras elecciones.

## Padrón

Los tres endpoints de inspección, vista previa y confirmación reciben exactamente una fuente: `{csv: texto}`, `{file:{name,base64}}` para `.xlsx`, o `{individual:{dni,apellidos_nombres,grado,seccion,turno,habilitado}}`. Todo se transporta en JSON. Límite JSON del prefijo roster: 8 MB; el Excel decodificado admite hasta 5 MB. La inspección devuelve hojas, encabezados, asociación sugerida, muestra y avisos; no guarda datos.

Opciones: `sheet`, `headerRow` (1–50, predeterminado 1), `mapping` con las seis claves del padrón y sus índices de columna desde cero, `skipExisting`, `updateProfiles` y `reason`. La actualización institucional requiere confirmación y motivo de al menos diez caracteres; conserva las instantáneas de participaciones anteriores.

El cliente envía un UUID `requestId` estable al confirmar. Un reintento con la misma identidad y contenido devuelve `alreadyImported:true`, `batchId`, cantidad y `credentials:[]`; un contenido diferente con el mismo UUID devuelve 409. Los clientes CSV antiguos sin UUID siguen aceptándose, pero no disponen de ese comprobante idempotente propio. La primera respuesta entrega los códigos en memoria; no se guardan en texto claro. La nueva interfaz conserva el UUID mientras reintenta y permite consultar el historial tras recargar.

La vista previa devuelve `total`, `valid`, `invalid`, `newCount`, `skipped`, errores por fila/campo, cambios institucionales, avisos y vigencia prevista. Cuenta filas únicas con error, no cantidad de mensajes. Muestra como máximo 100 filas; valida el lote completo. Una confirmación con cualquier error no guarda filas.

Reemisión: por lote únicamente en BORRADOR; individual también en PREPARADA/EN_CURSO/PAUSADA, para electores pendientes habilitados con turno no cerrado. Toma bloqueo exclusivo de elección, vuelve a comprobar condiciones, reemplaza hashes y revoca sesiones en una transacción. Los accesos y votos vuelven a comprobar la credencial/sesión tras adquirir su bloqueo para evitar carreras con la reemisión. Los motivos se auditan sin incluir códigos ni papeletas.

## Referencia de autorización institucional por elección

`POST /admin/elections` y `PATCH /admin/elections/:id` aceptan `institutionalApprovalReference` opcional: texto recortado, vacío o de 6–300 caracteres. Se guarda dentro de la transacción de configuración, con permiso `elections:write` y solo en BORRADOR. Si se omite en un PATCH, conserva el valor anterior. Enviar vacío lo borra y vuelve a impedir la preparación oficial. GET de listado y detalle devuelve el valor actual; no se expone en el endpoint público de elecciones.

Se almacena como referencia de aprobación `type:institutional-reference`, `state:RECORDED`, sin afirmar que otro operador la aprobó. La auditoría inmutable `INSTITUTIONAL_REFERENCE_UPDATED` registra actor y valores `previous`/`value`. La preparación de una elección OFICIAL comprueba exclusivamente su referencia guardada; ignora `INSTITUTIONAL_APPROVAL_REFERENCE` del entorno. No hay nueva columna ni migración, y no se altera el flujo de dos operadores para cierre y publicación.

## Votación directa con DNI (`authMode: DESK`)

Las elecciones nuevas y las oficiales usan acceso directo con DNI. Se conserva el valor interno `DESK` para actualizar elecciones existentes sin migraciones; ya no representa verificación de mesa ni registro de equipos. CODE se conserva para simulaciones anteriores.

- `POST /voter/dni-sessions`: `{electionId:UUID,dni:string}` de ocho dígitos, o `{electionId,identityType:"EXTRANJERO",studentCode:string}` para matrícula extranjera habilitada. Requiere origen autorizado y admite hasta 60 intentos por minuto e IP. Comprueba alumno activo, inscripción pendiente y elección en curso con al menos un horario abierto y vigente. No comprueba el turno individual del estudiante. No requiere cookies previas, equipo registrado, responsable, código ni aprobación.
- Devuelve cookie HttpOnly `sivee_voter`, CSRF, duración de 300 segundos y datos de la inscripción para confirmación. Revoca sesiones anteriores no consumidas del mismo estudiante y elección bajo bloqueo transaccional. El nuevo acceso sustituye al anterior; no genera otra participación.
- `/voter/me|ballot|votes|status|logout` usan exclusivamente la cookie del votante. Las mutaciones requieren su CSRF y origen exacto. Las sesiones DNI vencen a los cinco minutos sin prórroga por actividad; `logout` las revoca. `votes` revalida sesión, estudiante, apertura general y opción dentro de la transacción y conserva el voto único y los reintentos idempotentes.
- Audita `DNI_SESSION_CREATED` o `FOREIGN_SESSION_CREATED` sin DNI, matrícula, preferencia ni afirmación de identidad comprobada. El DNI acredita elegibilidad, no la identidad de quien lo escribe. No hay restricción por equipo o ubicación de red.
- Se retiraron `/booth/*` y `/admin/elections/:id/desk/*`. Las sesiones antiguas ligadas a cabinas exigen volver a ingresar el DNI. Los registros históricos de cabinas y admisiones permanecen en la base, sin intervenir en nuevos accesos. No se ejecuta un inicializador ni se modifica el padrón al actualizar.
- `GET /site`: modalidad, nombre institucional y URL del escudo. `GET /branding/crest`: PNG/JPEG. `POST /admin/institution/crest`: `{base64}`, requiere `elections:write`, límite 600 KB / 2048×2048.
- `/admin/elections/:id/roster/school` exige `roster:write` y alcance institucional. `GET /` devuelve registros con documentos enmascarados, totales y últimas 50 cargas; `GET /rows/:rowId` permite al operador revisar el documento completo; `GET /template.xlsx` genera una plantilla.
- `POST .../school/preview|import`: `{requestId:UUID, file:{name,base64}}`, `{requestId,csv}` o `{requestId,individual:{studentCode,document,displayName,grade,section,shift,enrollment}}`. Una sola fuente. La vista previa devuelve todas las filas con documentos enmascarados (máximo 5000), totales y observaciones; la interfaz las pagina de 50 en 50 sin repetir la carga ni guardar registros. La importación conserva los registros cifrados e idempotentes y crea automáticamente los estudiantes e inscripciones con DNI válido y no repetido. No hay confirmación individual ni aprobación de matrícula. Los documentos no utilizables se conservan en el listado sin habilitar votos y no bloquean al resto. La vista previa informa `unavailable` y el listado devuelve `eligible`, `unavailable` y `shifts` (MANANA, TARDE, UNKNOWN).
- `PATCH .../school/rows/:rowId`: campos de registro, `version`, `enrollmentApproved` (compatibilidad, sin aprobación requerida), `excluded`, `reason` (10–300 caracteres). Rechaza versiones antiguas y registros ya confirmados.
- `POST .../school/foreign-students`: `{rowIds:UUID[],reason:string}` (motivo 10–300 caracteres, hasta 5000 filas únicas). Requiere `roster:write` y alcance institucional. Marca explícitamente `isForeign` y registra mediante el identificador privado `FOREIGN:<matrícula normalizada>`. Solo admite registros ya cargados sin DNI válido, no excluidos y sin inscripción previa, además de reintentos ya clasificados. Puede habilitar esos registros en BORRADOR/PREPARADA/EN_CURSO/PAUSADA; se rechaza al cerrar. Audita `FOREIGN_STUDENTS_DECLARED`, con IDs opacos y motivo, sin documentos ni matrículas. No habilita otras filas pendientes fuera de la selección.
- `POST .../school/register`: `{}`; sincroniza automáticamente las cargas anteriores mientras la elección está en BORRADOR. La pantalla lo llama al abrirse y la preparación también sincroniza registros antes de contar electores. `POST .../school/publish` fue retirado. Las correcciones de DNI registran automáticamente al estudiante cuando desaparece el error. No se alteran elecciones anteriores ni se reactiva a alumnos desactivados institucionalmente.
- El turno se clasifica por grado y sección con la tabla institucional suministrada: 1.º A–G mañana/H–M tarde; 2.º A–F mañana/G–L tarde; 3.º a 5.º A–F mañana/G–K tarde. 3.º Gabriel García Márquez es tarde por confirmación explícita del colegio. Se reconocen los nombres y sus variantes ortográficas habituales; las secciones no reconocidas se muestran sin clasificar, sin impedir votar. La separación no cambia el acceso por DNI en cualquier horario abierto.
- En todos los entornos, las cuentas del personal acceden solo con correo y contraseña, incluso si activaron el autenticador anteriormente. Las sesiones históricas `MFA_SETUP` conservan acceso según sus permisos. Los campos MFA históricos se conservan sin usarse; no se requiere migración ni restablecer cuentas. Temporalmente, el cierre global y la publicación oficial permiten solicitar y aprobar con la misma cuenta autorizada; se mantienen los permisos, la conciliación y la verificación de integridad del acta. Véase [Cierre temporal](CIERRE_TEMPORAL_UNA_CUENTA.md).

No se registran documentos, secretos ni preferencias en auditoría. Las papeletas no incluyen estudiante, sesión ni dispositivo. Las políticas de supervisión y límites de identificación con DNI se detallan en [Producción](PRODUCCION.md).

El padrón escolar (`GET /admin/elections/:id/roster/school`) incluye `foreignShifts: {MANANA, TARDE, UNKNOWN}`: cantidades de registros clasificados explícitamente como extranjeros por turno, incluidos los pendientes o excluidos. Su suma corresponde a `foreign`. Son totales de la elección, independientes de los filtros de la tabla; la habilitación se consulta en el estado de cada fila. No expone documentos completos.

## Copias de configuración

- `GET /admin/elections/:id/copies`: últimas 20 copias, con `id`, `label`, `createdAt` y `summary` (nombre, registros, habilitados, extranjeros, listas y turnos). No devuelve documentos ni el contenido cifrado.
- `POST /admin/elections/:id/copies`: `{requestId:UUID,label:string}` (3–100 caracteres). Guarda los valores persistidos de elecciones con acceso DNI/matrícula. Idempotente por `requestId`/actor/elección/etiqueta; no modifica una copia existente.
- `POST /admin/elections/:id/copies/:copyId/recover`: `{requestId:UUID,name:string,confirmation:"CREAR NUEVA ELECCION"}`. Crea una elección nueva en borrador con turnos programados y cero votos; devuelve `{id,name,state}`. Conserva origen y auditorías. No admite elecciones preparadas/en curso/pausadas de esa institución pendientes de cerrar. Permisos `elections:write`, `roster:write` y `lists:write`: sobre el origen para guardar/listar y de ámbito global institucional para recuperar.
- Una copia inválida se rechaza con 409 `COPY_INVALID`; un UUID de recuperación reutilizado con otros parámetros se rechaza con 409. Reintentos idénticos y concurrentes devuelven la misma elección, sin duplicar datos ni auditorías.

Véase [Copias de configuración](COPIAS_CONFIGURACION.md) para los datos incluidos, límites y migración necesaria en Railway.
