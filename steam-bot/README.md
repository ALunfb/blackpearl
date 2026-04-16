# Black Pearl Steam Notification Bot

Steam chat bot that notifies users when new CS2 Black Pearl Doppler knife listings appear on CSFloat matching their criteria.

## Features

- **Subscription-based alerts** — Users choose knife type, float range, price range, pattern seed, and frequency
- **Snipe alerts** — Priority notifications for listings >15% below floor price
- **Price drop alerts** — Notify when a listed knife drops in price by a configurable %
- **Digest mode** — Hourly or daily summary instead of instant messages
- **Web dashboard** — Steam OpenID login, subscription management, notification history
- **Anti-ban measures** — Rate limiting, randomized delays, message variation, quiet hours
- **Chat commands** — `!help`, `!status`, `!list`, `!knives`

## Prerequisites

- **DigitalOcean account** — [$4/mo Droplet](https://www.digitalocean.com/pricing/droplets) (1 vCPU, 512MB RAM, 10GB SSD). New accounts get $200 free credit for 60 days.
- **A dedicated Steam account** for the bot (do NOT use your personal account)
- **Steam Desktop Authenticator (SDA)** for the bot account's 2FA
- **Steam Web API key** generated on the **bot account** (not your main)

## Main Account Safety

This bot runs on a completely separate Steam account. However, if you skip these steps, Steam could link your bot account to your main account — and if the bot gets banned, your main could face scrutiny. **Follow every item below.**

### Security Checklist

- [ ] **Create the bot account from a VPN or the VPS** — never from your home IP. If Steam sees the same IP on both accounts, they are linked.
- [ ] **Use a different email** for the bot account. Not an alias of your main email — a completely separate address.
- [ ] **Use a different phone number** for the bot account, or skip phone verification entirely. Shared phone numbers link accounts, and trade bans can cascade across linked accounts.
- [ ] **Generate the Steam Web API key while logged into the bot account.** If you generate it on your main account and it leaks (committed to git, exposed on a VPS), it's tied to your main account.
- [ ] **Only ever log the bot account into SDA.** Never open SDA with your main account. SDA stores credentials in plaintext in its `maFiles/` folder.
- [ ] **Download SDA only from the official GitHub repo:** [github.com/Jessecar96/SteamDesktopAuthenticator](https://github.com/Jessecar96/SteamDesktopAuthenticator). Fake SDA sites exist and will steal your credentials.
- [ ] **Run the bot on a VPS in production** — never from your home network. This ensures the bot's IP is different from your main account's IP.
- [ ] **Never store your main account credentials anywhere in this project.** Not in `.env`, not in notes, not in comments. The bot has zero reason to know about your main account.
- [ ] **Never commit `.env` to git.** The `.gitignore` already excludes it, but double-check before every push.
- [ ] **Back up the `.maFile`** somewhere secure. If you lose it and get locked out of the bot account, recovery is painful. Never commit it to git — it's a master key to the account.

### What Could Go Wrong If You Skip These

| Skipped Step | Consequence |
|---|---|
| Same IP for both accounts | Steam links the accounts. Bot ban could trigger investigation of your main. |
| Same phone number | Trade bans cascade to all accounts sharing the phone number. |
| API key from main account | If the key leaks, it's tied to your main account's identity. |
| Main account logged into SDA | SDA stores credentials in plaintext. Malware reads the file, your main is compromised. |
| Fake SDA download | Infostealer malware. Both accounts compromised. |
| `.env` committed to git | Bot credentials exposed publicly. Bot account compromised. |

### What the Bot Code Does NOT Do

- Does not reference, access, or store your main account credentials
- Does not read your Steam client's local files
- Does not interact with any account other than the bot account
- Does not phone home or send data to external services (only Steam API and CSFloat)

## Setup

### 1. Create the Bot Account

1. Use a VPN or SSH into your VPS
2. Create a new Steam account at [store.steampowered.com](https://store.steampowered.com) with a separate email
3. Do NOT add your main phone number

### 2. Set Up Steam Desktop Authenticator (SDA)

1. Download SDA **only** from [github.com/Jessecar96/SteamDesktopAuthenticator](https://github.com/Jessecar96/SteamDesktopAuthenticator)
2. Log into the **bot account** through SDA (never your main account)
3. Click "Setup New Account" to link the authenticator
4. SDA creates a `.maFile` in its `maFiles/` folder
5. Open the `.maFile` with a text editor — it's JSON containing `shared_secret` and `identity_secret`
6. Copy these two values — you'll need them for the `.env` file
7. Back up the `.maFile` somewhere secure

### 3. Get a Steam Web API Key

1. Log into [steamcommunity.com](https://steamcommunity.com) as the **bot account**
2. Go to [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey)
3. Register for a key (domain name doesn't matter much — use your bot dashboard domain)
4. Copy the key

### 4. Create a DigitalOcean Droplet

1. Sign up at [digitalocean.com](https://www.digitalocean.com) (new accounts get $200 free credit for 60 days)
2. Create a Droplet:
   - **Image:** Ubuntu 24.04 LTS
   - **Plan:** Basic $4/mo (1 vCPU, 512MB RAM, 10GB SSD)
   - **Region:** A US data center (NYC, SF, etc.) — pick one far from your home region to avoid IP proximity to your main Steam account
   - **Authentication:** SSH key (recommended) or password
3. Note the Droplet's IP address — this is your bot's static IP

### 5. Set Up the Droplet

SSH into your new Droplet:
```bash
ssh root@YOUR_DROPLET_IP
```

Run these commands to set up the server:
```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs build-essential python3

# Install pm2 (process manager) and Caddy (reverse proxy with auto-HTTPS)
npm install -g pm2
sudo apt install -y caddy

# Security hardening
sudo sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart sshd
sudo ufw allow OpenSSH
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades

# Clone the repo and install
git clone <your-repo-url>
cd blackpearl/steam-bot
npm install --production
```

### 6. Configure Environment

```bash
cp .env.example .env
nano .env
```

Fill in all values:

| Variable | Description |
|----------|-------------|
| `STEAM_USERNAME` | Bot's Steam login username |
| `STEAM_PASSWORD` | Bot's Steam login password |
| `STEAM_SHARED_SECRET` | From the `.maFile` — used for 2FA TOTP codes |
| `STEAM_IDENTITY_SECRET` | From the `.maFile` — used for trade confirmations |
| `STEAM_API_KEY` | API key generated on the **bot account** |
| `BOT_WEB_PORT` | Port for the web dashboard (default: 3001) |
| `BOT_WEB_URL` | Public URL of the dashboard (e.g. `https://bot.blackpearl.gg`) |
| `SESSION_SECRET` | Random string for cookie signing (generate with `node -e "console.log(crypto.randomUUID())"`) |
| `TRACKER_FILE_PATH` | Path to the main site's `data/listings-tracker.json` |
| `LISTINGS_FILE_PATH` | Path to the main site's `data/listings.json` |

### 7. Set Up Caddy (HTTPS Reverse Proxy)

Point your DNS (`bot.blackpearl.gg`) to the Droplet's IP address, then configure Caddy:

```bash
sudo nano /etc/caddy/Caddyfile
```

```
bot.blackpearl.gg {
    reverse_proxy localhost:3001
}
```

```bash
sudo systemctl restart caddy
```

Caddy handles HTTPS certificates automatically — no manual cert setup needed.

### 8. Start the Bot

```bash
cd /path/to/blackpearl/steam-bot
pm2 start src/index.mjs --name bp-bot
pm2 save
pm2 startup  # follow the printed command to enable auto-start on reboot
```

You should see in `pm2 logs bp-bot`:
```
[INFO] [main] Black Pearl Steam Bot starting...
[INFO] [web] Web server listening on port 3001
[INFO] [steam-client] Logged into Steam successfully
[INFO] [watcher] Starting listing watcher
```

Useful pm2 commands:
```bash
pm2 logs bp-bot      # view logs
pm2 restart bp-bot   # restart
pm2 stop bp-bot      # stop
pm2 monit            # monitor CPU/RAM
```

### 9. Set Up Data Sync

The bot reads `listings-tracker.json` from the main repo. Set up a cron to pull fresh data:

```bash
crontab -e
```

Add:
```
*/5 * * * * cd /path/to/blackpearl && git pull --quiet origin main
```

### 10. Test the Bot

1. Open `https://bot.blackpearl.gg` in your browser
2. Sign in with Steam (your personal account, not the bot)
3. Add the bot account as a friend on Steam
4. Create a test subscription on the dashboard
5. Run `node fetch-data.mjs` from the main site to trigger a data update and wait for the cron to pull it (or run `git pull` manually on the Droplet)
6. If any new listings match your subscription, the bot will message you

## Managing the Droplet

### Connecting via VS Code (Recommended)

You can use VS Code's **Remote - SSH** extension to connect to the Droplet and use Claude Code directly on the server:

1. Install the **Remote - SSH** extension in VS Code
2. Press `Ctrl+Shift+P` → "Remote-SSH: Connect to Host" → enter `root@YOUR_DROPLET_IP`
3. Open the project folder on the server
4. Claude Code now operates directly on the Droplet — you can edit files, run commands, and debug as if you were local

### Deploying Updates

```bash
ssh root@YOUR_DROPLET_IP
cd /path/to/blackpearl/steam-bot
git pull
npm install --production
pm2 restart bp-bot
```

### Hosting Other Projects

The $4 Droplet can run multiple lightweight Node.js projects. To add another:

```bash
# Clone and set up the other project
cd /path/to/other-project
npm install --production
pm2 start index.js --name other-project
pm2 save

# Add it to Caddy for HTTPS
sudo nano /etc/caddy/Caddyfile
```

```
bot.blackpearl.gg {
    reverse_proxy localhost:3001
}

other.yourdomain.com {
    reverse_proxy localhost:3002
}
```

```bash
sudo systemctl restart caddy
```

All projects share one Droplet, one bill. If you outgrow 512MB RAM, DigitalOcean lets you resize the Droplet with a few clicks.

## Rate Limits & Anti-Ban Defaults

| Setting | Default | Env Variable |
|---------|---------|--------------|
| Max messages per hour | 60 | `MAX_MESSAGES_PER_HOUR` |
| Max messages per day | 300 | `MAX_MESSAGES_PER_DAY` |
| Per-user cooldown | 1 min | `PER_USER_COOLDOWN_MINUTES` |
| Max friends | 250 | `MAX_FRIENDS` |
| Quiet hours (UTC) | 2:00-6:00 | `QUIET_HOUR_START`, `QUIET_HOUR_END` |
| Friend accept delay | 30-120s | Hardcoded in config |
| Message gap delay | 8-30s | Hardcoded in config |
| Snipe threshold | 15% below floor | `SNIPE_THRESHOLD_PCT` |

Start conservative. Increase limits gradually only after confirming stability over weeks.

## Architecture

```
index.mjs (entry point)
  ├── Steam Client (login, reconnect, heartbeat)
  │     ├── Friend Manager (accept/remove, welcome messages)
  │     ├── Message Sender (rate-limited priority queue)
  │     └── Chat Commands (!help, !status, !list)
  ├── Notification Pipeline
  │     ├── Listing Watcher (polls tracker file every 60s)
  │     ├── Matcher (filters listings against subscriptions)
  │     ├── Snipe Detector (flags listings below floor price)
  │     ├── Price Drop Monitor (tracks price changes)
  │     └── Digest (hourly/daily aggregation)
  └── Web Server (Express)
        ├── Steam OpenID auth
        ├── Subscription CRUD API
        └── Dashboard page
```

## File Structure

```
steam-bot/
  src/
    index.mjs                    # Entry point
    config.mjs                   # All configuration
    bot/
      steam-client.mjs           # Steam connection
      friend-manager.mjs         # Friend request handling
      message-sender.mjs         # Rate-limited message queue
      chat-commands.mjs          # !help, !status, etc.
    web/
      server.mjs                 # Express setup
      routes/auth.mjs            # Steam OpenID login
      routes/subscriptions.mjs   # Subscription API
      pages/dashboard.html       # Management UI
    data/
      database.mjs               # SQLite (auto-creates tables)
    notifications/
      listing-watcher.mjs        # Polls tracker file
      matcher.mjs                # Matches listings to subs
      formatter.mjs              # Message templates
      digest.mjs                 # Hourly/daily batching
      price-drop.mjs             # Price drop detection
      snipe-detector.mjs         # Snipe opportunity detection
    utils/
      rate-limiter.mjs           # Sliding window limiter
      delay.mjs                  # Random delays
      logger.mjs                 # File + console logging
  data/
    bot.sqlite                   # Created at runtime
  logs/
    bot.log                      # Created at runtime
```

## Troubleshooting

**"InvalidPassword" on login** — Double-check username/password. If you recently changed the password, wait a few minutes.

**"Steam Guard code requested but failed"** — Your `STEAM_SHARED_SECRET` is wrong. Re-extract it from the `.maFile`.

**Bot is online but not accepting friends** — Check `MAX_FRIENDS` limit. Also check `logs/bot.log` for errors.

**Messages not sending** — Check rate limits in the log. The bot pauses for 30 minutes after any send error. Run `pm2 logs bp-bot` to see what's happening.

**Dashboard login fails** — Ensure `BOT_WEB_URL` matches exactly what's in your browser address bar (protocol + domain). Steam OpenID is strict about return URLs. Make sure DNS is pointed to the Droplet and Caddy is running.

**`better-sqlite3` won't install on the Droplet** — Make sure `build-essential` and `python3` are installed: `sudo apt install build-essential python3`.

**Bot keeps disconnecting** — Check `pm2 monit` — if the Droplet is running out of RAM (512MB is tight), consider resizing to the $6/mo plan (1GB RAM) via the DigitalOcean dashboard.

**Caddy won't start** — Check that your DNS A record is pointed to the Droplet IP and has propagated. Caddy needs to reach the domain to issue HTTPS certs. Check `sudo systemctl status caddy` and `sudo journalctl -u caddy` for errors.

**Data not syncing** — Check the cron job is running: `crontab -l`. Check that `git pull` works manually in the repo directory. If it asks for credentials, set up a deploy key or use HTTPS with a token.
