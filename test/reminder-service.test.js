import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { dispatchDueReminders } from "../src/reminders/service.js";
import { VinlandStore } from "../src/storage/store.js";

test("successful delivery is marked sent and a failed delivery returns to the retry queue", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vinland-reminder-"));
  const now = Date.parse("2026-09-29T09:05:00Z");
  const store = new VinlandStore(path.join(directory, "test.sqlite"), { clock: () => now });
  context.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  store.saveWorkout("user", now, { status: "planned" });
  const config = { mode: "production", telegramBotToken: "not-live" };
  let sent = 0;
  await dispatchDueReminders({ store, config, now, send: async () => { sent += 1; } });
  await dispatchDueReminders({ store, config, now, send: async () => { sent += 1; } });
  assert.equal(sent, 1);
  const next = now + 9 * 60 * 60 * 1000;
  await dispatchDueReminders({ store, config, now: next, send: async () => { throw new Error("network"); } });
  assert.equal(store.dueReminders(next).length, 1);
});
