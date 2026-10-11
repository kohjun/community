import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as baseSchema from "./schema";
import * as librarySchema from "./library-schema";
import * as playerSchema from "./player-schema";
import * as pushSchema from "./push-schema";
import * as venueSchema from "./venue-schema";
import * as safetySchema from "./safety-schema";
import * as eventOperationsSchema from "./event-operations-schema";
import * as eventLifecycleSchema from "./event-lifecycle-schema";
import * as engagementSchema from "./engagement-schema";
import * as crewSchema from "./crew-schema";
import * as videoSchema from "./video-schema";
import * as videoProcessingSchema from "./video-processing-schema";
import * as recordsSchema from "./records-schema";
import * as analyticsSchema from "./analytics-schema";
const schema = {
  ...analyticsSchema,
  ...recordsSchema,
  ...baseSchema,
  ...librarySchema,
  ...playerSchema,
  ...pushSchema,
  ...venueSchema,
  ...safetySchema,
  ...eventOperationsSchema,
  ...eventLifecycleSchema,
  ...engagementSchema,
  ...crewSchema,
  ...videoSchema,
  ...videoProcessingSchema,
};

// Used only by the server-only client and local database scripts.
export function createDatabase(url: string, maxConnections = 5) {
  const client = postgres(url, { prepare: false, max: maxConnections });
  const db = drizzle(client, { schema });
  return { db, close: () => client.end() };
}

export type Database = ReturnType<typeof createDatabase>["db"];
