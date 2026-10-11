import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { secretFindings, type KnownSecret, type SecretFinding } from "./secret-policy";
const root = process.cwd();
const gitDir = path.join(root, ".git");
if (!existsSync(gitDir)) throw new Error("Run the secret check from the Sliper repository root.");
const staged = process.argv.includes("--staged");
function git(...args: string[]) {
  // The project was moved. Resolve this checkout explicitly instead of inherited Git paths.
  return execFileSync("git", [`--git-dir=${gitDir}`, `--work-tree=${root}`, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
const known: KnownSecret[] = [];
for (const file of readdirSync(root).filter(
  (name) => /^\.env(?:\.|$)/.test(name) && name !== ".env.example",
)) {
  if (!statSync(path.join(root, file)).isFile()) continue;
  for (const [name, value] of Object.entries(parse(readFileSync(path.join(root, file))))) {
    if (
      /SECRET|PASSWORD|PRIVATE|SIGNING|DATABASE_URL|TOKEN|API_KEY/.test(name) &&
      !/^NEXT_PUBLIC_/.test(name) &&
      value.length >= 8
    )
      known.push({ name, value });
  }
}
let files: string[];
try {
  files = (
    staged
      ? git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z")
      : git("ls-files", "--cached", "--others", "--exclude-standard", "-z")
  )
    .split("\0")
    .filter(Boolean);
} catch {
  throw new Error("Cannot inspect the Git index. No credential values were printed.");
}
const findings: SecretFinding[] = [];
for (const file of new Set(files)) {
  // Filenames and blob contents come from Git; never invoke a shell with them.
  let content: string;
  try {
    if (staged) content = git("show", `:${file}`);
    else {
      const full = path.resolve(root, file);
      if (!full.startsWith(root + path.sep) || !existsSync(full) || !statSync(full).isFile())
        continue;
      if (statSync(full).size > 8 * 1024 * 1024) {
        if (secretFindings(file, "").length) findings.push(...secretFindings(file, ""));
        continue;
      }
      content = readFileSync(full, "utf8");
    }
  } catch {
    throw new Error("A Git file could not be inspected. No credential values were printed.");
  }
  if (content.slice(0, 8000).includes("\0")) content = "";
  findings.push(...secretFindings(file, content, known));
}
if (findings.length) {
  for (const row of findings) console.error(`${row.path}:${row.line} — ${row.reason}`);
  console.error(
    "Secret check failed. Move private values to ignored environment files; rotate any previously published credentials.",
  );
  process.exitCode = 1;
} else
  console.log(
    `Secret check passed (${new Set(files).size} ${staged ? "staged" : "Git-visible"} files; values redacted).`,
  );
