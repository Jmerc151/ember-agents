# Ember Agents — Usage Guide

Your AI-powered development team for building Ember, the restaurant kitchen management SaaS.

---

## Quick Start

```bash
cd ~/sous/ember-agents
npm run dev
# Open http://localhost:3333
```

This starts:
- **Frontend** on port 3333 (the dashboard)
- **Backend** on port 3334 (the API + agent dispatcher)

---

## Your Agent Team

| Agent | Role | Repo | What They Do |
|-------|------|------|-------------|
| **Phoenix** 🦅 | Frontend Engineer | sous-frontend | Builds React components, pages, hooks, and UI |
| **Forge** 🔨 | Backend Engineer | sous-backend | Builds API endpoints, DB migrations, server logic |
| **Sentinel** 🛡️ | QA Engineer | sous-frontend | Writes tests, catches bugs, validates features |
| **Prism** 🎨 | UI/UX Designer | sous-frontend | Reviews design, accessibility, responsive layout |
| **Atlas** 🌍 | DevOps Engineer | sous-frontend | Deploys to Vercel/Railway, CI/CD, monitoring |

Each agent has a specialized system prompt with domain knowledge about Ember and restaurant SaaS. They all have access to the `ember-restaurant` skill with deep kitchen management domain knowledge.

---

## Creating Tasks

### From the Dashboard

1. Click **"+ New Task"** (top right)
2. Fill in:
   - **Title** — What needs to be done (e.g., "Add inventory tracking to prep lists")
   - **Description** — Detailed instructions for the agent. Be specific about files, patterns, and expected behavior.
   - **Priority** — Low / Medium / High / Critical
   - **Assign Agent** — Pick the right agent for the job
3. Click **"Create Task"**

### Tips for Writing Good Task Descriptions

**Be specific about what you want:**
```
BAD:  "Fix the checklist page"
GOOD: "The opening checklist on KitchenBible doesn't show completion
       names on mobile. The completed_by text in OpeningTab.jsx gets
       truncated. Make it wrap to a new line below the checkbox label
       on screens under 480px."
```

**Reference files when you can:**
```
"Add a new API endpoint POST /api/inventory to sous-backend. Follow
the same controller pattern as checklistController.js. Create a new
migration file 004_inventory_tables.sql with tables for inventory_items
and inventory_counts."
```

**Let agents read the CLAUDE.md:**
Each repo has a `CLAUDE.md` that agents read automatically. It tells them the architecture, conventions, and patterns to follow. You don't need to repeat all of that in every task.

---

## Running Tasks

### From the Dashboard
- Hover over a task card in To Do → Click **"Run ▶"**
- Or click the task to open details → Click **"Run Agent ▶"**

### What Happens When You Run a Task

1. Task moves to **"In Progress"**
2. The assigned agent's dot turns **green** (with progress bar)
3. Claude Code spawns in headless mode in the agent's repo directory
4. The agent reads CLAUDE.md, understands the codebase, and starts working
5. Live logs stream to the task's **Logs** tab
6. When done, the task moves to **"Done"** (or **"Failed"** if there was an error)
7. Full output is available in the task's **Output** tab

### Monitoring Progress
- **Sidebar** — Shows which agents are active (green dot + progress bar)
- **Task Card** — Shows "Running" indicator
- **Task Detail → Logs** — Real-time log stream from the agent
- **Task Detail → Output** — Final output after completion

---

## Task Workflow

Tasks flow through columns left to right:

```
Backlog → To Do → In Progress → Review → Done
                                   ↓
                                Failed (retry available)
```

- **Backlog** — Ideas, future tasks. No agent assigned yet.
- **To Do** — Ready to run. Agent assigned, waiting for you to click Run.
- **In Progress** — Agent is actively working.
- **Review** — Agent finished, you need to review the changes.
- **Done** — Approved and complete.
- **Failed** — Agent encountered an error. Check logs, fix the issue, and retry.

You can manually move tasks between statuses by clicking a task and using the status buttons.

---

## Choosing the Right Agent

### Phoenix (Frontend) — Use when:
- Building new React components or pages
- Fixing UI bugs or layout issues
- Adding client-side state management
- Working with the Kitchen Bible tabs
- Implementing responsive design

### Forge (Backend) — Use when:
- Creating new API endpoints
- Writing database migrations
- Fixing server-side bugs
- Adding business logic
- Working with authentication

### Sentinel (QA) — Use when:
- You want end-to-end tests for a feature
- You need to validate a flow works (share link, checklist completion)
- You want accessibility testing
- Something seems broken and you need investigation

### Prism (Design) — Use when:
- Reviewing UI consistency
- Improving mobile layout
- Accessibility audits (WCAG)
- Visual polish and refinement
- Color/typography improvements

### Atlas (DevOps) — Use when:
- Deploying to Vercel or Railway
- Setting up CI/CD with GitHub Actions
- Managing environment variables
- Monitoring and performance

---

## Multi-Agent Workflows

For larger features, break the work into tasks across agents:

**Example: Add Inventory Tracking**

