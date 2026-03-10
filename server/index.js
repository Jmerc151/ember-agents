import express from 'express'
import cors from 'cors'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import db from './db.js'
import { v4 as uuid } from 'uuid'
import { readFileSync } from 'fs'
import Anthropic from '@anthropic-ai/sdk'
import webpush from 'web-push'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()

// CORS — allow Netlify frontend
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3333,http://localhost:5173,https://ember-agents.netlify.app').split(',')
app.use(cors({ origin: ALLOWED_ORIGINS }))
app.use(express.json())

// ── Auth middleware ────────────────────────────────
const API_KEY = process.env.EMBER_API_KEY
if (API_KEY) {
  app.use('/api', (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '')
    if (token !== API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    next()
  })
  console.log('🔒 Auth enabled — requests require Bearer token')
} else {
  console.log('⚠️  No EMBER_API_KEY set — API is open (set it in production!)')
}

// Anthropic client
const anthropic = new Anthropic() // uses ANTHROPIC_API_KEY env var

// Web Push setup
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || 'BJzTO_33QaJQKmSo6s639IQ8O3VdYIYB2AgcMmGA_6zroPrWL8UHho56bOqSp6pav6YGVFkdwe15ZnmVW6Z8W3M'
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || 'vkrHsFUbb4ZnhroYqUA5MzZzu8cbK1ZnTlltkf6_ixg'
webpush.setVapidDetails('mailto:ember@agents.app', VAPID_PUBLIC, VAPID_PRIVATE)

// In-memory push subscriptions (reset on restart, which is fine for free tier)
const pushSubscriptions = new Set()

function sendPushToAll(payload) {
  for (const sub of pushSubscriptions) {
    webpush.sendNotification(JSON.parse(sub), JSON.stringify(payload)).catch(() => {
      pushSubscriptions.delete(sub)
    })
  }
}

// Load agent configs
const agentsPath = join(__dirname, '..', 'agents', 'agents.json')
const agents = JSON.parse(readFileSync(agentsPath, 'utf8'))

// Active agent runs (in-memory tracking)
const activeRuns = new Map()

// ── Auto Task Generation ────────────────────────────
async function generateFollowUpTasks(completedTask, agent, output) {
  try {
    const allTasks = db.prepare('SELECT title, status, agent_id FROM tasks ORDER BY created_at DESC LIMIT 20').all()
    const taskContext = allTasks.map(t => `- [${t.status}] ${t.title}`).join('\n')

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: `You are a technical project manager for Ember, a restaurant kitchen management SaaS (React 19 + Vite frontend, Express + PostgreSQL backend).

Available agents and their specialties:
${agents.map(a => `- ${a.id}: ${a.name} (${a.role}) — ${a.description}`).join('\n')}

Generate 1-3 follow-up tasks based on completed work. Each task should be actionable, specific, and assigned to the most appropriate agent. Focus on real improvements: bug fixes, tests, optimizations, new features, or polish.

IMPORTANT: Do NOT duplicate existing tasks. Do NOT create vague tasks. Each must be concrete enough for an agent to execute.

Respond with ONLY valid JSON — an array of objects with: title, description, agent_id, priority (low/medium/high)`,
      messages: [{
        role: 'user',
        content: `Completed task: "${completedTask.title}"
Agent: ${agent.name} (${agent.role})

Output summary (first 2000 chars):
${output.slice(0, 2000)}

Existing tasks (avoid duplicates):
${taskContext}

Generate follow-up tasks as JSON array:`
      }]
    })

    const text = response.content.map(b => b.type === 'text' ? b.text : '').join('')
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return

    const newTasks = JSON.parse(jsonMatch[0])
    const created = []

    for (const t of newTasks.slice(0, 3)) {
      // Validate agent_id exists
      const validAgent = agents.find(a => a.id === t.agent_id)
      if (!validAgent || !t.title) continue

      const id = uuid()
      db.prepare(`
        INSERT INTO tasks (id, title, description, priority, agent_id, status)
        VALUES (?, ?, ?, ?, ?, 'todo')
      `).run(id, t.title, t.description || '', t.priority || 'medium', t.agent_id)
      created.push({ title: t.title, agent: validAgent.name })
    }

    if (created.length > 0) {
      const taskList = created.map(t => `• ${t.title} → ${t.agent}`).join('\n')
      db.prepare('INSERT INTO messages (sender_id, sender_name, sender_avatar, sender_color, text) VALUES (?, ?, ?, ?, ?)')
        .run('system', '🧠 Task Planner', '🧠', '#a855f7', `Generated ${created.length} follow-up task${created.length > 1 ? 's' : ''}:\n${taskList}`)

      console.log(`🧠 Auto-generated ${created.length} follow-up tasks from "${completedTask.title}"`)
    }
  } catch (err) {
    console.error('Auto-task generation failed:', err.message)
  }
}

