import { sendTelegramMessage, vinlandWebAppKeyboard } from "./client.js";

export async function handleTelegramUpdate(update, config, { send = sendTelegramMessage } = {}) {
  const message = update?.message;
  if (!message?.chat?.id || typeof message.text !== "string") return;
  if (!/^\/start(?:\s|$)/.test(message.text)) return;
  // A reply keyboard created by an older version stays visible in Telegram
  // until the bot explicitly removes it. An inline keyboard cannot remove it.
  await send({
    token: config.telegramBotToken,
    chatId: message.chat.id,
    text: "Старое меню убрано. Откройте ВИНЛАНД кнопкой в следующем сообщении.",
    replyMarkup: { remove_keyboard: true },
  });
  await send({
    token: config.telegramBotToken,
    chatId: message.chat.id,
    text: "ВИНЛАНД — ваш дневник тренировки и питания. Откройте приложение, чтобы спланировать сегодняшний день.",
    replyMarkup: vinlandWebAppKeyboard(config.webAppUrl),
  });
}
