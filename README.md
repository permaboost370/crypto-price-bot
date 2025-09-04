# Crypto Price Bot (Telegram + Render)

## Commands
- /start — help
- /price <symbol> — e.g. /price btc (CoinGecko)
- /token <contractAddress> — e.g. /token 0xdAC17F... (Dexscreener)

## Local run
1) cp .env.example .env and fill TELEGRAM_BOT_TOKEN
2) npm i
3) npm run start
4) Use polling alternative: not needed (we use webhook). For local testing, use `BASE_URL` with a tunnel (e.g. cloudflared/ngrok) and run `bot.telegram.setWebhook`.

## Deploy on Render
1) Push this folder to a new GitHub repo.
2) On Render → **New +** → **Web Service**
   - Select the repo
   - Build command: `npm install`
   - Start command: `npm start`
   - Runtime: Node 18+
3) In **Environment** add:
   - `TELEGRAM_BOT_TOKEN` = your BotFather token
4) Deploy. Copy the public URL: `https://your-service.onrender.com`
5) Go to **Environment** and add:
   - `BASE_URL` = your Render URL (no trailing slash)
6) Redeploy (or hit “Restart”). The app auto-calls `setWebhook` on boot.
   - You can also set it manually:
     `https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=<BASE_URL>/webhook/<YOUR_TOKEN>`
7) DM your bot on Telegram: `/price eth` or `/token <contract>`

## Notes
- Render free tier sleeps; webhook still works when it wakes.
- Dexscreener returns many pairs; we auto-pick the highest-liquidity USD pair.
- CoinGecko search tries id → symbol/name match.
