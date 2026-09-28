export async function sendTelegramMessage({ token, chatId, text, replyMarkup }) {
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, reply_markup: replyMarkup }),
  });
  if (!response.ok) throw new Error(`Telegram request failed with ${response.status}.`);
}

export function vinlandWebAppKeyboard(webAppUrl) {
  return { inline_keyboard: [[{ text: "Открыть ВИНЛАНД", web_app: { url: webAppUrl } }]] };
}
