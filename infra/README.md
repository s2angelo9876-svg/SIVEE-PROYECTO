# Ejecución en contenedores

La ruta verificada para la presentación es PostgreSQL en Compose más `pnpm dev` en el host. `pnpm setup:demo` prepara esa combinación sin modificar datos existentes.

`Dockerfile` incluye una imagen de aplicación compilada, ejecutada como usuario `node`. La API sirve React y comparte el mismo origen. `compose.app.yaml` se combina con `compose.demo.yaml` para ejecutar también la app en Docker. Primero aplica migraciones y seed mediante `setup:demo`.

La URL de la app en contenedor usa **el mismo rol restringido y contraseña local** de `DATABASE_URL`, pero el host debe ser `db`. No uses el propietario de migraciones en el contenedor de la API. Exporta esa URL en `CONTAINER_DATABASE_URL` a través del gestor local de variables; no la pongas en el repositorio ni en comandos que impriman secretos.

```bash
docker compose --env-file .env -f infra/compose.demo.yaml -f infra/compose.app.yaml up --build -d
```

El origen del ejemplo es `http://localhost:8080`. Para una LAN real o nube, configura dominio/HTTPS, `WEB_ORIGIN` exacto y cookies seguras. `nginx/sivee.conf.example` es una plantilla; los certificados y la red institucional no están provisionados por el proyecto.

En el entorno cloud, toda compilación que acceda a red conserva proxy y CA. Para compilar con la CA de sesión:

```bash
docker --host=unix:///var/run/docker.sock build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" -f infra/Dockerfile -t sivee:demo .
```

La CA se monta solo en los pasos de instalación; no se incluye en la imagen. No desactives TLS ni verificación de checksums. Docker Compose requiere añadir el secreto de build equivalente si se usa ese flujo dentro de la nube.

La base se publica solo en loopback y utiliza volumen nombrado. La prueba de backup utiliza el contenedor de base y restaura exclusivamente en una base temporal. No hay servicios externos, túneles públicos ni despliegues remotos creados automáticamente.
