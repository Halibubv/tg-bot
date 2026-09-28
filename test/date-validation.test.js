import assert from "node:assert/strict";
import test from "node:test";
import { assertIsoDate, assertTimeZone } from "../src/domain/date.js";

test("rejects missing time zones instead of silently using the server zone", () => {
  assert.throws(() => assertTimeZone(undefined), RangeError);
  assert.throws(() => assertTimeZone(""), RangeError);
  assert.throws(() => assertTimeZone("Not/A_Zone"), RangeError);
  assert.equal(assertTimeZone("Europe/Moscow"), "Europe/Moscow");
});

test("rejects impossible calendar dates rather than normalizing them", () => {
  assert.throws(() => assertIsoDate("2026-02-31"), RangeError);
  assert.throws(() => assertIsoDate("2026-09-31"), RangeError);
  assert.equal(assertIsoDate("2028-02-29"), "2028-02-29");
});
