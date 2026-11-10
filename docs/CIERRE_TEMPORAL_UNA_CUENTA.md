# Cierre global y publicación temporal con una cuenta

Por indicación expresa del usuario, el cierre global permite temporalmente que una misma cuenta autorizada solicite y apruebe el cierre de una elección oficial. La excepción incluye también la publicación de resultados oficiales con esa misma cuenta, después de conciliar. Esta excepción no modifica el acceso por correo y contraseña.

## Operación

1. Selecciona la elección del ensayo y cierra todos sus turnos. El cierre es definitivo.
2. En **Jornada electoral → Cierre global**, pulsa **Solicitar cierre**, escribe el motivo y confirma. Si ya existe una solicitud pendiente, continúa al siguiente paso.
3. Desde la misma cuenta, pulsa **Aprobar cierre** y confirma. Se mantienen los permisos `elections:close` para solicitar y `elections:approve` para aprobar, además del alcance a la institución y elección.
4. Pulsa **Conciliar elección** y confirma. Después pulsa **Solicitar publicación**, registra el motivo y confirma; desde la misma cuenta pulsa **Aprobar publicación** y confirma. Si ya hay una publicación pendiente, puedes aprobarla directamente. Se conservan los permisos `results:publish` y `results:approve` y la verificación de integridad del acta.

La excepción no borra votos, cuentas, solicitudes ni auditoría, ni reabre elecciones. No requiere migraciones, variables nuevas o reinicializar la instalación. Desplegar la API y la web de esta revisión basta, también para las solicitudes pendientes creadas antes del cambio.

La auditoría conserva `CLOSE_REQUESTED`, `CLOSE_APPROVED`, `PUBLISH_REQUESTED` y `PUBLISH_APPROVED`, con el actor en cada paso. Añade `distinctAccountRequired` y, en la aprobación, `sameAccountApproval` junto con `approvalId`. El registro de aprobación conserva ambos identificadores, aunque sean la misma cuenta.

## Restauración cuando el usuario lo indique

La frase acordada es **«Reanuda el cierre de 2 accesos»**. Restaurará las dos cuentas tanto para cierre como para publicación. Es una indicación al colaborador para publicar otra revisión; no es un comando del panel ni de Railway.

1. Cambiar **ambas** constantes `REQUIRE_SECOND_ACCOUNT_FOR_CLOSE` y `REQUIRE_SECOND_ACCOUNT_FOR_PUBLICATION` de `false` a `true` en `packages/shared/approval-policy.ts`. La API y los textos del panel comparten esa política. No eliminar los registros de aprobaciones anteriores.
2. Actualizar `tests/integration.ts`: tanto el cierre como la publicación propios oficiales deben devolver 409 y permanecer pendientes; otra cuenta autorizada debe poder aprobarlos. Mantener las comprobaciones de permisos, conciliación, integridad y auditoría.
3. Actualizar la prueba de cierre y publicación oficial en `e2e/official.spec.ts` para verificar la segunda cuenta y el texto de la regla restaurada.
4. Actualizar esta documentación y las referencias de API, producción, demo y preparación de elección. Ejecutar build, lint, integración y la prueba de navegador de cierre y publicación.
5. Publicar en `main` y desplegar API/web en Railway. La regla restaurada se aplicará también a solicitudes que continúen pendientes. Las elecciones ya cerradas o publicadas conservan su estado y su auditoría.
