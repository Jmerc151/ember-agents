# Ember Agents — System Architecture & AI Blueprint

> A self-managing AI agent team with auto-task generation, QA review, and self-healing.
> Use this document to understand the system and replicate the pattern for new projects.

## Overview

Ember Agents is a multi-agent orchestration system where AI agents autonomously execute tasks, review each other's work, generate follow-up tasks, and troubleshoot failures. It uses the Anthropic Claude API for all AI operations.

**Live URLs:**
- Dashboard: https://ember-agents.netlify.app
- API: http://44.249.57.123:3334 (AWS Lightsail VM)

## Architecture

```
┌────────────────────────────┐     ┌──────────────────────────────┐
│   Netlify (Frontend)       │     │   AWS Lightsail VM (Backend)  │
│   ember-agents.netlify.app │────▶│   44.249.57.123:3334          │
│                            │     │                                │
│   React 19 + Vite + TW4   │proxy│   Express 5 + SQLite + Claude │
│   /api/* → VM via proxy    │     │   PM2 process manager          │
└────────────────────────────┘     └──────────────────────────────┘
                                            │
                                            ▼
                                   ┌────────────────────┐
                                   │  Anthropic Claude   │
                                   │  API (Sonnet 4)     │
                                   └────────────────────┘
```

### Key Design Decisions
- **Netlify proxy** solves HTTPS→HTTP mixed content (frontend is HTTPS, VM API is HTTP)
- **SQLite** (better-sqlite3) for zero-config persistence — no external DB needed
- **PM2** for auto-restart on crash, log management, and startup-on-boot
- **In-memory tracking** (Map) for active agent runs — simple, no Redis needed
- **Fire-and-forget** pattern for post-task operations (review, follow-up gen, troubleshooting)

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React 19, Vite, Tailwind CSS 4 | Dashboard SPA |
| Backend | Express 5, Node.js 22 | REST API server |
| Database | SQLite (better-sqlite3) | Tasks, logs, messages |
| AI | Anthropic SDK (@anthropic-ai/sdk) | Claude Sonnet 4 |
| Hosting | Netlify (frontend), AWS Lightsail (API) | Production |
| Process | PM2 | Node process management |
| Notifications | web-push (VAPID) | Browser push notifications |

## Agent Team

| ID | Name | Role | Specialty |
|----|------|------|-----------|
| phoenix | Phoenix 🦅 | Frontend Engineer | React 19, Vite, UI components |
| forge | Forge 🔨 | Backend Engineer | Express, PostgreSQL, API design |
| sentinel | Sentinel 🛡️ | QA Engineer | Testing, bug catching, E2E validation |
| prism | Prism 🎨 | UI/UX Designer | Accessibility, responsive design, visual consistency |
| atlas | Atlas 🌍 | DevOps Engineer | Deployment, CI/CD, infrastructure |
| maestro | Maestro 🎭 | Onboarding Specialist | Restaurant content generation |

Agents are defined in `agents/agents.json`. Each has:
- `id`, `name`, `role`, `avatar`, `color`
- `description` — what it does
- `workdir` — which repo it operates on
- `skills` — Claude Code skills it can use
- `systemPrompt` — the full system prompt sent to Claude API

## Autonomous Pipeline

When a task is run, this entire pipeline executes automatically:

```
User creates task → assigns to agent → clicks "Run"
  │
  ▼
┌─────────────────────────────────────────────┐
│ AGENT EXECUTION                              │
│ Claude API call with agent's system prompt   │
│ + task title/description                     │
│ Output saved to task.output (max 50KB)       │
└─────────────┬───────────────────────────────┘
              │
    ┌─────────┴─────────┐
    │ SUCCESS            │ FAILURE
    ▼                    ▼
┌──────────────┐  ┌───────────────────────┐
│ Chat Summary │  │ 🔧 Auto-Troubleshoot  │
│ (300 chars)  │  │ Diagnoses WHY it failed│
└──────┬───────┘  │ Determines if retryable│
       │          │ If yes: fixes desc,    │
       ▼          │   resets, auto-reruns  │
┌──────────────┐  │ If no: flags for manual│
│ 🛡️ Sentinel  │  │ Max 2 retries          │
│ QA Review    │  └───────────────────────┘
│ Score X/10   │
│ PASS/FAIL    │
│ If FAIL ≤4:  │
│  create fix  │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 🧠 Task      │
│ Planner      │
│ Generates    │
│ 1-3 follow-  │
│ up tasks     │
│ Assigns to   │
│ best agent   │
└──────────────┘
```

