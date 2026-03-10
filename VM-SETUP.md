# Ember Agents — Virtual Server Setup Guide

Run your 6 AI agents 24/7 on a cloud VM so they work while you sleep.

## Recommended: DigitalOcean Droplet
- **Size:** $6/month (1 vCPU, 1GB RAM) is enough for agent dispatch
- **OS:** Ubuntu 24.04 LTS
- **Region:** Pick one close to you

## One-Command Setup

After SSH'ing into your fresh VM, run:

```bash
curl -fsSL https://raw.githubusercontent.com/Jmerc151/ember-agents/main/setup-vm.sh | bash
```

Or copy `setup-vm.sh` to the server and run it manually.

## What the Script Does
1. Installs Node.js 22 LTS
2. Clones all 3 Ember repos
3. Installs dependencies
4. Sets up PM2 (process manager — keeps agents running after reboot)
5. Creates `.env` file (you fill in your keys)
6. Starts the ember-agents API on port 3334

## After Setup: One Manual Step

You need to authenticate Claude Code CLI once:

```bash
npx @anthropic-ai/claude-code
```

Follow the login prompt. After that, agents can dispatch tasks headlessly.

## Updating the Netlify Frontend

Point the frontend to your VM's API:
1. Go to https://app.netlify.com → ember-agents site → Site settings → Environment variables
2. Set `VITE_API_URL` to `http://YOUR_VM_IP:3334`
3. Trigger a redeploy

## Managing the Server

```bash
# Check if agents API is running
pm2 status

# View logs
pm2 logs ember-agents-api

# Restart after code changes
cd ~/ember/ember-agents && git pull && npm install && pm2 restart ember-agents-api

# Update all repos
cd ~/ember/sous-backend && git pull && npm install
cd ~/ember/sous-frontend && git pull && npm install
cd ~/ember/ember-agents && git pull && npm install
```

## Monitoring
- PM2 auto-restarts if the process crashes
- `pm2 startup` enables auto-start on server reboot
- Logs are at `~/.pm2/logs/`