// ── QA Review — Sentinel auto-reviews completed work ────────
async function reviewCompletedWork(completedTask, agent, output) {
  try {
    // Don't review Sentinel's own work (avoid infinite loop)
    if (agent.id === 'sentinel') return

    const sentinel = agents.find(a => a.id === 'sentinel')
    if (!sentinel) return

    db.prepare('INSERT INTO task_logs (task_id, agent_id, message, type) VALUES (?, ?, ?, ?)')
      .run(completedTask.id, 'sentinel', 'Sentinel is reviewing this work...', 'info')

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: `You are Sentinel, a senior QA engineer reviewing work output from the Ember development team (restaurant kitchen management SaaS — React 19 + Vite frontend, Express + PostgreSQL backend).

Your job is to review the agent's work output and evaluate:
1. **Correctness** — Does the code/plan look correct? Any bugs or logic errors?
2. **Completeness** — Did it fully address the task requirements?
3. **Quality** — Code style, best practices, edge cases, error handling?
4. **Security** — Any SQL injection, XSS, auth issues, data leaks?
5. **Performance** — Any obvious performance problems?

Provide a clear verdict and score. Be specific about issues found.

Format your response as:
**Score: X/10**
**Verdict: PASS | NEEDS WORK | FAIL**

Then explain your findings concisely. If NEEDS WORK or FAIL, list specific issues that need fixing.`,
      messages: [{
        role: 'user',
        content: `Review this completed work:

**Task:** ${completedTask.title}
**Agent:** ${agent.name} (${agent.role})
**Description:** ${completedTask.description || 'No description'}

**Agent Output (first 4000 chars):**
${output.slice(0, 4000)}`
      }]
    })

    const review = response.content.map(b => b.type === 'text' ? b.text : '').join('')

    // Extract verdict
    const verdictMatch = review.match(/Verdict:\s*(PASS|NEEDS WORK|FAIL)/i)
    const scoreMatch = review.match(/Score:\s*(\d+)\/10/i)
    const verdict = verdictMatch ? verdictMatch[1].toUpperCase() : 'UNKNOWN'
    const score = scoreMatch ? parseInt(scoreMatch[1]) : null

    // Log the review
    db.prepare('INSERT INTO task_logs (task_id, agent_id, message, type) VALUES (?, ?, ?, ?)')
      .run(completedTask.id, 'sentinel', review.slice(0, 5000), verdict === 'PASS' ? 'success' : 'warning')

    // Post review to chat
    const emoji = verdict === 'PASS' ? '✅' : verdict === 'FAIL' ? '🚨' : '⚠️'
    const shortReview = review.length > 500 ? review.slice(0, 500) + '…' : review
    db.prepare('INSERT INTO messages (sender_id, sender_name, sender_avatar, sender_color, text) VALUES (?, ?, ?, ?, ?)')
      .run('sentinel', sentinel.name, sentinel.avatar, sentinel.color,
        `${emoji} **Review of "${completedTask.title}"** (by ${agent.name}):\n\n${shortReview}`)

    // If FAIL or low score, create a fix task for the original agent
    if (verdict === 'FAIL' || (score !== null && score <= 4)) {
      const fixId = uuid()
      db.prepare(`
        INSERT INTO tasks (id, title, description, priority, agent_id, status)
        VALUES (?, ?, ?, 'high', ?, 'todo')
      `).run(fixId, `Fix issues: ${completedTask.title}`, `Sentinel review found critical issues:\n\n${review.slice(0, 2000)}`, agent.id)

      db.prepare('INSERT INTO messages (sender_id, sender_name, sender_avatar, sender_color, text) VALUES (?, ?, ?, ?, ?)')
        .run('sentinel', sentinel.name, sentinel.avatar, sentinel.color,
          `🔁 Created fix task for ${agent.name}: issues found in "${completedTask.title}"`)

      console.log(`🛡️ Sentinel FAILED "${completedTask.title}" — fix task created for ${agent.name}`)
    }

    console.log(`🛡️ Sentinel reviewed "${completedTask.title}": ${verdict} ${score ? `(${score}/10)` : ''}`)
  } catch (err) {
    console.error('QA review failed:', err.message)
  }
}

