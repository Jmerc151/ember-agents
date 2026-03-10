#!/bin/bash
# ═══════════════════════════════════════════════════════
# Ember Agents — VM Setup Script
# Run on a fresh Ubuntu 24.04 server
# Usage: bash setup-vm.sh
# ═══════════════════════════════════════════════════════

set -e
echo ""
echo "🔥 Ember Agents — Server Setup"
echo "═══════════════════════════════"
echo ""

# ─── 1. System updates ───
echo "📦 Updating system packages..."
sudo apt-get update -y && sudo apt-get upgrade -y
sudo apt-get install -y curl git build-essential

# ─── 2. Install Node.js 22 LTS ───
echo ""
echo "⬢ Installing Node.js 22 LTS..."
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
echo "  Node: $(node -v)"
echo "  npm:  $(npm -v)"

# ─── 3. Install PM2 (process manager) ───
echo ""
echo "🔄 Installing PM2..."
sudo npm install -g pm2
pm2 startup systemd -u $USER --hp $HOME | tail -1 | bash || true

# ─── 4. Clone repos ───
echo ""
echo "📂 Cloning Ember repos..."
mkdir -p ~/ember
cd ~/ember

if [ ! -d "sous-backend" ]; then
  git clone https://github.com/Jmerc151/sous-backend.git
else
  echo "  sous-backend already exists, pulling..."
  cd sous-backend && git pull && cd ..
fi

if [ ! -d "sous-frontend" ]; then
  git clone https://github.com/Jmerc151/sous-frontend.git
else
  echo "  sous-frontend already exists, pulling..."
  cd sous-frontend && git pull && cd ..
fi

# Note: Update this URL to your ember-agents repo
if [ ! -d "ember-agents" ]; then
  echo "  ⚠️  Clone your ember-agents repo manually:"
  echo "     cd ~/ember && git clone <your-ember-agents-repo-url>"
else
  echo "  ember-agents already exists, pulling..."
  cd ember-agents && git pull && cd ..
fi

# ─── 5. Install dependencies ───
echo ""
echo "📦 Installing dependencies..."
cd ~/ember/sous-backend && npm install
cd ~/ember/sous-frontend && npm install
if [ -d ~/ember/ember-agents ]; then
  cd ~/ember/ember-agents && npm install
fi

# ─── 6. Create .env files ───
echo ""
echo "🔑 Setting up environment files..."

# Backend .env
if [ ! -f ~/ember/sous-backend/.env ]; then
cat > ~/ember/sous-backend/.env << 'ENVEOF'
# Fill in your values:
DATABASE_URL=postgresql://postgres:adyJtQzDerpjsPgsktesuKgZmJUgsVLA@shinkansen.proxy.rlwy.net:27260/railway
JWT_SECRET=your-jwt-secret-here
ANTHROPIC_API_KEY=your-anthropic-key-here
CORS_ORIGIN=https://sous-frontend.vercel.app
PORT=5000
ENVEOF
  echo "  Created sous-backend/.env — EDIT THIS with your keys!"
else
  echo "  sous-backend/.env already exists"
fi

# Agents .env
if [ -d ~/ember/ember-agents ] && [ ! -f ~/ember/ember-agents/.env ]; then
cat > ~/ember/ember-agents/.env << 'ENVEOF'
# Fill in your values:
ANTHROPIC_API_KEY=your-anthropic-key-here
API_PORT=3334
ENVEOF
  echo "  Created ember-agents/.env — EDIT THIS with your keys!"
else
  echo "  ember-agents/.env already exists (or repo not cloned)"
fi

# ─── 7. Set up agent workdirs ───
echo ""
echo "📁 Creating agent working directories..."
mkdir -p ~/ember/agent-workdirs/{phoenix,forge,sentinel,prism,atlas,maestro}

# Give each agent access to the relevant repos
ln -sf ~/ember/sous-frontend ~/ember/agent-workdirs/phoenix/sous-frontend 2>/dev/null || true
ln -sf ~/ember/sous-backend ~/ember/agent-workdirs/forge/sous-backend 2>/dev/null || true

# ─── 8. Start services with PM2 ───
echo ""
echo "🚀 Starting services..."

if [ -d ~/ember/ember-agents ]; then
  cd ~/ember/ember-agents
  pm2 start server/index.js --name ember-agents-api --env production || echo "  ⚠️  Could not start ember-agents-api"
fi

pm2 save

# ─── 9. Install Claude Code CLI ───
echo ""
echo "🤖 Installing Claude Code CLI..."
npm install -g @anthropic-ai/claude-code || sudo npm install -g @anthropic-ai/claude-code

# ─── Done! ───
echo ""
echo "═══════════════════════════════════════════════════════"
echo "🔥 Setup complete!"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo ""
echo "  1. Edit your .env files:"
echo "     nano ~/ember/sous-backend/.env"
echo "     nano ~/ember/ember-agents/.env"
echo ""
echo "  2. Authenticate Claude Code (ONE TIME):"
echo "     npx @anthropic-ai/claude-code"
echo "     (Follow the login prompt)"
echo ""
echo "  3. Check services:"
echo "     pm2 status"
echo "     pm2 logs ember-agents-api"
echo ""
echo "  4. Update Netlify env var:"
echo "     Set VITE_API_URL to http://$(curl -s ifconfig.me):3334"
echo ""
echo "Your agents will now run 24/7! 🎉"
echo ""
