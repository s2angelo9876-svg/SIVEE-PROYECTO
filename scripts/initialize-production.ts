import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Run the compiled jobs in order without relying on a shell in the hosting platform.
try {
  for (const job of ["migrate.js", "bootstrap-production.js"]) {
    console.log(`SIVEE: ejecutando ${job}`);
    execFileSync(
      process.execPath,
      [fileURLToPath(new URL(job, import.meta.url))],
      {
        stdio: "inherit",
        env: process.env,
      },
    );
  }
} catch {
  console.error(
    "La inicialización se detuvo. Revisa el mensaje del paso anterior.",
  );
  process.exitCode = 1;
}