// ── Agents ─────────────────────────────────────────
app.get('/api/agents', (req, res) => {
  const taskCounts = db.prepare(`
    SELECT agent_id, status, COUNT(*) as count
    FROM tasks WHERE agent_id IS NOT NULL
    GROUP BY agent_id, status
  `).all()

  const enriched = agents.map(agent => {
    const counts = taskCounts.filter(t => t.agent_id === agent.id)
    return {
      ...agent,
      taskCounts: {
        active: counts.filter(c => c.status === 'in_progress').reduce((s, c) => s + c.count, 0),
        completed: counts.filter(c => c.status === 'done').reduce((s, c) => s + c.count, 0),
        total: counts.reduce((s, c) => s + c.count, 0)
      },
      isRunning: activeRuns.has(agent.id)
    }
  })
  res.json(enriched)
})

// ── Tasks CRUD ─────────────────────────────────────
app.get('/api/tasks', (req, res) => {
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all()
  res.json(tasks)
})

app.post('/api/tasks', (req, res) => {
  const { title, description, priority, agent_id } = req.body
  const id = uuid()
  db.prepare(`
    INSERT INTO tasks (id, title, description, priority, agent_id, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, title, description || '', priority || 'medium', agent_id || null, agent_id ? 'todo' : 'backlog')

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
  res.status(201).json(task)
})

app.patch('/api/tasks/:id', (req, res) => {
  const { id } = req.params
  const fields = req.body
  const sets = []
  const vals = []

  for (const [key, val] of Object.entries(fields)) {
    if (['title', 'description', 'status', 'priority', 'agent_id', 'output', 'error', 'started_at', 'completed_at'].includes(key)) {
      sets.push(`${key} = ?`)
      vals.push(val)
    }
  }

  if (sets.length === 0) return res.status(400).json({ error: 'No valid fields' })

  sets.push("updated_at = datetime('now')")
  vals.push(id)

  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
  res.json(task)
})

app.delete('/api/tasks/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// ── Task Logs ──────────────────────────────────────
app.get('/api/tasks/:id/logs', (req, res) => {
  const logs = db.prepare('SELECT * FROM task_logs WHERE task_id = ? ORDER BY created_at ASC').all(req.params.id)
  res.json(logs)
})

// ── Run Agent (Anthropic API) ─────────────────────
app.post('/api/tasks/:id/run', async (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)
  if (!task) return res.status(404).json({ error: 'Task not found' })
  if (!task.agent_id) return res.status(400).json({ error: 'No agent assigned' })

  const agent = agents.find(a => a.id === task.agent_id)
  if (!agent) return res.status(400).json({ error: 'Agent not found' })

  if (activeRuns.has(agent.id)) {
    return res.status(409).json({ error: `${agent.name} is already running a task` })
  }

  // Update task status
  db.prepare("UPDATE tasks SET status = 'in_progress', started_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(task.id)
  db.prepare('INSERT INTO task_logs (task_id, agent_id, message, type) VALUES (?, ?, ?, ?)').run(task.id, agent.id, `Agent ${agent.name} started working...`, 'info')

  // Track this run
  const abortController = new AbortController()
  activeRuns.set(agent.id, { taskId: task.id, abort: abortController })

  res.json({ ok: true, message: `Agent ${agent.name} is working on it` })

  // Run async — don't block the response
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: agent.systemPrompt,
      messages: [{
        role: 'user',
        content: `Task: ${task.title}\n\nDetails: ${task.description || 'No additional details.'}\n\nPlease analyze this task and provide a detailed plan with code changes needed. Since you don't have direct file access, provide complete code snippets and clear instructions for implementation.`
      }],
    }, { signal: abortController.signal })

    const output = response.content.map(b => b.type === 'text' ? b.text : '').join('\n')

    activeRuns.delete(agent.id)
    db.prepare(`UPDATE tasks SET status = 'done', output = ?, completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
      .run(output.slice(0, 50000), task.id)
    db.prepare('INSERT INTO task_logs (task_id, agent_id, message, type) VALUES (?, ?, ?, ?)')
      .run(task.id, agent.id, 'Task completed successfully', 'success')

    // Post completion to chat with summary
    const summary = output.length > 300 ? output.slice(0, 300) + '…' : output
    db.prepare('INSERT INTO messages (sender_id, sender_name, sender_avatar, sender_color, text) VALUES (?, ?, ?, ?, ?)')
      .run(agent.id, agent.name, agent.avatar, agent.color, `✅ Finished: "${task.title}"\n\n${summary}`)

    // Push notification
    sendPushToAll({
      title: `${agent.avatar} ${agent.name} finished`,
      body: task.title,
      tag: `task-done-${task.id}`,
      taskId: task.id
    })

    // QA Review — Sentinel checks the work, then generate follow-ups
    reviewCompletedWork(task, agent, output)
      .then(() => generateFollowUpTasks(task, agent, output))
      .catch(() => {})
  } catch (err) {
    activeRuns.delete(agent.id)
    const errorMsg = err.name === 'AbortError' ? 'Stopped by user' : err.message
    db.prepare(`UPDATE tasks SET status = 'failed', error = ?, completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
      .run(errorMsg, task.id)
    db.prepare('INSERT INTO task_logs (task_id, agent_id, message, type) VALUES (?, ?, ?, ?)')
      .run(task.id, agent.id, `Task failed: ${errorMsg}`, 'error')

    // Post failure to chat
    db.prepare('INSERT INTO messages (sender_id, sender_name, sender_avatar, sender_color, text) VALUES (?, ?, ?, ?, ?)')
      .run(agent.id, agent.name, agent.avatar, agent.color, `❌ Failed: "${task.title}" — ${errorMsg}`)

    // Push notification
    sendPushToAll({
      title: `${agent.avatar} ${agent.name} failed`,
      body: `${task.title} — ${errorMsg}`,
      tag: `task-fail-${task.id}`,
      taskId: task.id
    })
  }
})

