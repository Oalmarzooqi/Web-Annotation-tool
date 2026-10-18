import prismaPkg from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const { PrismaClient } = prismaPkg as unknown as {
  PrismaClient: new (opts?: {
    adapter?: PrismaBetterSqlite3;
    log?: Array<"query" | "info" | "warn" | "error">;
  }) => {
    $disconnect: () => Promise<void>;
  };
};

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || "file:./dev.db",
});

export const prisma = new PrismaClient({
  adapter,
  log: ["error"],
}) as any;