1. **Forge** — "Create inventory tables migration and API endpoints"
2. **Phoenix** — "Build inventory admin page and Kitchen Bible inventory tab" (after Forge is done)
3. **Prism** — "Review the inventory UI for mobile usability and accessibility"
4. **Sentinel** — "Write E2E tests for the inventory CRUD flow"
5. **Atlas** — "Deploy the inventory feature to production"

Run them sequentially — each builds on the last. The dashboard lets you track which step you're on.

---

## Running Agents from the Command Line

You don't have to use the dashboard. You can also run agents directly:

### Using the API

```bash
# Create a task
curl -X POST http://localhost:3334/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Fix the mobile nav bug",
    "description": "The bottom tab bar overlaps content on iPhone SE...",
    "priority": "high",
    "agent_id": "phoenix"
  }'

# Run it (use the task ID from the response)
curl -X POST http://localhost:3334/api/tasks/<task-id>/run

# Check status
curl http://localhost:3334/api/tasks/<task-id>

# View logs
curl http://localhost:3334/api/tasks/<task-id>/logs

# Stop a running agent
curl -X POST http://localhost:3334/api/agents/phoenix/stop
```

### Using Claude Code Directly

You can also bypass the dashboard entirely and run Claude Code in headless mode:

```bash
# Run Phoenix directly on the frontend repo
cd ~/sous/sous-frontend
npx @anthropic-ai/claude-code -p "Add a loading skeleton to the RecipesTab" --output-format text

# Run Forge directly on the backend repo
cd ~/sous/sous-backend
npx @anthropic-ai/claude-code -p "Add a GET /api/analytics/completions endpoint that returns checklist completion rates by day" --output-format text
```

---

## Project Structure

```
~/sous/
├── ember-agents/          ← This dashboard
│   ├── server/            ← Express API + agent dispatcher
│   ├── src/               ← React dashboard
│   ├── agents/
│   │   ├── agents.json    ← Agent team definitions
│   │   └── skills/
│   │       └── ember-restaurant/  ← Custom restaurant domain skill
│   └── ember-agents.db    ← SQLite task database
│
├── sous-frontend/         ← Ember frontend (React + Vite)
│   ├── CLAUDE.md          ← Agent context for frontend work
│   └── .claude/skills/    ← Symlinked skills
│
├── sous-backend/          ← Ember backend (Express + PostgreSQL)
│   ├── CLAUDE.md          ← Agent context for backend work
│   └── .claude/skills/    ← Symlinked skills
│
└── ember-landing/         ← Landing page
```

---

## Installed Skills

These enhance what your agents can do:

| Skill | Purpose |
|-------|---------|
| **ember-restaurant** | Custom restaurant/kitchen domain knowledge |
| **vercel-react-best-practices** | 58 React performance optimization rules |
| **frontend-design** | Production-grade UI design guidelines |
| **web-design-guidelines** | 100+ accessibility/UX audit rules |
| **webapp-testing** | Playwright E2E testing toolkit |
| **deploy-to-vercel** | Automated Vercel deployment |
| **vercel-composition-patterns** | React component architecture |
| **mcp-builder** | Build custom MCP tools |
| **find-skills** | Discover and install new skills |

---

## Customizing Agents

Edit `~/sous/ember-agents/agents/agents.json` to:

- **Change system prompts** — Adjust how agents approach tasks
- **Add new agents** — Create specialists (e.g., a "Marketing" agent for landing page copy)
- **Change working directories** — Point agents at different repos
- **Assign skills** — Control which skills each agent uses

After editing, restart the server (`npm run dev`).

### Example: Adding a New Agent

```json
{
  "id": "scribe",
  "name": "Scribe",
  "role": "Documentation Writer",
  "avatar": "📝",
  "color": "#06b6d4",
  "description": "Writes docs, README files, API documentation, and onboarding guides.",
  "workdir": "~/sous/sous-frontend",
  "skills": [],
  "systemPrompt": "You are Scribe, a technical writer for Ember..."
}
```

---

## Troubleshooting

### Agent fails immediately
- Check the **Logs** tab on the task detail for error messages
- Common: missing dependencies, wrong file paths, API key issues

### Agent takes too long
- Click **Stop** on the agent in the sidebar
- Break the task into smaller, more focused subtasks

### Dashboard won't start
```bash
cd ~/sous/ember-agents
npm install          # Reinstall deps
npm run dev          # Restart
```

### Agent output is empty
- The agent may have completed but produced no text output
- Check the actual repo for file changes: `cd ~/sous/sous-frontend && git diff`

---

## Best Practices

1. **One task = one focused change.** Don't ask an agent to "refactor the entire frontend." Ask it to "extract the checklist completion logic from OpeningTab.jsx into a useChecklistCompletion hook."

2. **Review before deploying.** Check `git diff` in the repo after an agent runs. Agents are good but not perfect.

3. **Use the right agent.** Phoenix for UI, Forge for API, Sentinel for testing. Mismatched agents waste time.

4. **Keep CLAUDE.md updated.** When you add major features or change architecture, update the CLAUDE.md files so agents stay in sync.

5. **Chain tasks for big features.** Backend first (Forge), then frontend (Phoenix), then review (Prism), then test (Sentinel), then deploy (Atlas).

6. **Start with high-priority, low-risk tasks.** Let agents build confidence on small tasks before giving them critical features.
