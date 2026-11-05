import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "./config.js";
export const db = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: config.DATABASE_URL,
    max: 20,
    statement_timeout: 15000,
  }),
  log: [],
});
