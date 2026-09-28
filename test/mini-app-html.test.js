import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("loads the Telegram Mini App bridge before application code", () => {
  const html = fs.readFileSync(path.resolve("public/index.html"), "utf8");
  const bridge = html.indexOf('src="https://telegram.org/js/telegram-web-app.js"');
  const app = html.indexOf('src="app.js"');
  assert.ok(bridge !== -1, "Telegram bridge script must be present");
  assert.ok(app > bridge, "the bridge must load before app.js");
});
