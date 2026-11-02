import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "dotenv";
import { AuthOriginError, configureAuthOrigin } from "./lib/supabase-auth-origin";

const args = process.argv.slice(2);
try {
  if (args.includes("--help")) {
    console.log(
      "tsx scripts/supabase-auth-origin.ts --project-ref REF --origin https://HOST:PORT [--apply]",
    );
    console.log(
      "Scoped Management PAT: SUPABASE_ACCESS_TOKEN or ignored .env.supabase.management.local. Plan mode is the default.",
    );
  } else {
    const apply = args.includes("--apply");
    const values = args.filter((argument) => argument !== "--apply");
    if (values.length !== 4 || values[0] !== "--project-ref" || values[2] !== "--origin")
      throw new AuthOriginError("USAGE");
    let token = process.env.SUPABASE_ACCESS_TOKEN;
    if (!token) {
      try {
        token = parse(
          await readFile(path.resolve(".env.supabase.management.local")),
        ).SUPABASE_ACCESS_TOKEN;
      } catch {
        throw new AuthOriginError("SCOPED_MANAGEMENT_TOKEN_REQUIRED");
      }
    }
    if (!token) throw new AuthOriginError("SCOPED_MANAGEMENT_TOKEN_REQUIRED");
    const result = await configureAuthOrigin({
      projectRef: values[1]!,
      origin: values[3]!,
      token,
      apply,
      backup: async (configuration) => {
        const directory = path.resolve(".local/auth-origin-backups");
        await mkdir(directory, { recursive: true, mode: 0o700 });
        // Never back up the full Auth response: it can contain OAuth and SMTP secrets.
        await writeFile(
          path.join(directory, `${values[1]}-${Date.now()}-${randomUUID()}.json`),
          JSON.stringify(configuration, null, 2) + "\n",
          { flag: "wx", mode: 0o600 },
        );
      },
    });
    console.log(JSON.stringify({ operation: "supabase-auth-origin", ...result }));
  }
} catch (error) {
  console.error(
    JSON.stringify({
      operation: "supabase-auth-origin",
      failed: true,
      code: error instanceof AuthOriginError ? error.code : "IO_FAILURE",
      secretsDisplayed: false,
    }),
  );
  process.exitCode = 1;
}
