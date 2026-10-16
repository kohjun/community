import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: [
    "./src/db/schema.ts",
    "./src/db/analytics-schema.ts",
    "./src/db/records-schema.ts",
    "./src/db/library-schema.ts",
    "./src/db/player-schema.ts",
    "./src/db/push-schema.ts",
    "./src/db/venue-schema.ts",
    "./src/db/safety-schema.ts",
    "./src/db/event-operations-schema.ts",
    "./src/db/event-lifecycle-schema.ts",
    "./src/db/engagement-schema.ts",
    "./src/db/crew-schema.ts",
    "./src/db/video-schema.ts",
    "./src/db/video-processing-schema.ts",
    "./src/db/media-retention-schema.ts",
    "./src/db/event-contact-schema.ts",
  ],
  out: "./drizzle",
  schemaFilter: ["sliper"],
  strict: true,
  verbose: true,
  // Generation/checking require no credentials. Remote writes use scripts/migrate.ts.
});
