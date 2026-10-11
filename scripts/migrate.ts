import "dotenv/config";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "../src/db/connection";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("Set MIGRATION_DATABASE_URL in .env before running migrations.");
const connection = createDatabase(url, 1);
try {
  await migrate(connection.db, { migrationsFolder: "./drizzle" });
  console.log("Sliper migrations applied.");
} finally {
  await connection.close();
}
