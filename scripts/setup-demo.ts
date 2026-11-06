import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import dotenv from "dotenv";

function run(command: string, args: string[], failure: string) {
  try {
    execFileSync(command, args, { stdio: "inherit", env: process.env });
  } catch {
    throw new Error(failure);
  }
}

function prepareDemo() {
  if (!fs.existsSync(".env")) {
    const secret = () => crypto.randomBytes(32).toString("hex");
    const password = secret();
    const appPassword = secret();
    fs.writeFileSync(
      ".env",
      `NODE_ENV=development\nSIVEE_ENV=demo\nPORT=5000\nWEB_ORIGIN=http://localhost:5173\nPOSTGRES_PASSWORD=${password}\nDATABASE_URL=postgresql://sivee_app:${appPassword}@127.0.0.1:5432/sivee_demo\nMIGRATION_DATABASE_URL=postgresql://sivee_owner:${password}@127.0.0.1:5432/sivee_demo\nDNI_LOOKUP_KEY=${secret()}\nSESSION_PEPPER=${secret()}\nCSRF_KEY=${secret()}\nCOOKIE_SECURE=false\nALLOW_DEMO_RESET=true\n`,
      { mode: 0o600, flag: "wx" },
    );
  }
  dotenv.config({ quiet: true });
  // Both connections must point at the demo before any database operations.
  const isDemoUrl = (value: string | undefined) => {
    try {
      const url = new URL(value || "");
      return (
        ["postgres:", "postgresql:"].includes(url.protocol) &&
        url.pathname === "/sivee_demo"
      );
    } catch {
      return false;
    }
  };
  if (
    process.env.SIVEE_ENV !== "demo" ||
    !isDemoUrl(process.env.DATABASE_URL) ||
    !isDemoUrl(process.env.MIGRATION_DATABASE_URL)
  ) {
    throw new Error(
      "Este comando solo prepara la base sivee_demo. Revisa SIVEE_ENV y las dos URLs en .env. Para una base ya preparada usa npm run dev:services.",
    );
  }

  let dockerOS: string;
  try {
    // Respect Docker Desktop, the selected context and DOCKER_HOST on every OS.
    dockerOS = execFileSync("docker", ["info", "--format", "{{.OSType}}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 20000,
    }).trim();
  } catch {
    throw new Error(
      "No se pudo conectar con Docker. Abre Docker Desktop y espera a que el motor esté listo (en Linux, inicia el servicio Docker). " +
        "En esta misma terminal ejecuta docker info y docker context ls. " +
        "Si DOCKER_HOST o DOCKER_CONTEXT apuntan a una conexión antigua, revisa la sección de Docker en README.md. Luego repite npm run dev.",
    );
  }
  if (dockerOS !== "linux") {
    throw new Error(
      "PostgreSQL necesita contenedores Linux. En Docker Desktop selecciona Switch to Linux containers y repite npm run dev.",
    );
  }
  run(
    "docker",
    ["compose", "version"],
    "Docker Compose no está disponible. Actualiza Docker Desktop o instala el plugin Docker Compose.",
  );
  run(
    "docker",
    [
      "compose",
      "--env-file",
      ".env",
      "-f",
      "infra/compose.demo.yaml",
      "up",
      "-d",
      "--wait",
      "db",
    ],
    "No se pudo iniciar PostgreSQL. Revisa el mensaje de Docker anterior y que el puerto 5432 esté libre. Conserva .env y el volumen de datos.",
  );
  // Invoke Node directly: execFileSync cannot launch npm.cmd/pnpm.cmd on Windows.
  run(
    process.execPath,
    [
      "node_modules/prisma/build/index.js",
      "generate",
      "--schema",
      "apps/api/prisma/schema.prisma",
    ],
    "No se pudo generar Prisma. Revisa el error anterior y ejecuta npm install.",
  );
  run(
    process.execPath,
    ["--import", "tsx", "scripts/migrate.ts"],
    "No se pudieron aplicar las migraciones. Revisa la conexión de .env y el error anterior.",
  );
  run(
    process.execPath,
    ["--import", "tsx", "apps/api/prisma/seed-demo.ts"],
    "No se pudieron preparar los datos de demo. Revisa el error anterior.",
  );
  console.log(
    "DEMO preparada. npm run dev inicia la aplicación en http://localhost:5173. Guía: docs/DEMO.md",
  );
}

try {
  prepareDemo();
} catch (error) {
  console.error(
    "\nSIVEE: " +
      (error instanceof Error ? error.message : "No se pudo preparar la demo."),
  );
  process.exitCode = 1;
}
