const dateFormatterCache = new Map();

function formatter(timeZone) {
  if (!dateFormatterCache.has(timeZone)) {
    dateFormatterCache.set(timeZone, new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }));
  }
  return dateFormatterCache.get(timeZone);
}

export function assertTimeZone(timeZone) {
  if (typeof timeZone !== "string" || !timeZone.trim()) {
    throw new RangeError("timezone must be a valid IANA timezone.");
  }
  try {
    formatter(timeZone).format();
  } catch {
    throw new RangeError("timezone must be a valid IANA timezone.");
  }
  return timeZone;
}

export function localDate(now, timeZone) {
  const parts = formatter(timeZone).formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function assertIsoDate(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new RangeError("date must use YYYY-MM-DD.");
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new RangeError("date must use YYYY-MM-DD.");
  }
  return date;
}

export function assertClockTime(time) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new RangeError("reminderTime must use HH:MM.");
  return time;
}

export function localTime(now, timeZone) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}

export function addHours(clockTime, hours) {
  const [hour, minute] = clockTime.split(":").map(Number);
  return `${String((hour + hours) % 24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
