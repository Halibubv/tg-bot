import path from "node:path";

export class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigurationError";
  }
}

const PLACEHOLDER = /^replace-with-/;

function value(environment, name) {
  return environment[name]?.trim() || "";
}

function required(environment, name) {
  const setting = value(environment, name);
  if (!setting || PLACEHOLDER.test(setting)) {
    throw new ConfigurationError(`${name} must be set to a real value.`);
  }
  return setting;
}

function readPort(rawPort) {
  const port = Number(rawPort || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigurationError("PORT must be an integer from 1 to 65535.");
  }
  return port;
}

export function loadConfig(environment = process.env, workingDirectory = process.cwd()) {
  const mode = value(environment, "APP_MODE") || "demo";
  const nodeEnvironment = value(environment, "NODE_ENV") || "development";

  if (!new Set(["demo", "production"]).has(mode)) {
    throw new ConfigurationError("APP_MODE must be demo or production.");
  }
  if (mode === "demo" && nodeEnvironment === "production") {
    throw new ConfigurationError("APP_MODE=demo cannot run with NODE_ENV=production.");
  }
  const host = value(environment, "HOST") || "127.0.0.1";
  if (mode === "demo" && !new Set(["127.0.0.1", "::1", "localhost"]).has(host)) {
    throw new ConfigurationError("Demo mode must bind to a loopback HOST.");
  }

  const dataDirectory = path.resolve(workingDirectory, value(environment, "DATA_DIRECTORY") || "data");
  const config = {
    mode,
    nodeEnvironment,
    host,
    port: readPort(value(environment, "PORT")),
    dataDirectory,
    databasePath: path.join(dataDirectory, mode === "demo" ? "vinland-demo.sqlite" : "vinland.sqlite"),
    demoUserId: "demo-vinland-user",
    telegramBotToken: null,
    webAppUrl: null,
    webhookSecret: null,
  };

  if (mode === "production") {
    config.telegramBotToken = required(environment, "TELEGRAM_BOT_TOKEN");
    config.webAppUrl = required(environment, "WEB_APP_URL");
    config.webhookSecret = required(environment, "TELEGRAM_WEBHOOK_SECRET");
    if (!config.webAppUrl.startsWith("https://")) {
      throw new ConfigurationError("WEB_APP_URL must use HTTPS in production.");
    }
  }

  return Object.freeze(config);
}
