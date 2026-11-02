import webpush from "web-push";
import {
  PRODUCTION_PUSH_ENV,
  ProductionPushProvisionError,
  provisionProductionPush,
} from "./lib/production-push-provision";
const args = process.argv.slice(2);
try {
  const mode = args[0];
  if (
    !["--check", "--apply"].includes(mode ?? "") ||
    args.length !== 5 ||
    args[1] !== "--env-file" ||
    args[2] !== PRODUCTION_PUSH_ENV ||
    args[3] !== "--subject" ||
    !args[4]
  )
    throw new ProductionPushProvisionError("USAGE");
  const result = await provisionProductionPush(args[2], args[4], mode === "--apply", () =>
    webpush.generateVAPIDKeys(),
  );
  console.log(
    JSON.stringify({
      operation: "production-push-provision",
      ...result,
      keysDisplayed: false,
      notificationSent: false,
      serviceRestarted: false,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      operation: "production-push-provision",
      failed: true,
      code: error instanceof ProductionPushProvisionError ? error.code : "IO_FAILURE",
      keysDisplayed: false,
      notificationSent: false,
    }),
  );
  process.exitCode = 1;
}
