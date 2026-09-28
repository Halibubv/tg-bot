import { sendTelegramMessage } from "../telegram/client.js";

export async function dispatchDueReminders({ store, config, now = Date.now(), send = sendTelegramMessage }) {
  if (config.mode !== "production") return { attempted: 0, sent: 0 };
  const due = store.dueReminders(now);
  let sent = 0;
  for (const reminder of due) {
    // A five-minute SQLite lease prevents concurrent workers from delivering the same slot.
    if (!store.queueReminder(reminder, now)) continue;
    if (!store.reminderStillRelevant(reminder)) {
      store.releaseReminder(reminder);
      continue;
    }
    try {
      await send({
        token: config.telegramBotToken,
        chatId: reminder.userId,
        text: "ВИНЛАНД: отметьте результат дня — тренировку или день отдыха.",
      });
      store.markReminderSent(reminder, now);
      sent += 1;
    } catch (error) {
      store.releaseReminder(reminder);
      // Never put tokens, initData, or Telegram profile data in logs.
      console.error("Reminder delivery failed; it will be retried.");
    }
  }
  return { attempted: due.length, sent };
}

export function startReminderScheduler(dependencies) {
  const run = () => dispatchDueReminders(dependencies).catch((error) => console.error(`Reminder scheduler failed: ${error.message}`));
  run();
  return setInterval(run, 15 * 60 * 1000);
}
