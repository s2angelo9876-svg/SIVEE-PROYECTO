# Cierre global temporal con una cuenta

Por indicación expresa del usuario, el cierre global permite temporalmente que una misma cuenta autorizada solicite y apruebe el cierre de una elección oficial. La publicación de resultados oficiales sigue exigiendo dos cuentas distintas. Esta excepción no modifica el acceso por correo y contraseña.

## Operación

1. Selecciona la elección del ensayo y cierra todos sus turnos. El cierre es definitivo.
2. En **Jornada electoral → Cierre global**, pulsa **Solicitar cierre**, escribe el motivo y confirma. Si ya existe una solicitud pendiente, continúa al siguiente paso.
3. Desde la misma cuenta, pulsa **Aprobar cierre** y confirma. Se mantienen los permisos `elections:close` para solicitar y `elections:approve` para aprobar, además del alcance a la institución y elección.
4. La conciliación sigue siendo necesaria. La publicación oficial conserva `results:publish` y `results:approve`, con solicitante y aprobador distintos.

La excepción no borra votos, cuentas, solicitudes ni auditoría, ni reabre elecciones. No requiere migraciones, variables nuevas o reinicializar la instalación. Desplegar la API y la web de esta revisión basta, también para las solicitudes pendientes creadas antes del cambio.

La auditoría conserva `CLOSE_REQUESTED` y `CLOSE_APPROVED`, con el actor en cada paso. Añade `distinctAccountRequired` y, en la aprobación, `sameAccountApproval` junto con `approvalId`. El registro de aprobación conserva ambos identificadores, aunque sean la misma cuenta.

## Restauración cuando el usuario lo indique

La frase acordada es **«Reanuda el cierre de 2 accesos»**. Es una indicación al colaborador para publicar otra revisión; no es un comando del panel ni de Railway.

1. Cambiar `REQUIRE_SECOND_ACCOUNT_FOR_CLOSE` de `false` a `true` en `packages/shared/approval-policy.ts`. La API y los textos del panel comparten esa política. No eliminar los registros de aprobaciones anteriores.
2. Actualizar `tests/integration.ts`: el cierre propio oficial debe devolver 409 y permanecer pendiente; otra cuenta autorizada debe poder aprobarlo. Mantener las comprobaciones de permisos, auditoría y publicación con dos cuentas.
3. Actualizar la prueba de cierre oficial en `e2e/official.spec.ts` para verificar la segunda cuenta y el texto de la regla restaurada.
4. Actualizar esta documentación y las referencias de API, producción, demo y preparación de elección. Ejecutar build, lint, integración y la prueba de navegador del cierre.
5. Publicar en `main` y desplegar API/web en Railway. La regla restaurada se aplicará también a solicitudes que continúen pendientes. Las elecciones ya cerradas conservan su cierre definitivo y su auditoría.
