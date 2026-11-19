import "dotenv/config";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "../src/db/connection";
import { categories } from "../src/db/schema";
import { CATEGORIES } from "../src/domain/categories";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("Set MIGRATION_DATABASE_URL in .env before running migrations.");
const connection = createDatabase(url, 1);
try {
  await migrate(connection.db, { migrationsFolder: "./drizzle" });
  // PostgreSQL can use newly added enum values only once the migration commits.
  await connection.db
    .insert(categories)
    .values([...CATEGORIES])
    .onConflictDoNothing({ target: categories.slug });
  console.log("Sliper migrations applied.");
} finally {
  await connection.close();
}