// ── Stop Agent ─────────────────────────────────────
app.post('/api/agents/:id/stop', (req, res) => {
  const entry = activeRuns.get(req.params.id)
  if (!entry) return res.status(404).json({ error: 'Agent not running' })

  entry.abort.abort()
  activeRuns.delete(req.params.id)

  db.prepare("UPDATE tasks SET status = 'failed', error = 'Stopped by user', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
    .run(entry.taskId)

  res.json({ ok: true })
})

// ── Stats ──────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as count FROM tasks').get().count
  const byStatus = db.prepare('SELECT status, COUNT(*) as count FROM tasks GROUP BY status').all()
  const byAgent = db.prepare('SELECT agent_id, COUNT(*) as count FROM tasks WHERE agent_id IS NOT NULL GROUP BY agent_id').all()
  const recent = db.prepare("SELECT * FROM tasks WHERE completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 5").all()

  res.json({ total, byStatus, byAgent, recent })
})

// ── Chat Messages ─────────────────────────────────
app.get('/api/messages', (req, res) => {
  const messages = db.prepare('SELECT * FROM messages ORDER BY created_at ASC LIMIT 200').all()
  res.json(messages)
})

app.post('/api/messages', (req, res) => {
  const { sender_id, sender_name, sender_avatar, sender_color, text } = req.body
  if (!text?.trim()) return res.status(400).json({ error: 'Message text required' })

  db.prepare('INSERT INTO messages (sender_id, sender_name, sender_avatar, sender_color, text) VALUES (?, ?, ?, ?, ?)')
    .run(sender_id || 'user', sender_name || 'You', sender_avatar || '👤', sender_color || '#a8a29e', text.trim())

  const msg = db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 1').get()
  res.status(201).json(msg)
})

app.delete('/api/messages', (req, res) => {
  db.prepare('DELETE FROM messages').run()
  res.json({ ok: true })
})

