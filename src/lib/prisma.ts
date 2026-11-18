import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "../config";
import { PrismaClient } from "../generated/prisma/client";

const createPrismaClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: config.databaseUrl }),
    log: config.isProduction ? ["error"] : ["warn", "error"],
  });

type PrismaClientSingleton = ReturnType<typeof createPrismaClient>;

// Re-use a single client across hot reloads / warm serverless invocations.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClientSingleton };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (!config.isProduction) globalForPrisma.prisma = prisma;

/** Transaction client type (the `tx` argument inside `prisma.$transaction`). */
export type TxClient = Parameters<Parameters<PrismaClientSingleton["$transaction"]>[0]>[0];
/** Either the root client or a transaction client. */
export type DbClient = PrismaClientSingleton | TxClient;
