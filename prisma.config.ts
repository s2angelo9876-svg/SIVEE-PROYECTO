import "dotenv/config";
import { defineConfig } from "prisma/config";
import { PrismaPg } from "@prisma/adapter-pg";
export default defineConfig({
  schema: "apps/api/prisma/schema.prisma",
  experimental: { adapter: true },
  engine: "js",
  adapter: async () =>
    new PrismaPg({
      connectionString:
        process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
    }),
});
