# Preparar la elección del viernes después del ensayo

La elección del viernes 13 de noviembre de 2026 debe tener su propio registro, con cero votos. Los votos y las participaciones del ensayo pertenecen a la elección en la que se emitieron; no impiden que esos mismos estudiantes participen en una elección nueva.

## Conservar y terminar el ensayo

1. Identifica la elección usada para las pruebas. Conserva un respaldo de PostgreSQL desde Railway antes de preparar la jornada real.
2. Si sigue abierta, cierra sus turnos cuando ya no haya votantes de prueba. Solicita y aprueba el cierre global con tu misma cuenta autorizada de comité; esta excepción es temporal. Si ya hay una solicitud pendiente, pulsa **Aprobar cierre** desde esa cuenta. Véase [Cierre temporal](CIERRE_TEMPORAL_UNA_CUENTA.md).
3. Conserva el ensayo y su auditoría en el historial. El cierre es definitivo; no se trata de reabrir esa misma elección ni de borrar sus papeletas. La opción de reiniciar una simulación solo existe en DEMO.

## Recuperar una configuración ya guardada

Si guardaste una copia después de cargar padrón y listas, puedes usar **Configuración → Copias de configuración → Recuperar como nueva elección** para crear el proceso sin volver a importar esos datos. Conserva el ensayo y sus votos. Revisa nombre, autorización, horarios y cero votos antes de preparar. No copia cambios posteriores al punto guardado. Véase [Copias de configuración](COPIAS_CONFIGURACION.md).

## Crear el proceso real desde el panel

1. En **Configuración → Nueva elección**, crea un proceso con un nombre inequívoco, por ejemplo **Municipio Escolar · Viernes 13 de noviembre de 2026**. En la instalación de producción se crea como elección oficial en borrador.
2. Completa el reglamento, contacto y la **Referencia de autorización institucional** real que corresponda. Guarda la configuración.
3. En **Padrón electoral**, importa nuevamente el Excel original. Las inscripciones de esta elección comienzan pendientes de votar, aunque un estudiante ya haya votado en el ensayo.
4. Habilita nuevamente los **25 estudiantes extranjeros con su matrícula**, usando la acción del padrón. Esa clasificación se registra por elección y no se copia al importar el archivo original. Revisa también cualquier alta o corrección que se haya realizado manualmente durante las pruebas.
5. En Padrón combina **Filtrar por tipo de acceso** (DNI o extranjero con matrícula) y **Filtrar estudiantes por turno**. El resumen **Extranjeros por turno** muestra mañana, tarde y sin turno identificado del padrón completo; revisa la columna Estado para comprobar la habilitación. Comprueba los totales contra el padrón definitivo del colegio. Si no hubo cambios, la referencia es **1742 habilitados: 935 de mañana y 807 de tarde**, incluidos los 25 extranjeros. La revisión del Excel original adjunto el 10 de noviembre confirmó **10 extranjeros de mañana y 15 de tarde**; los 1717 registros con DNI válido se distribuyen en 925 de mañana y 792 de tarde. Son cifras de referencia del archivo, no una consulta a la base de producción.
6. Registra nuevamente las listas, candidaturas y propuestas, y sube sus logos originales. **Nueva elección no copia automáticamente el padrón ni las listas anteriores.**
7. En **Configuración → Institución y horarios**, guarda la fecha del **13 de noviembre de 2026** y las horas acordadas, expresadas en hora de Lima. Los horarios no abren la jornada automáticamente. Actualmente solo un turno puede estar abierto a la vez y mañana debe cerrarse antes de abrir tarde; el acceso directo por DNI no restringe al alumno por su turno individual.

## Comprobación antes del viernes

- Selecciona la elección correcta y revisa nombre, padrón habilitado, listas, logos y horarios.
- Verifica **cero participaciones emitidas y cero votos** antes de la apertura. Comprueba que tu cuenta autorizada de comité acceda con correo y contraseña. Durante la excepción temporal, esa misma cuenta puede solicitar y aprobar el cierre y la publicación.
- Realiza las prácticas y la capacitación en el ensayo; no emitas votos de prueba en el proceso definitivo.
- Cuando todo esté revisado, pulsa **Preparar elección**. Déjala preparada y sus turnos programados hasta que corresponda iniciar la votación.
- La página pública muestra la elección creada más recientemente que no esté anulada. Después de crear el proceso definitivo, no crees otro ensayo en esta misma instalación: cambiaría la elección que ven los estudiantes.
- El viernes, el comité abre manualmente el turno en **Jornada electoral**. Al finalizar ambos turnos: cierre global con una cuenta autorizada, conciliación y publicación solicitada y aprobada temporalmente por esa misma cuenta; luego descarga del acta.

Este procedimiento se realiza desde el panel. No requiere volver a ejecutar el inicializador de producción ni cambiar las claves del despliegue. Los logos ampliados se aplican a las imágenes ya guardadas al desplegar la nueva versión; no es necesario volver a subirlos en el ensayo.
