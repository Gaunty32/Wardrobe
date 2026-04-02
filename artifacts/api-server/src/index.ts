import app from "./app";
import { logger } from "./lib/logger";
import { initScheduler } from "./services/scheduler";
import { runStartupMigrations } from "./services/startup-migrations";

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
});
