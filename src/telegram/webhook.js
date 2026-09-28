import { sendTelegramMessage, vinlandWebAppKeyboard } from "./client.js";

export async function handleTelegramUpdate(update, config) {
  const message = update?.message;
  if (!message?.chat?.id || typeof message.text !== "string") return;
  if (!/^\/start(?:\s|$)/.test(message.text)) return;
  await sendTelegramMessage({
    token: config.telegramBotToken,
    chatId: message.chat.id,
    text: "ВИНЛАНД — ваш дневник тренировки и питания. Откройте приложение, чтобы спланировать сегодняшний день.",
    replyMarkup: vinlandWebAppKeyboard(config.webAppUrl),
  });
}