// ── Team Standup (Anthropic API) ──────────────────
app.post('/api/chat/standup', async (req, res) => {
  const recentDone = db.prepare("SELECT title, agent_id FROM tasks WHERE status = 'done' ORDER BY completed_at DESC LIMIT 5").all()
  const inProgress = db.prepare("SELECT title, agent_id FROM tasks WHERE status = 'in_progress'").all()
  const todo = db.prepare("SELECT title, agent_id FROM tasks WHERE status = 'todo'").all()
  const failed = db.prepare("SELECT title, agent_id FROM tasks WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 3").all()

  const taskContext = [
    recentDone.length ? `Recently completed: ${recentDone.map(t => `"${t.title}" (${t.agent_id})`).join(', ')}` : 'No recently completed tasks.',
    inProgress.length ? `In progress: ${inProgress.map(t => `"${t.title}" (${t.agent_id})`).join(', ')}` : 'Nothing currently in progress.',
    todo.length ? `Queued: ${todo.map(t => `"${t.title}" (${t.agent_id})`).join(', ')}` : 'Nothing queued.',
    failed.length ? `Failed: ${failed.map(t => `"${t.title}" (${t.agent_id})`).join(', ')}` : '',
  ].filter(Boolean).join('\n')

  const agentProfiles = agents.map(a => `- ${a.avatar} ${a.name} (${a.role}): ${a.description}`).join('\n')

  db.prepare('INSERT INTO messages (sender_id, sender_name, sender_avatar, sender_color, text) VALUES (?, ?, ?, ?, ?)')
    .run('system', 'System', '📋', '#78716c', 'Team standup starting...')

  res.json({ ok: true, message: 'Standup initiated' })

  // Run async
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `You are simulating a quick team standup meeting between ${agents.length} AI agents working on Ember, a restaurant kitchen management SaaS. Each agent has a distinct personality and role.

The team:
${agentProfiles}

Current project status:
${taskContext}

Generate a natural, brief team standup conversation. Each agent should speak 1-2 times. They should:
- Report what they've been working on (reference actual tasks if any)
- Mention what they plan to work on next
- Ask questions or offer help to other agents when relevant
- Be concise and natural — like a real dev team standup

CRITICAL FORMAT: Output ONLY lines in this exact format, one per message. No other text:
${agents.map(a => a.name.toUpperCase() + ': message text here').join('\n')}

Keep it to 8-12 messages total. Be conversational and specific.`
      }]
    })

    const output = response.content.map(b => b.type === 'text' ? b.text : '').join('\n')
    const agentMap = {}
    for (const a of agents) agentMap[a.name.toUpperCase()] = a

    const lines = output.split('\n').filter(l => l.trim())
    let delay = 0

    for (const line of lines) {
      const agentPattern = agents.map(a => a.name.toUpperCase()).join('|')
      const match = line.match(new RegExp(`^(${agentPattern}):\\s*(.+)`, 'i'))
      if (!match) continue
      const agent = agentMap[match[1].toUpperCase()]
      if (!agent) continue
      const text = match[2].trim()
      if (!text) continue

      setTimeout(() => {
        db.prepare('INSERT INTO messages (sender_id, sender_name, sender_avatar, sender_color, text) VALUES (?, ?, ?, ?, ?)')
          .run(agent.id, agent.name, agent.avatar, agent.color, text)
      }, delay)
      delay += 800
    }

    setTimeout(() => {
      db.prepare('INSERT INTO messages (sender_id, sender_name, sender_avatar, sender_color, text) VALUES (?, ?, ?, ?, ?)')
        .run('system', 'System', '✅', '#78716c', 'Standup complete.')
    }, delay + 500)
  } catch (err) {
    db.prepare('INSERT INTO messages (sender_id, sender_name, sender_avatar, sender_color, text) VALUES (?, ?, ?, ?, ?)')
      .run('system', 'System', '⚠️', '#78716c', `Standup failed: ${err.message}`)
  }
})

// ── Push Notifications ───────────────────────────
app.get('/api/push/vapid-key', (req, res) => {
  res.json({ key: VAPID_PUBLIC })
})

app.post('/api/push/subscribe', (req, res) => {
  const sub = JSON.stringify(req.body)
  pushSubscriptions.add(sub)
  res.json({ ok: true })
})

// ── Health check ──────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), agents: agents.length })
})

// ── Serve static in production ────────────────────
if (process.env.NODE_ENV === 'production') {
  const distPath = join(__dirname, '..', 'dist')
  app.use(express.static(distPath))
  app.get('/{*splat}', (req, res) => {
    res.sendFile(join(distPath, 'index.html'))
  })
}

const PORT = process.env.PORT || process.env.API_PORT || 3334
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🔥 Ember Agents server running on port ${PORT}`)
})
