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
