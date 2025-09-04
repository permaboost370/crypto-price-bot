import "dotenv/config";
import express from "express";
import { Telegraf } from "telegraf";
import { attachHandlers } from "./src/handlers.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

const app = express();
app.use(express.json());

const bot = new Telegraf(token, {
  handlerTimeout: 15_000
});
attachHandlers(bot);

// Webhook route (Telegram -> our server)
app.post(`/webhook/${token}`, (req, res) => {
  bot.handleUpdate(req.body);
  res.status(200).send("ok");
});

// Health check
app.get("/", (_req, res) => res.send("OK"));

// Start server
const port = process.env.PORT || 10000;
app.listen(port, async () => {
  console.log(`Server listening on :${port}`);

  // If BASE_URL provided, auto-set webhook on boot
  const baseUrl = process.env.BASE_URL?.replace(/\/$/, "");
  if (baseUrl) {
    try {
      const webhookUrl = `${baseUrl}/webhook/${token}`;
      await bot.telegram.setWebhook(webhookUrl, { drop_pending_updates: true });
      console.log("Webhook set:", webhookUrl);
    } catch (e) {
      console.error("Failed to set webhook:", e.message);
    }
  } else {
    console.log("BASE_URL not set. After first deploy, set it so the server auto-configures the webhook.");
  }
});