## Database Schema (SQLite)

### tasks
```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'backlog'
    CHECK(status IN ('backlog','todo','in_progress','in_review','done','failed')),
  priority TEXT DEFAULT 'medium'
    CHECK(priority IN ('low','medium','high','critical')),
  agent_id TEXT,
  output TEXT DEFAULT '',
  error TEXT DEFAULT '',
  retries INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT
);
```

### task_logs
```sql
CREATE TABLE task_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id TEXT,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'info'
    CHECK(type IN ('info','success','error','warning','output')),
  created_at TEXT DEFAULT (datetime('now'))
);
```

### messages (team chat)
```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  sender_avatar TEXT DEFAULT '',
  sender_color TEXT DEFAULT '',
  text TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/agents | List all agents with task counts |
| GET | /api/tasks | List all tasks |
| POST | /api/tasks | Create task `{title, description, priority, agent_id}` |
| PATCH | /api/tasks/:id | Update task fields |
| DELETE | /api/tasks/:id | Delete task |
| GET | /api/tasks/:id/logs | Get task execution logs |
| POST | /api/tasks/:id/run | Run agent on task (triggers full pipeline) |
| POST | /api/agents/:id/stop | Stop running agent (AbortController) |
| GET | /api/stats | Dashboard stats |
| GET | /api/messages | Get chat messages |
| POST | /api/messages | Send chat message |
| DELETE | /api/messages | Clear all messages |
| POST | /api/chat/standup | Trigger team standup conversation |
| GET | /api/push/vapid-key | Get VAPID public key |
| POST | /api/push/subscribe | Subscribe to push notifications |
| GET | /api/health | Health check |

## Key Server Functions

### `generateFollowUpTasks(completedTask, agent, output)`
After task completion, asks Claude to generate 1-3 follow-up tasks. Checks existing tasks to avoid duplicates. Assigns each to the most appropriate agent. Posts announcement to chat.

### `reviewCompletedWork(completedTask, agent, output)`
Sentinel auto-reviews all completed work (except its own to prevent loops). Scores on correctness, completeness, quality, security, performance. If score ≤ 4 or verdict is FAIL, creates a high-priority fix task for the original agent.

### `troubleshootAndRetry(failedTask, agent, errorMsg)`
Diagnoses failures using error message + task logs. Determines if retryable (transient) vs permanent. If retryable: updates description with fix, resets status, auto-reruns after 3s delay. Max 2 retries before giving up.

## Frontend Components

| Component | Purpose |
|-----------|---------|
| `App.jsx` | Main app with React Router |
| `Sidebar.jsx` | Agent list, task counts, navigation |
| `TaskBoard.jsx` | Kanban board (Backlog → To Do → In Progress → Review → Done) |
| `TaskDetail.jsx` | Task view with output, logs, run/stop controls |
| `CreateTaskModal.jsx` | New task form with agent assignment |
| `ChatPanel.jsx` | Team chat with standup trigger |
| `AgentCards.jsx` | Agent profile cards |
| `MobileNav.jsx` | Responsive mobile navigation |
| `src/lib/api.js` | API client (fetch wrapper with auth) |

## Environment Variables

### Backend (.env on VM)
```
ANTHROPIC_API_KEY=sk-ant-...     # Required — Claude API key
API_PORT=3334                     # Server port (default: 3334)
EMBER_API_KEY=                    # Optional — Bearer token for API auth
ALLOWED_ORIGINS=                  # Optional — CORS origins (default includes Netlify)
VAPID_PUBLIC_KEY=                 # Optional — Web push (has defaults)
VAPID_PRIVATE_KEY=                # Optional — Web push (has defaults)
```

### Frontend (Netlify env vars)
```
VITE_API_URL=/api                 # Relative — proxied through Netlify
VITE_API_KEY=                     # Optional — sent as Bearer token
```

## Infrastructure Setup

### AWS Lightsail VM
- Ubuntu 24.04 LTS, $5/month plan
- Node.js 22, PM2 for process management
- Port 3334 open in firewall (Any IPv4)
- Server binds to `0.0.0.0` for external access
- PM2 configured with `pm2 startup` for boot persistence

### Netlify
- Auto-builds from GitHub (`npm run build`)
- Proxy redirect: `/api/*` → `http://44.249.57.123:3334/api/:splat`
- SPA fallback: `/*` → `/index.html`

## How to Replicate This Pattern for a New Project

1. **Define your agents** in `agents/agents.json` — give each a role, system prompt, and specialty
2. **Set up the Express server** with SQLite for tasks/logs/messages
3. **Wire up the Anthropic SDK** — each agent run is a `messages.create()` call with the agent's system prompt
4. **Add the autonomous pipeline:**
   - Post-completion: QA review → follow-up task generation
   - Post-failure: troubleshoot → retry (with max retries)
5. **Deploy:** Netlify for frontend (with proxy), Lightsail/VPS for backend
6. **Configure PM2** for process persistence

### Adapting for a Different Domain (e.g., Trading Bot)

Replace the agent definitions and system prompts:
- Instead of Phoenix/Forge/Sentinel → Analyst/Trader/RiskManager/Auditor
- Instead of code tasks → market analysis, trade signals, risk checks
- Same pipeline: execute → review → generate follow-ups → troubleshoot failures
- Same infrastructure: Express + SQLite + Claude API + PM2

The core pattern is domain-agnostic:
```
agents.json  → Define your team
systemPrompt → Domain-specific instructions
pipeline     → Execute → Review → Plan → Heal
```

## File Structure

```
ember-agents/
├── agents/
│   └── agents.json          # Agent definitions (id, role, systemPrompt)
├── server/
│   ├── index.js             # Express API + all pipeline logic
│   └── db.js                # SQLite setup + schema
├── src/
│   ├── App.jsx              # React app entry
│   ├── main.jsx             # Vite entry
│   ├── index.css            # Tailwind CSS
│   ├── components/          # React components
│   │   ├── TaskBoard.jsx
│   │   ├── TaskDetail.jsx
│   │   ├── ChatPanel.jsx
│   │   ├── Sidebar.jsx
│   │   ├── AgentCards.jsx
│   │   ├── CreateTaskModal.jsx
│   │   └── MobileNav.jsx
│   └── lib/
│       └── api.js           # API client
├── netlify.toml             # Netlify config + proxy
├── package.json
├── vite.config.js
└── SYSTEM.md                # This file
```

## Session Log (March 10, 2026)

### What was built in this session:
1. **Lightsail VM setup** — Ubuntu 24.04, Node 22, PM2, port 3334
2. **Server bind fix** — Changed `app.listen(PORT)` → `app.listen(PORT, '0.0.0.0')` for external access
3. **Netlify proxy** — `/api/*` proxied to VM to solve HTTPS→HTTP mixed content
4. **Auto-task generation** — `generateFollowUpTasks()` creates 1-3 follow-ups after task completion
5. **Completion summaries** — Agent posts first 300 chars of output to team chat
6. **Sentinel QA review** — Auto-reviews all completed work, scores X/10, creates fix tasks for failures
7. **Auto-troubleshoot & retry** — Diagnoses failures, retries up to 2x with improved descriptions
