import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAppServer } from "../src/http/server.js";
import { VinlandStore } from "../src/storage/store.js";

test("demo API persists only the demo principal and serves the Mini App", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vinland-http-"));
  const now = Date.parse("2026-09-29T09:00:00Z");
  const store = new VinlandStore(path.join(directory, "test.sqlite"), { clock: () => now });
  const config = { mode: "demo", demoUserId: "demo", telegramBotToken: null, webhookSecret: null };
  const server = createAppServer({ config, store, now: () => now, publicDirectory: path.resolve("public") });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  context.after(() => { server.close(); store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const key = "api-request-0001";
  const response = await fetch(`${origin}/api/today/workout`, { method: "PUT", headers: { "content-type": "application/json", "Idempotency-Key": key }, body: JSON.stringify({ status: "planned", userId: "forged-user" }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).workoutStatus, "planned");
  const today = await (await fetch(`${origin}/api/today`)).json();
  assert.equal(today.workoutStatus, "planned");
  assert.equal(store.getToday("forged-user", now).workoutStatus, "unplanned");
  assert.equal((await fetch(`${origin}/`)).headers.get("content-type"), "text/html; charset=utf-8");
});

test("production API rejects missing Telegram initData", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vinland-auth-"));
  const store = new VinlandStore(path.join(directory, "test.sqlite"));
  const server = createAppServer({ config: { mode: "production", telegramBotToken: "not-live", webhookSecret: "secret" }, store });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  context.after(() => { server.close(); store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  assert.equal((await fetch(`${origin}/api/today`)).status, 401);
});
