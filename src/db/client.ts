import "server-only";
import { createDatabase } from "./connection";

const globalDatabase = globalThis as unknown as {
  sliperConnection?: ReturnType<typeof createDatabase>;
};

export function getDatabase() {
  if (!globalDatabase.sliperConnection) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required on the server.");
    globalDatabase.sliperConnection = createDatabase(url);
  }
  return globalDatabase.sliperConnection.db;
}
