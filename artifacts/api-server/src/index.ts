import app from "./app";
import { logger } from "./lib/logger";
import { initScheduler, normalizeCustomerCasing } from "./services/scheduler";
import { runStartupMigrations, refreshProductIssues } from "./services/startup-migrations";
import { startSocialPostScheduler } from "./routes/social-posts";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  try {
    await runStartupMigrations();
  } catch (e) {
    logger.warn({ err: e }, "Startup migrations failed");
  }

  try {
    await initScheduler();
  } catch (e) {
    logger.warn({ err: e }, "Scheduler init failed — will retry when settings are saved");
  }

  try {
    await refreshProductIssues();
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    setInterval(() => {
      refreshProductIssues().catch(e => logger.warn({ err: e }, "Weekly product issues refresh failed"));
    }, WEEK_MS);
  } catch (e) {
    logger.warn({ err: e }, "Product issues refresh failed on startup");
  }

  try {
    await normalizeCustomerCasing();
  } catch (e) {
    logger.warn({ err: e }, "Customer casing normalisation failed on startup");
  }

  try {
    startSocialPostScheduler();
  } catch (e) {
    logger.warn({ err: e }, "Social post scheduler failed to start");
  }
});
