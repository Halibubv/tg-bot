import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { VinlandStore } from "../src/storage/store.js";

function fixture(now = Date.parse("2026-09-29T09:05:00Z")) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vinland-"));
  const store = new VinlandStore(path.join(directory, "test.sqlite"), { clock: () => now });
  return { store, now, cleanup: () => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); } };
}

test("keeps an empty day empty, persists independent workout and nutrition values", (context) => {
  const { store, now, cleanup } = fixture(); context.after(cleanup);
  assert.equal(store.getToday("u1", now).workoutStatus, "unplanned");
  store.saveWorkout("u1", now, { status: "planned", title: "Силовая" });
  store.saveNutrition("u1", now, { kcal: "2100", proteinG: "160.5", fatG: "70", carbsG: "220" });
  const saved = store.saveWorkout("u1", now, { status: "completed" });
  assert.equal(saved.workoutStatus, "completed");
  assert.equal(saved.nutrition.proteinG, 160.5);
  assert.throws(() => store.saveNutrition("u1", now, { kcal: "", proteinG: 1, fatG: 1, carbsG: 1 }), /kcal is required/);
  assert.throws(() => store.saveNutrition("u1", now, { kcal: 1.5, proteinG: 1, fatG: 1, carbsG: 1 }), /kcal must/);
});

test("writes a Monday-to-Sunday week and protects mutations with idempotency", (context) => {
  const { store, now, cleanup } = fixture(); context.after(cleanup);
  const request = { status: "rest" };
  const first = store.runIdempotent("u1", "PUT /today/workout", "request-0001", request, () => store.saveWorkout("u1", now, request));
  const replay = store.runIdempotent("u1", "PUT /today/workout", "request-0001", request, () => { throw new Error("must not run"); });
  assert.equal(first.body.workoutStatus, "rest"); assert.equal(replay.replayed, true);
  assert.throws(() => store.runIdempotent("u1", "PUT /today/workout", "request-0001", { status: "planned" }, () => null), { statusCode: 409 });
  const week = store.getWeek("u1", now);
  assert.equal(week.from, "2026-09-28"); assert.equal(week.to, "2026-10-04"); assert.equal(week.summary.rest, 1);
});

test("reminds only for an enabled planned workout and never creates a second late-day slot", (context) => {
  const { store, now, cleanup } = fixture(Date.parse("2026-09-29T09:05:00Z")); context.after(cleanup);
  store.saveWorkout("u1", now, { status: "planned" });
  assert.deepEqual(store.dueReminders(now).map(({ slot }) => slot), [1]);
  store.queueReminder(store.dueReminders(now)[0], now); store.markReminderSent({ userId: "u1", date: "2026-09-29", slot: 1 }, now);
  assert.equal(store.dueReminders(now).length, 0);
  store.saveSettings("u1", { timeZone: "Europe/Moscow", remindersEnabled: false, firstReminderLocal: "09:00" });
  assert.equal(store.dueReminders(now).length, 0);
});

test("an expired reminder lease can be safely claimed after a process interruption", (context) => {
  const { store, now, cleanup } = fixture(Date.parse("2026-09-29T09:05:00Z")); context.after(cleanup);
  store.saveWorkout("u1", now, { status: "planned" });
  const reminder = store.dueReminders(now)[0];
  assert.equal(store.queueReminder(reminder, now), true);
  assert.equal(store.queueReminder(reminder, now), false);
  const afterLease = now + 5 * 60_000 + 1;
  assert.equal(store.queueReminder(reminder, afterLease), true);
  store.saveWorkout("u1", now, { status: "completed" });
  assert.equal(store.reminderStillRelevant(reminder), false);
});

test("settings and days survive a stopped-process backup and restore", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vinland-backup-"));
  const now = Date.parse("2026-09-29T09:05:00Z");
  const originalPath = path.join(directory, "original.sqlite");
  const restoredPath = path.join(directory, "restored.sqlite");
  const original = new VinlandStore(originalPath, { clock: () => now });
  original.saveSettings("u1", { timeZone: "Europe/Samara", remindersEnabled: false, firstReminderLocal: "08:30" });
  original.saveWorkout("u1", now, { status: "completed" });
  original.saveNutrition("u1", now, { kcal: 2100, proteinG: 155.5, fatG: 70, carbsG: 230 });
  original.close();
  fs.copyFileSync(originalPath, restoredPath);
  const restored = new VinlandStore(restoredPath, { clock: () => now });
  context.after(() => { restored.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  assert.equal(restored.getSettings("u1").timeZone, "Europe/Samara");
  assert.equal(restored.getSettings("u1").remindersEnabled, false);
  assert.equal(restored.getToday("u1", now).workoutStatus, "completed");
  assert.equal(restored.getToday("u1", now).nutrition.proteinG, 155.5);
  assert.equal(restored.getToday("u2", now).workoutStatus, "unplanned");
});
