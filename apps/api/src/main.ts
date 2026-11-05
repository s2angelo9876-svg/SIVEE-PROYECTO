import { app } from "./app.js";
import { db } from "./db.js";
import { config } from "./config.js";
await db.$queryRaw`SELECT 1`;
const server = app.listen(config.PORT, "0.0.0.0", () =>
  console.log(
    JSON.stringify({
      event: "server_started",
      port: config.PORT,
      mode: config.SIVEE_ENV,
    }),
  ),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    server.close(() => void db.$disconnect().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  });
