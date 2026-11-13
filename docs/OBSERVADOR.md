# Acceso del observador

El rol `OBSERVADOR` permite consultar la elección sin administrar ni modificar datos.

| Apartado                                                                            | Acceso                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vista general                                                                       | Participación agregada y estado de los turnos. No muestra preferencias durante la votación.                                                                                                                                                              |
| Resultados y actas                                                                  | El apartado se habilita cuando todos los turnos configurados están cerrados (mañana y tarde en una elección de dos turnos). Las cifras y descargas se muestran únicamente después del cierre global, la conciliación exacta y la publicación autorizada. |
| Acta PDF y agregados CSV/JSON                                                       | Consulta y descarga de la versión publicada. Las exportaciones PDF/CSV quedan auditadas.                                                                                                                                                                 |
| Jornada, padrón, listas, incidencias, auditoría, configuración, cuentas y seguridad | Sin acceso desde el menú ni mediante un enlace directo del panel.                                                                                                                                                                                        |

El servidor rechaza las operaciones de creación, edición, apertura, cierre, conciliación, aprobación y publicación para este rol. La sesión y su cierre siguen disponibles. No accede a documentos de estudiantes ni a una relación entre identidad y papeleta.

La política efectiva del observador es `elections:read`, `turnout:read`, `results:read` y `reports:read`. Se aplica también a cuentas anteriores al cambio, sin actualizar sus contraseñas, permisos almacenados, alcances ni auditorías. Si un permiso de escritura quedó almacenado por error dentro de un grant `OBSERVADOR`, no se utiliza. Los demás roles conservan sus permisos; si una cuenta tiene además otro rol para esa elección, se mantienen las facultades de ese otro rol. Los alcances por elección e institución siguen vigentes.

No requiere migraciones ni nuevas variables de Railway. Basta desplegar la nueva versión. Las reglas de aprobación del cierre global y de publicación son independientes del observador y se conservan.

Validación: pruebas unitarias de permisos históricos y múltiples roles; integración con cuentas nuevas y existentes, rechazo de módulos y escrituras, embargo antes de publicar, acta/CSV publicados y auditoría; prueba de navegador de enlaces directos, menú, cierre de ambos turnos en vivo y descargas.
