import assert from "node:assert/strict";
import test from "node:test";
import { ConfigurationError, loadConfig } from "../src/config/load.js";

test("demo configuration is local and token-free", () => {
  const config = loadConfig({ APP_MODE: "demo" }, "C:/work/vinland");
  assert.equal(config.mode, "demo");
  assert.equal(config.host, "127.0.0.1");
  assert.match(config.databasePath, /vinland-demo\.sqlite$/);
});

test("demo mode refuses a public network binding", () => {
  assert.throws(() => loadConfig({ APP_MODE: "demo", HOST: "0.0.0.0" }), ConfigurationError);
});

test("production needs server-only Telegram settings", () => {
  assert.throws(() => loadConfig({ APP_MODE: "production" }), /TELEGRAM_BOT_TOKEN/);
  const config = loadConfig({ APP_MODE: "production", TELEGRAM_BOT_TOKEN: "token", WEB_APP_URL: "https://vinland.example", TELEGRAM_WEBHOOK_SECRET: "secret" });
  assert.equal(config.mode, "production");
});
