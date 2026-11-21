import pino, { type DestinationStream, type Logger } from "pino";
import { sanitizeRoutePath, scrubSensitiveStrings } from "../domain/observability";

const REDACT_PATHS = [
  "authorization",
  "cookie",
  "set-cookie",
  "password",
  "passcode",
  "token",
  "accessToken",
  "refreshToken",
  "secret",
  "apiKey",
  "email",
  "phone",
  "contact",
  "contactInfo",
  "databaseUrl",
  "supabaseKey",
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "headers.cookie",
  "*.authorization",
  "*.cookie",
  "*.password",
  "*.token",
  "*.secret",
  "*.email",
  "*.phone",
  "*.contact",
  "*.contactInfo",
  "*.apiKey",
];

function resolveLogLevel(env: Record<string, string | undefined>): string {
  const explicit = env.LOG_LEVEL?.trim().toLowerCase();
  if (explicit && ["fatal", "error", "warn", "info", "debug", "trace", "silent"].includes(explicit))
    return explicit;
  if (env.NODE_ENV === "test") return "silent";
  return "info";
}

export function buildLogger(
  options: {
    service?: string;
    level?: string;
    destination?: DestinationStream;
    env?: Record<string, string | undefined>;
  } = {},
): Logger {
  const env = options.env ?? process.env;
  const level = options.level ?? resolveLogLevel(env);
  const service = options.service ?? "sliper-web";
  const base = {
    service,
    ...(env.SLIPER_RELEASE ? { release: env.SLIPER_RELEASE } : {}),
  };
  const pinoOptions: pino.LoggerOptions = {
    level,
    base,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: REDACT_PATHS,
      censor: "[Redacted]",
    },
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  };
  return options.destination ? pino(pinoOptions, options.destination) : pino(pinoOptions);
}

const rootLogger = buildLogger();

export function createLogger(component: string): Logger {
  return rootLogger.child({ component });
}

export interface SafeErrorSummary {
  errName: string;
  errCode?: string;
  errMessage?: string;
  digest?: string;
}

export function summarizeErrorForLog(error: unknown): SafeErrorSummary {
  if (error instanceof Error) {
    const record = error as Error & { code?: unknown; digest?: unknown };
    const summary: SafeErrorSummary = {
      errName: error.name || "Error",
    };
    if (typeof record.code === "string" && record.code.length <= 64) summary.errCode = record.code;
    if (typeof record.digest === "string" && record.digest.length <= 128)
      summary.digest = record.digest;
    if (error.message) summary.errMessage = scrubSensitiveStrings(error.message).slice(0, 240);
    return summary;
  }
  return { errName: typeof error === "string" ? "StringError" : "UnknownError" };
}

export function logSafeError(
  logger: Logger,
  message: string,
  error: unknown,
  context: Record<string, string | number | boolean | null | undefined> = {},
): void {
  const sanitizedContext: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined) continue;
    if (key === "path" && typeof value === "string") {
      sanitizedContext[key] = sanitizeRoutePath(value);
    } else if (typeof value === "string") {
      sanitizedContext[key] = scrubSensitiveStrings(value).slice(0, 240);
    } else {
      sanitizedContext[key] = value;
    }
  }
  logger.error({ ...sanitizedContext, ...summarizeErrorForLog(error) }, message);
}
