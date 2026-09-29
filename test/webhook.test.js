import assert from "node:assert/strict";
import test from "node:test";
import { handleTelegramUpdate } from "../src/telegram/webhook.js";

test("/start removes a legacy reply keyboard before showing the Mini App button", async () => {
  const calls = [];
  const config = { telegramBotToken: "test-only", webAppUrl: "https://example.test" };
  await handleTelegramUpdate(
    { message: { chat: { id: 123 }, text: "/start" } },
    config,
    { send: async (message) => calls.push(message) },
  );
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].replyMarkup, { remove_keyboard: true });
  assert.equal(calls[1].replyMarkup.inline_keyboard[0][0].web_app.url, config.webAppUrl);
  assert.equal(calls[0].chatId, calls[1].chatId);
});

test("unrelated messages do not change the keyboard", async () => {
  const calls = [];
  await handleTelegramUpdate(
    { message: { chat: { id: 123 }, text: "Привет" } },
    { telegramBotToken: "test-only", webAppUrl: "https://example.test" },
    { send: async (message) => calls.push(message) },
  );
  assert.equal(calls.length, 0);
});
