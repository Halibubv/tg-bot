import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { assertClockTime, assertIsoDate, assertTimeZone, localDate, localTime } from "../domain/date.js";

const WORKOUT_STATUSES = new Set(["unplanned", "planned", "completed", "rest"]);
const NUTRITION_FIELDS = ["kcal", "proteinG", "fatG", "carbsG"];
const isoNow = (clock) => new Date(clock()).toISOString();

function numberValue(value, name, { integer = false } = {}) {
  if (value === null || value === "" || value === undefined) throw new RangeError(`${name} is required.`);
  const parsed = Number(typeof value === "string" ? value.replace(",", ".") : value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100_000 || (integer && !Number.isInteger(parsed)) || (!integer && Math.round(parsed * 10) !== parsed * 10)) {
    throw new RangeError(integer ? `${name} must be a non-negative integer.` : `${name} must be a non-negative number with at most one decimal place.`);
  }
  return parsed;
}

function weekBounds(localDay) {
  const start = new Date(`${localDay}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

export class VinlandStore {
  constructor(databasePath, { clock = Date.now } = {}) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath); this.clock = clock; this.migrate();
  }

  migrate() {
    this.db.exec(`
      PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
        reminders_enabled INTEGER NOT NULL DEFAULT 1 CHECK(reminders_enabled IN (0, 1)),
        first_reminder_local TEXT NOT NULL DEFAULT '09:00', onboarded INTEGER NOT NULL DEFAULT 0 CHECK(onboarded IN (0, 1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS days (
        user_id TEXT NOT NULL REFERENCES users(id), date TEXT NOT NULL,
        workout_status TEXT NOT NULL CHECK(workout_status IN ('unplanned', 'planned', 'completed', 'rest')),
        workout_title TEXT, kcal REAL, protein_g REAL, fat_g REAL, carbs_g REAL, updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, date)
      );
      CREATE TABLE IF NOT EXISTS idempotency (
        user_id TEXT NOT NULL, endpoint TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
        status INTEGER NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, endpoint, request_key)
      );
      CREATE TABLE IF NOT EXISTS reminders (
        user_id TEXT NOT NULL, date TEXT NOT NULL, slot INTEGER NOT NULL CHECK(slot IN (1, 2)),
        state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued', 'sending', 'sent')), sent_at TEXT, lease_until TEXT, attempts INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, date, slot)
      );
    `);
    this.addColumnIfMissing("users", "onboarded", "INTEGER NOT NULL DEFAULT 0");
    this.addColumnIfMissing("reminders", "state", "TEXT NOT NULL DEFAULT 'queued'");
    this.addColumnIfMissing("reminders", "lease_until", "TEXT");
    this.addColumnIfMissing("reminders", "attempts", "INTEGER NOT NULL DEFAULT 0");
  }

  addColumnIfMissing(table, column, definition) {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all().map((entry) => entry.name);
    if (!columns.includes(column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  close() { this.db.close(); }

  ensureUser(userId) {
    const timestamp = isoNow(this.clock);
    this.db.prepare("INSERT OR IGNORE INTO users (id, created_at, updated_at) VALUES (?, ?, ?)").run(userId, timestamp, timestamp);
    return this.serializeSettings(this.db.prepare("SELECT id, timezone, reminders_enabled, first_reminder_local, onboarded FROM users WHERE id = ?").get(userId));
  }

  serializeSettings(row) { return { id: row.id, timeZone: row.timezone, remindersEnabled: Boolean(row.reminders_enabled), firstReminderLocal: row.first_reminder_local, onboarded: Boolean(row.onboarded) }; }

  getToday(userId, now = this.clock()) { const settings = this.ensureUser(userId); return this.getDay(userId, localDate(now, settings.timeZone)); }

  getDay(userId, date) {
    assertIsoDate(date);
    return this.serializeDay(this.db.prepare("SELECT * FROM days WHERE user_id = ? AND date = ?").get(userId, date), date);
  }

  serializeDay(row, date) {
    return { localDate: date, workoutStatus: row?.workout_status || "unplanned", workoutTitle: row?.workout_title || null,
      nutrition: row && row.kcal !== null ? { kcal: row.kcal, proteinG: row.protein_g, fatG: row.fat_g, carbsG: row.carbs_g } : null, updatedAt: row?.updated_at || null };
  }

  saveWorkout(userId, now, { status, title = "" }) {
    if (!WORKOUT_STATUSES.has(status)) throw new RangeError("workout status is invalid.");
    if (typeof title !== "string" || title.trim().length > 120) throw new RangeError("workout title must contain at most 120 characters.");
    const settings = this.ensureUser(userId); const date = localDate(now, settings.timeZone);
    const current = this.db.prepare("SELECT kcal FROM days WHERE user_id = ? AND date = ?").get(userId, date);
    if (status === "unplanned" && !current) return this.getToday(userId, now);
    if (status === "unplanned" && current.kcal === null) this.db.prepare("DELETE FROM days WHERE user_id = ? AND date = ?").run(userId, date);
    else this.db.prepare(`INSERT INTO days (user_id, date, workout_status, workout_title, updated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, date) DO UPDATE SET workout_status = excluded.workout_status, workout_title = excluded.workout_title, updated_at = excluded.updated_at`).run(userId, date, status, status === "planned" ? title.trim() || null : null, isoNow(this.clock));
    return this.getToday(userId, now);
  }

  saveNutrition(userId, now, nutrition) {
    const [kcal, proteinG, fatG, carbsG] = NUTRITION_FIELDS.map((field) => numberValue(nutrition[field], field, { integer: field === "kcal" }));
    const settings = this.ensureUser(userId); const date = localDate(now, settings.timeZone);
    const existing = this.db.prepare("SELECT workout_status, workout_title FROM days WHERE user_id = ? AND date = ?").get(userId, date);
    this.db.prepare(`INSERT INTO days (user_id, date, workout_status, workout_title, kcal, protein_g, fat_g, carbs_g, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, date) DO UPDATE SET kcal = excluded.kcal, protein_g = excluded.protein_g, fat_g = excluded.fat_g, carbs_g = excluded.carbs_g, updated_at = excluded.updated_at`).run(userId, date, existing?.workout_status || "unplanned", existing?.workout_title || null, kcal, proteinG, fatG, carbsG, isoNow(this.clock));
    return this.getToday(userId, now);
  }

  getJournal(userId, { from, to }) {
    this.ensureUser(userId); assertIsoDate(from); assertIsoDate(to); if (from > to) throw new RangeError("from must not be after to.");
    return this.db.prepare("SELECT * FROM days WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date ASC").all(userId, from, to).map((row) => this.serializeDay(row, row.date));
  }

  getWeek(userId, now = this.clock(), weekOf) {
    const settings = this.ensureUser(userId); const bounds = weekBounds(weekOf || localDate(now, settings.timeZone));
    const byDate = new Map(this.getJournal(userId, bounds).map((entry) => [entry.localDate, entry]));
    const cursor = new Date(`${bounds.from}T00:00:00Z`); const days = [];
    for (let index = 0; index < 7; index += 1) { const date = cursor.toISOString().slice(0, 10); days.push(byDate.get(date) || this.serializeDay(null, date)); cursor.setUTCDate(cursor.getUTCDate() + 1); }
    const summary = { completed: 0, rest: 0, nutrition: 0 };
    for (const day of days) { if (day.workoutStatus === "completed") summary.completed += 1; if (day.workoutStatus === "rest") summary.rest += 1; if (day.nutrition) summary.nutrition += 1; }
    return { ...bounds, days, summary };
  }

  getSettings(userId) { return this.ensureUser(userId); }
  completeOnboarding(userId) { this.ensureUser(userId); this.db.prepare("UPDATE users SET onboarded = 1, updated_at = ? WHERE id = ?").run(isoNow(this.clock), userId); return this.getSettings(userId); }
  saveSettings(userId, settings) {
    const timeZone = assertTimeZone(settings.timeZone); const firstReminderLocal = assertClockTime(settings.firstReminderLocal);
    if (typeof settings.remindersEnabled !== "boolean") throw new RangeError("remindersEnabled must be true or false.");
    this.ensureUser(userId);
    this.db.prepare("UPDATE users SET timezone = ?, reminders_enabled = ?, first_reminder_local = ?, updated_at = ? WHERE id = ?").run(timeZone, Number(settings.remindersEnabled), firstReminderLocal, isoNow(this.clock), userId);
    return this.getSettings(userId);
  }

  runIdempotent(userId, endpoint, key, request, action) {
    if (typeof key !== "string" || !/^[A-Za-z0-9_-]{8,120}$/.test(key)) throw new RangeError("Idempotency-Key is required and must be 8–120 safe characters.");
    const fingerprint = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db.prepare("SELECT fingerprint, status, response_json FROM idempotency WHERE user_id = ? AND endpoint = ? AND request_key = ?").get(userId, endpoint, key);
      if (existing) { if (existing.fingerprint !== fingerprint) { const error = new Error("This Idempotency-Key was already used for another request."); error.statusCode = 409; throw error; } this.db.exec("COMMIT"); return { replayed: true, status: existing.status, body: JSON.parse(existing.response_json) }; }
      const body = action();
      this.db.prepare("INSERT INTO idempotency (user_id, endpoint, request_key, fingerprint, status, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(userId, endpoint, key, fingerprint, 200, JSON.stringify(body), isoNow(this.clock));
      this.db.exec("COMMIT"); return { replayed: false, status: 200, body };
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  dueReminders(now = this.clock()) {
    const users = this.db.prepare("SELECT id, timezone, reminders_enabled, first_reminder_local, onboarded FROM users WHERE reminders_enabled = 1").all(); const due = [];
    for (const rawUser of users) {
      const user = this.serializeSettings(rawUser); const date = localDate(now, user.timeZone);
      const day = this.db.prepare("SELECT workout_status FROM days WHERE user_id = ? AND date = ?").get(user.id, date);
      if (day?.workout_status !== "planned") continue;
      const [hour, minute] = user.firstReminderLocal.split(":").map(Number); const firstMinutes = hour * 60 + minute;
      const clockText = localTime(now, user.timeZone); const currentMinutes = Number(clockText.slice(0, 2)) * 60 + Number(clockText.slice(3));
      const slot = currentMinutes >= firstMinutes + 720 ? 2 : currentMinutes >= firstMinutes ? 1 : null;
      if (!slot || (slot === 2 && firstMinutes + 720 >= 1440)) continue;
      const state = this.db.prepare("SELECT state, lease_until FROM reminders WHERE user_id = ? AND date = ? AND slot = ?").get(user.id, date, slot);
      if (!state || state.state === "queued" || (state.state === "sending" && state.lease_until <= isoNow(() => now))) due.push({ userId: user.id, date, slot });
    }
    return due;
  }

  queueReminder(reminder, now = this.clock()) {
    const leaseUntil = new Date(now + 5 * 60_000).toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const user = this.db.prepare("SELECT reminders_enabled FROM users WHERE id = ?").get(reminder.userId);
      const day = this.db.prepare("SELECT workout_status FROM days WHERE user_id = ? AND date = ?").get(reminder.userId, reminder.date);
      if (!user?.reminders_enabled || day?.workout_status !== "planned") { this.db.exec("COMMIT"); return false; }
      this.db.prepare("INSERT OR IGNORE INTO reminders (user_id, date, slot, state, attempts) VALUES (?, ?, ?, 'queued', 0)").run(reminder.userId, reminder.date, reminder.slot);
      const claimed = this.db.prepare("UPDATE reminders SET state = 'sending', lease_until = ?, attempts = attempts + 1 WHERE user_id = ? AND date = ? AND slot = ? AND (state = 'queued' OR (state = 'sending' AND lease_until <= ?))").run(leaseUntil, reminder.userId, reminder.date, reminder.slot, isoNow(() => now)).changes === 1;
      this.db.exec("COMMIT"); return claimed;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  markReminderSent(reminder, now = this.clock()) { return this.db.prepare("UPDATE reminders SET state = 'sent', sent_at = ?, lease_until = NULL WHERE user_id = ? AND date = ? AND slot = ? AND state = 'sending'").run(isoNow(() => now), reminder.userId, reminder.date, reminder.slot).changes === 1; }
  releaseReminder(reminder) { this.db.prepare("UPDATE reminders SET state = 'queued', lease_until = NULL WHERE user_id = ? AND date = ? AND slot = ? AND state = 'sending'").run(reminder.userId, reminder.date, reminder.slot); }
  reminderStillRelevant(reminder) {
    const user = this.db.prepare("SELECT reminders_enabled FROM users WHERE id = ?").get(reminder.userId);
    const day = this.db.prepare("SELECT workout_status FROM days WHERE user_id = ? AND date = ?").get(reminder.userId, reminder.date);
    return Boolean(user?.reminders_enabled && day?.workout_status === "planned");
  }
}
