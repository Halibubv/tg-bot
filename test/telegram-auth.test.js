import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { AuthenticationError, verifyTelegramInitData } from "../src/auth/telegram.js";

function signedInitData(fields, token) {
  const params = new URLSearchParams(fields);
  const pairs = [...params].sort(([a], [b]) => a.localeCompare(b));
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  params.set("hash", createHmac("sha256", secret).update(pairs.map(([key, value]) => `${key}=${value}`).join("\n")).digest("hex"));
  return params.toString();
}

test("validates Telegram Mini App initData without trusting a client user id", () => {
  const now = 1_800_000_000_000;
  const initData = signedInitData({ auth_date: String(now / 1000), query_id: "query", user: JSON.stringify({ id: 123456789, first_name: "Ivar" }) }, "test-token");
  assert.deepEqual(verifyTelegramInitData(initData, "test-token", { now }), { id: "123456789", firstName: "Ivar" });
});

test("rejects a tampered, duplicate, or expired authorization payload", () => {
  const now = 1_800_000_000_000;
  const valid = signedInitData({ auth_date: String(now / 1000), user: JSON.stringify({ id: 1 }) }, "test-token");
  assert.throws(() => verifyTelegramInitData(`${valid}&user=%7B%22id%22%3A2%7D`, "test-token", { now }), AuthenticationError);
  assert.throws(() => verifyTelegramInitData(valid.replace("auth_date=1800000000", "auth_date=1"), "test-token", { now }), AuthenticationError);
});
