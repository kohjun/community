import "dotenv/config";
import { sql } from "drizzle-orm";
import { createDatabase } from "../src/db/connection";
import { categories } from "../src/db/schema";
import { CATEGORIES } from "../src/domain/categories";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("Set MIGRATION_DATABASE_URL in .env before seeding.");
const connection = createDatabase(url, 1);
try {
  await connection.db
    .insert(categories)
    .values([...CATEGORIES])
    .onConflictDoUpdate({
      target: categories.slug,
      set: { name: sql`excluded.name`, sortOrder: sql`excluded.sort_order` },
    });
  console.log("Sliper categories and creative boards seeded.");
} finally {
  await connection.close();
}
