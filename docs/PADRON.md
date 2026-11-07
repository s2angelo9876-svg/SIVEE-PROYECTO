> Para las nuevas elecciones con DNI y mesa, consulta [el padrón escolar oficial](PRODUCCION.md#preparar-el-padrón-real). Este documento describe también las simulaciones anteriores con códigos.

# Excel, registro individual y códigos de acceso

## Actualizar una instalación

Cierra el servidor con Ctrl+C. Desde la carpeta `SIVEE-PROYECTO`, actualiza con `git pull --ff-only origin main`, instala con `npm install` y arranca con `npm run dev`, con Docker disponible. El arranque genera Prisma y aplica la nueva migración automáticamente. Conserva `.env` y el volumen PostgreSQL.

La migración añade el historial de importaciones y conserva nombre, grado, sección y turno de cada participación. Completa los datos históricos desde el registro existente sin cambiar votos ni estados electorales. En un entorno donde la base ya está administrada por separado, ejecuta `npm run db:generate` y `npm run db:migrate` antes de arrancar los servicios.

## Cargar archivos

En **Padrón electoral → Excel o CSV**, selecciona el archivo. Se admiten `.xlsx` (hasta 5 MB) y CSV UTF-8 (hasta 900 KB, coma o punto y coma), con un máximo de 5000 estudiantes. Los `.xls` antiguos deben guardarse como `.xlsx`. No se aceptan macros, vínculos externos, libros protegidos ni archivos dañados. El contenido descomprimido está limitado a 16 MB, 20 hojas y 50 columnas por hoja.

1. Descarga **Plantilla Excel** o **Plantilla CSV**. La columna DNI de la plantilla Excel tiene formato de texto.
2. Selecciona la hoja y la fila de encabezados; pulsa **Leer encabezados** si cambias cualquiera de ellas.
3. Asocia DNI, nombres y apellidos, grado, sección, turno y habilitación con sus columnas. Los encabezados habituales se reconocen automáticamente; los ambiguos requieren selección manual.
4. Revisa las primeras filas. Las filas ocultas y filtradas con datos también se incluyen, con un aviso. Las filas vacías se omiten.
5. Pulsa **Validar padrón**. Revisa totales, registros nuevos, ya inscritos y filas con errores. Descarga el informe si necesitas corregir el archivo.
6. Pulsa **Confirmar importación**. Toda la carga válida se guarda en una transacción; los errores impiden confirmar. La validación se repite en el servidor al guardar.
7. Descarga los códigos y entrégalos individualmente. La descarga permanece disponible en la pantalla hasta ocultarla, cambiar de archivo o salir.

El DNI debe tener ocho dígitos. No se rellenan ceros eliminados por Excel ni se convierten fechas en documentos. Las fórmulas en columnas del padrón deben reemplazarse por valores. Las secciones se normalizan a mayúsculas; Mañana/Tarde y Sí/No son aceptados, además de MANANA/TARDE y true/false.

**Omitir estudiantes ya inscritos** solo omite registros idénticos en esa elección. Un DNI repetido dentro del archivo, datos contradictorios o habilitación diferente siguen siendo errores. La vista previa muestra cuántos se omitirán; no hay sobrescritura silenciosa.

## Registrar un estudiante omitido

En **Registrar estudiante**, completa sus datos, pulsa **Validar estudiante**, revisa la vista previa y confirma. Se aplican las mismas reglas de permisos, unicidad y elegibilidad que a los archivos. Dos operadores intentando incorporar a la misma persona no crean dos participaciones.

Las incorporaciones, tanto individuales como masivas, solo se permiten en **BORRADOR**. No se añadió un procedimiento de alta extraordinaria durante una jornada ni una reapertura de elecciones cerradas.

## Cambios de grado entre elecciones

Si el estudiante ya existe en la institución pero aún no está inscrito en esta elección, la vista previa identifica diferencias de nombre, grado, sección o turno. Para confirmarlas, marca la actualización de datos institucionales e indica el motivo (al menos diez caracteres).

Cada elección conserva sus propios datos de participación. Actualizar el grado o turno institucional no modifica cómo aparece el estudiante en elecciones anteriores. Un estudiante ya inscrito en la elección actual no se modifica mediante una nueva importación.

## Recuperar una entrega de códigos

**Últimas cargas del padrón** muestra los últimos 50 lotes, incluidos los registros individuales, con fecha, cantidad y origen. Si una conexión falla después de confirmar, consulta el historial antes de volver a cargar. Reintentar la misma solicitud devuelve su comprobante sin duplicar estudiantes. El historial no contiene códigos de acceso ni DNI en claro; los archivos originales no se almacenan.

- **En BORRADOR:** utiliza **Reemitir códigos del lote** para reemplazar toda una entrega perdida.
- **Consulta individual:** busca al elector por DNI y utiliza **Reemitir código**. Se permite si está habilitado, aún no participó y su turno no está cerrado, en BORRADOR, PREPARADA, EN_CURSO o PAUSADA.
- Indica el motivo, confirma la verificación de los titulares y descarga la nueva entrega. Se invalidan los códigos anteriores y todas las sesiones de esos estudiantes.
- Una reemisión no cambia habilitación, participaciones ni papeletas. Una solicitud concurrente que ya reemplazó los códigos obliga al segundo operador a revisar el estado antes de volver a emitir.

Los códigos no se recuperan descifrando la base: se genera una nueva credencial. Si también se pierde la respuesta de una reemisión, repite el procedimiento autorizado y entrega únicamente la última versión. Nunca registres códigos, contraseñas o preferencias electorales en el motivo.

La vigencia cubre al menos 30 días desde la emisión y se extiende hasta un día después de la fecha programada más tardía cuando corresponda. Cambiar los horarios en BORRADOR amplía la vigencia de los códigos activos que lo necesiten. La fecha del código no abre un turno: siguen aplicándose estado electoral y ventanas de votación.

## Menú lateral

El menú tiene desplazamiento independiente con rueda, panel táctil, gesto táctil y teclado cuando recibe el foco. Conserva acceso a Seguridad de cuenta y Cerrar sesión en pantallas de poca altura y en móvil.
