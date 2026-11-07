import { build } from "esbuild";
await build({
  entryPoints: ["apps/api/src/main.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: "dist/api/main.js",
  logLevel: "info",
});
await build({
  entryPoints: [
    "scripts/migrate.ts",
    "scripts/bootstrap-production.ts",
    "scripts/recover-account.ts",
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outdir: "dist/ops",
  logLevel: "info",
});
