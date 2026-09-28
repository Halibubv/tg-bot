import { ConfigurationError, loadConfig } from "./config/load.js";
import { createAppServer } from "./http/server.js";
import { startReminderScheduler } from "./reminders/service.js";
import { VinlandStore } from "./storage/store.js";

try {
  const config = loadConfig();
  const store = new VinlandStore(config.databasePath);
  const server = createAppServer({ config, store });
  const scheduler = startReminderScheduler({ config, store });
  server.listen(config.port, config.host, () => console.log(`VINLAND is listening on http://${config.host}:${config.port} (${config.mode} mode).`));
  const shutdown = () => { clearInterval(scheduler); server.close(() => { store.close(); process.exit(0); }); };
  process.once("SIGINT", shutdown); process.once("SIGTERM", shutdown);
} catch (error) {
  if (error instanceof ConfigurationError) {
    console.error(`Configuration error: ${error.message}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
