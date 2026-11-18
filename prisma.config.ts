import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Fallback keeps `prisma generate` working in CI/build steps without a DB.
    url: process.env.DATABASE_URL ?? "postgresql://user:password@localhost:5432/ambulance_dispatch",
  },
});
