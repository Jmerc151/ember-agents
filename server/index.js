import express from 'express'
import cors from 'cors'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import db from './db.js'
import { v4 as uuid } from 'uuid'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
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

// ══════════════════════════════════════════════════════
// ██ IMPROVEMENT 1: AGENT MEMORY (OpenClaw-inspired) ██
// ══════════════════════════════════════════════════════
// Persistent markdown memory per agent — survives restarts
// Agents remember what they've learned across tasks

const MEMORY_DIR = join(__dirname, '..', 'memory')
mkdirSync(MEMORY_DIR, { recursive: true })

function getAgentMemoryPath(agentId) {
  return join(MEMORY_DIR, `${agentId}.md`)
}

function readAgentMemory(agentId) {
  const path = getAgentMemoryPath(agentId)
  if (!existsSync(path)) return ''
  return readFileSync(path, 'utf8')
}

function writeAgentMemory(agentId, content) {
  writeFileSync(getAgentMemoryPath(agentId), content, 'utf8')
}

function appendAgentMemory(agentId, entry) {
  const existing = readAgentMemory(agentId)
  const timestamp = new Date().toISOString().slice(0, 16)
  const newEntry = `\n## [${timestamp}] ${entry.title}\n${entry.content}\n`
  writeAgentMemory(agentId, existing + newEntry)
}

// After task completion, ask Claude to extract learnings for memory
async function updateAgentMemory(agent, task, output) {
  try {
    const currentMemory = readAgentMemory(agent.id)

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: `You are a memory curator for ${agent.name} (${agent.role}). Extract the most important learnings, decisions, and context from completed work that would help this agent perform better on future tasks.

Rules:
- Be concise — bullet points, not paragraphs
- Focus on: patterns discovered, decisions made, gotchas found, architecture notes
- Skip generic knowledge — only save project-specific insights
- If nothing new was learned, respond with just "NOTHING_NEW"

Respond with ONLY the memory entry content (markdown bullets).`,
      messages: [{
        role: 'user',
        content: `Task completed: "${task.title}"
Output (first 2000 chars): ${output.slice(0, 2000)}

Current memory (for context — avoid duplicates):
${currentMemory.slice(-2000) || '(empty)'}`
      }]
    })

    const text = response.content.map(b => b.type === 'text' ? b.text : '').join('')
    if (text.includes('NOTHING_NEW')) return

    appendAgentMemory(agent.id, { title: task.title, content: text.slice(0, 1000) })
    console.log(`🧠 Memory updated for ${agent.name}`)
  } catch (err) {
    console.error(`Memory update failed for ${agent.name}:`, err.message)
  }
}


// ══════════════════════════════════════════════════════
// ██ IMPROVEMENT 2: TASK QUEUE (OpenClaw Lane Queue) ██
// ══════════════════════════════════════════════════════
// Per-agent serial queue — when one task finishes, auto-run the next
// No more clicking "Run" for each task!

const agentQueues = new Map() // agentId → { processing: boolean }

async function processAgentQueue(agentId) {
  if (agentQueues.get(agentId)?.processing) return // already processing
  agentQueues.set(agentId, { processing: true })

  try {
    // Find next 'todo' task for this agent
    const nextTask = db.prepare(
      "SELECT * FROM tasks WHERE agent_id = ? AND status = 'todo' ORDER BY priority = 'critical' DESC, priority = 'high' DESC, priority = 'medium' DESC, created_at ASC LIMIT 1"
    ).get(agentId)

    if (!nextTask) {
      agentQueues.set(agentId, { processing: false })
      return
    }

    // Don't auto-run if agent is busy
    if (activeRuns.has(agentId)) {
      agentQueues.set(agentId, { processing: false })
      return
    }

    console.log(`📋 Queue: auto-running "${nextTask.title}" for ${agentId}`)

    // Trigger the task run via internal fetch
    try {
      const PORT = process.env.PORT || process.env.API_PORT || 3334
      await fetch(`http://localhost:${PORT}/api/tasks/${nextTask.id}/run`, { method: 'POST' })
    } catch (e) {
      console.error('Queue auto-run failed:', e.message)
    }
  } finally {
    agentQueues.set(agentId, { processing: false })
  }
}

// Check all agent queues periodically (every 30 seconds)
setInterval(() => {
  for (const agent of agents) {
    if (!activeRuns.has(agent.id)) {
      processAgentQueue(agent.id)
    }
  }
}, 30000)


// ══════════════════════════════════════════════════════
// ██ IMPROVEMENT 5: INTER-AGENT CHAT                 ██
// ══════════════════════════════════════════════════════
// Agents can consult each other mid-task via structured queries

async function agentConsult(fromAgent, toAgentId, question, taskContext) {
  const toAgent = agents.find(a => a.id === toAgentId)
  if (!toAgent) return null

  try {
    const toMemory = readAgentMemory(toAgentId)

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: `${toAgent.systemPrompt}

You are being consulted by ${fromAgent.name} (${fromAgent.role}) about a task they're working on. Answer their question using your expertise. Be concise and actionable.

Your accumulated knowledge:
${toMemory.slice(-1500) || '(no prior knowledge)'}`,
      messages: [{
        role: 'user',
        content: `Question from ${fromAgent.name}:\n${question}\n\nTask context:\n${taskContext}`
      }]
    })

    const answer = response.content.map(b => b.type === 'text' ? b.text : '').join('')

    // Log the consultation to chat
    db.prepare('INSERT INTO messages (sender_id, sender_name, sender_avatar, sender_color, text) VALUES (?, ?, ?, ?, ?)')
      .run(fromAgent.id, fromAgent.name, fromAgent.avatar, fromAgent.color,
        `💬 @${toAgent.name}: ${question.slice(0, 200)}`)
    db.prepare('INSERT INTO messages (sender_id, sender_name, sender_avatar, sender_color, text) VALUES (?, ?, ?, ?, ?)')
      .run(toAgent.id, toAgent.name, toAgent.avatar, toAgent.color,
        `↩️ Re: ${fromAgent.name}'s question:\n${answer.slice(0, 500)}`)

    return answer
  } catch (err) {
    console.error(`Consultation ${fromAgent.id} → ${toAgentId} failed:`, err.message)
    return null
  }
}


// ── Auto Task Generation ────────────────────────────
// Guards against infinite recursion:
//   1. MAX_TASK_DEPTH: follow-ups of follow-ups are NOT allowed (depth > 1 = stop)
//   2. DAILY_TASK_CAP: max new tasks created per day
//   3. PENDING_TASK_CAP: stop if too many tasks already queued
const MAX_TASK_DEPTH = 1      // 0 = original, 1 = first follow-up, no deeper
const DAILY_TASK_CAP = 20     // max auto-generated tasks per day
const PENDING_TASK_CAP = 30   // stop generating if this many todo tasks exist

async function generateFollowUpTasks(completedTask, agent, output) {
  try {
    // ── Guard 1: Depth limit ──
    const taskDepth = completedTask.depth || 0
    if (taskDepth >= MAX_TASK_DEPTH) {
      console.log(`🧠 Skipping follow-up generation: "${completedTask.title}" is at depth ${taskDepth} (max: ${MAX_TASK_DEPTH})`)
      return
    }

    // ── Guard 2: Daily cap ──
    const todayCount = db.prepare(
      "SELECT COUNT(*) as count FROM tasks WHERE created_at >= date('now') AND depth > 0"
    ).get().count
    if (todayCount >= DAILY_TASK_CAP) {
      console.log(`🧠 Skipping follow-up generation: daily cap reached (${todayCount}/${DAILY_TASK_CAP})`)
      return
    }

    // ── Guard 3: Pending task cap ──
    const pendingCount = db.prepare(
      "SELECT COUNT(*) as count FROM tasks WHERE status = 'todo'"
    ).get().count
    if (pendingCount >= PENDING_TASK_CAP) {
      console.log(`🧠 Skipping follow-up generation: ${pendingCount} tasks already queued (max: ${PENDING_TASK_CAP})`)
      return
    }

    // How many we're allowed to create (respect both caps)
    const remainingDaily = DAILY_TASK_CAP - todayCount
    const remainingPending = PENDING_TASK_CAP - pendingCount
    const maxToCreate = Math.min(3, remainingDaily, remainingPending)
    if (maxToCreate <= 0) return

    const allTasks = db.prepare('SELECT title, status, agent_id FROM tasks ORDER BY created_at DESC LIMIT 30').all()
    const taskContext = allTasks.map(t => `- [${t.status}] ${t.title}`).join('\n')

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: `You are a technical project manager for Ember, a restaurant kitchen management SaaS (React 19 + Vite frontend, Express + PostgreSQL backend).

Available agents and their specialties:
${agents.map(a => `- ${a.id}: ${a.name} (${a.role}) — ${a.description}`).join('\n')}

Generate 1-${maxToCreate} follow-up tasks based on completed work. Each task should be:
- HIGH-IMPACT: Real features, critical bugs, or important infrastructure — not micro-optimizations
- DISTINCT: Meaningfully different from existing tasks — not slight variations
- ACTIONABLE: Concrete enough for an agent to execute independently

Do NOT generate:
- Tests for tests, or reviews of reviews (no recursive meta-tasks)
- Minor polish or cosmetic improvements
- Tasks that are slight variations of existing ones (check the list carefully)

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
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return

    const newTasks = JSON.parse(jsonMatch[0])
    const created = []
    const newDepth = taskDepth + 1

    for (const t of newTasks.slice(0, maxToCreate)) {
      const validAgent = agents.find(a => a.id === t.agent_id)
      if (!validAgent || !t.title) continue

      const id = uuid()
      db.prepare(`
        INSERT INTO tasks (id, title, description, priority, agent_id, status, depth)
        VALUES (?, ?, ?, ?, ?, 'todo', ?)
      `).run(id, t.title, t.description || '', t.priority || 'medium', t.agent_id, newDepth)
      created.push({ title: t.title, agent: validAgent.name, agentId: t.agent_id })
    }

    if (created.length > 0) {
      const taskList = created.map(t => `• ${t.title} → ${t.agent}`).join('\n')
      db.prepare('INSERT INTO messages (sender_id, sender_name, sender_avatar, sender_color, text) VALUES (?, ?, ?, ?, ?)')
        .run('system', '🧠 Task Planner', '🧠', '#a855f7', `Generated ${created.length} follow-up task${created.length > 1 ? 's' : ''} (depth ${newDepth}, ${todayCount + created.length}/${DAILY_TASK_CAP} today):\n${taskList}`)

      console.log(`🧠 Auto-generated ${created.length} follow-up tasks from "${completedTask.title}" (depth ${newDepth}, daily: ${todayCount + created.length}/${DAILY_TASK_CAP})`)

      // Trigger queue processing for agents that got new tasks
      const affectedAgents = [...new Set(created.map(t => t.agentId))]
      for (const agentId of affectedAgents) {
        setTimeout(() => processAgentQueue(agentId), 5000)
      }
    }
  } catch (err) {
    console.error('Auto-task generation failed:', err.message)
  }
}

// ── QA Review — Sentinel auto-reviews completed work ────────
async function reviewCompletedWork(completedTask, agent, output) {
  try {
    if (agent.id === 'sentinel') return

    const sentinel = agents.find(a => a.id === 'sentinel')
    if (!sentinel) return

    const sentinelMemory = readAgentMemory('sentinel')

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

Your accumulated review knowledge:
${sentinelMemory.slice(-1500) || '(no prior reviews)'}

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

    const verdictMatch = review.match(/Verdict:\s*(PASS|NEEDS WORK|FAIL)/i)
    const scoreMatch = review.match(/Score:\s*(\d+)\/10/i)
    const verdict = verdictMatch ? verdictMatch[1].toUpperCase() : 'UNKNOWN'
    const score = scoreMatch ? parseInt(scoreMatch[1]) : null

    db.prepare('INSERT INTO task_logs (task_id, agent_id, message, type) VALUES (?, ?, ?, ?)')
      .run(completedTask.id, 'sentinel', review.slice(0, 5000), verdict === 'PASS' ? 'success' : 'warning')

    const emoji = verdict === 'PASS' ? '✅' : verdict === 'FAIL' ? '🚨' : '⚠️'
    const shortReview = review.length > 500 ? review.slice(0, 500) + '…' : review
    db.prepare('INSERT INTO messages (sender_id, sender_name, sender_avatar, sender_color, text) VALUES (?, ?, ?, ?, ?)')
      .run('sentinel', sentinel.name, sentinel.avatar, sentinel.color,
        `${emoji} **Review of "${completedTask.title}"** (by ${agent.name}):\n\n${shortReview}`)

    if (verdict === 'FAIL' || (score !== null && score <= 4)) {
      const fixId = uuid()
      db.prepare(`
        INSERT INTO tasks (id, title, description, priority, agent_id, status)
        VALUES (?, ?, ?, 'high', ?, 'todo')
      `).run(fixId, `Fix issues: ${completedTask.title}`, `Sentinel review found critical issues:\n\n${review.slice(0, 2000)}`, agent.id)

      db.prepare('INSERT INTO messages (sender_id, sender_name, sender_avatar, sender_color, text) VALUES (?, ?, ?, ?, ?)')
        .run('sentinel', sentinel.name, sentinel.avatar, sentinel.color,
          `🔁 Created fix task for ${agent.name}: issues found in "${completedTask.title}"`)

      // Trigger queue for the agent that needs to fix
      setTimeout(() => processAgentQueue(agent.id), 5000)
    }

    console.log(`🛡️ Sentinel reviewed "${completedTask.title}": ${verdict} ${score ? `(${score}/10)` : ''}`)
  } catch (err) {
    console.error('QA review failed:', err.message)
  }
}

// ── Auto-Troubleshoot & Retry Failed Tasks ──────────
const MAX_RETRIES = 2

async function troubleshootAndRetry(failedTask, agent, errorMsg) {
  try {
    const retries = failedTask.retries || 0
    if (retries >= MAX_RETRIES) {
      db.prepare('INSERT INTO messages (sender_id, sender_name, sender_avatar, sender_color, text) VALUES (?, ?, ?, ?, ?)')
        .run('system', '🔧 Troubleshooter', '🔧', '#ef4444', `⛔ "${failedTask.title}" failed ${MAX_RETRIES} times — giving up. Needs manual review.`)
      console.log(`🔧 Max retries reached for "${failedTask.title}"`)
      return
    }

    const logs = db.prepare('SELECT message, type FROM task_logs WHERE task_id = ? ORDER BY created_at ASC').all(failedTask.id)
    const logContext = logs.map(l => `[${l.type}] ${l.message}`).join('\n')

    db.prepare('INSERT INTO task_logs (task_id, agent_id, message, type) VALUES (?, ?, ?, ?)')
      .run(failedTask.id, 'system', `Troubleshooting failure (attempt ${retries + 1}/${MAX_RETRIES})...`, 'info')

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: `You are a senior DevOps troubleshooter for Ember, a restaurant kitchen management SaaS (React 19 + Vite frontend, Express + PostgreSQL backend).

A task just failed. Your job is to:
1. Diagnose WHY it failed based on the error message and logs
2. Determine if it's retryable (transient error, rate limit, timeout) vs permanent (bad logic, missing dependency)
3. If retryable, provide an improved task description that avoids the failure
4. If permanent, explain what needs to change

Respond with ONLY valid JSON:
{
  "diagnosis": "Brief explanation of what went wrong",
  "retryable": true/false,
  "fix": "What to change to fix it",
  "improved_description": "Updated task description for retry (only if retryable)"
}`,
      messages: [{
        role: 'user',
        content: `Failed task: "${failedTask.title}"
Agent: ${agent.name} (${agent.role})
Original description: ${failedTask.description || 'No description'}

Error: ${errorMsg}

Task logs:
${logContext.slice(0, 2000)}`
      }]
    })

    const text = response.content.map(b => b.type === 'text' ? b.text : '').join('')
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return

    const diagnosis = JSON.parse(jsonMatch[0])

    db.prepare('INSERT INTO messages (sender_id, sender_name, sender_avatar, sender_color, text) VALUES (?, ?, ?, ?, ?)')
      .run('system', '🔧 Troubleshooter', '🔧', '#ef4444',
        `🔍 Diagnosed "${failedTask.title}":\n\n**Problem:** ${diagnosis.diagnosis}\n**Fix:** ${diagnosis.fix}\n**Retryable:** ${diagnosis.retryable ? 'Yes — retrying now' : 'No — needs manual intervention'}`)

    db.prepare('INSERT INTO task_logs (task_id, agent_id, message, type) VALUES (?, ?, ?, ?)')
      .run(failedTask.id, 'system', `Diagnosis: ${diagnosis.diagnosis}\nFix: ${diagnosis.fix}`, 'warning')

    if (diagnosis.retryable && diagnosis.improved_description) {
      const newDesc = `${diagnosis.improved_description}\n\n---\n⚠️ Previous attempt failed: ${diagnosis.diagnosis}\nFix applied: ${diagnosis.fix}`
      db.prepare(`UPDATE tasks SET status = 'todo', description = ?, error = '', retries = ?, completed_at = NULL, started_at = NULL, updated_at = datetime('now') WHERE id = ?`)
        .run(newDesc, retries + 1, failedTask.id)

      db.prepare('INSERT INTO task_logs (task_id, agent_id, message, type) VALUES (?, ?, ?, ?)')
        .run(failedTask.id, 'system', `Task reset for retry (${retries + 1}/${MAX_RETRIES}) with improved description`, 'info')

      // Queue will auto-pick it up
      setTimeout(() => processAgentQueue(agent.id), 5000)
    } else {
      db.prepare('INSERT INTO task_logs (task_id, agent_id, message, type) VALUES (?, ?, ?, ?)')
        .run(failedTask.id, 'system', 'Task requires manual intervention — not auto-retryable', 'error')
    }

    console.log(`🔧 Troubleshot "${failedTask.title}": ${diagnosis.retryable ? 'retrying' : 'needs manual fix'}`)
  } catch (err) {
    console.error('Troubleshooting failed:', err.message)
  }
}


// ══════════════════════════════════════════════════════
// ██ IMPROVEMENT 4: HEARTBEAT / CRON SCHEDULER       ██
// ══════════════════════════════════════════════════════
// Scheduled proactive tasks — agents wake up on their own

const heartbeatJobs = []

function registerHeartbeat(name, intervalMs, fn) {
  const id = setInterval(fn, intervalMs)
  heartbeatJobs.push({ name, id, intervalMs })
  console.log(`💓 Heartbeat registered: ${name} (every ${Math.round(intervalMs / 60000)}min)`)
}

// Daily standup at startup + every 8 hours
registerHeartbeat('auto-standup', 8 * 60 * 60 * 1000, async () => {
  try {
    const PORT = process.env.PORT || process.env.API_PORT || 3334
    await fetch(`http://localhost:${PORT}/api/chat/standup`, { method: 'POST' })
    console.log('💓 Auto-standup triggered')
  } catch (e) {
    console.error('Auto-standup failed:', e.message)
  }
})

// Queue monitor — every 60 seconds, check for idle agents with pending tasks
registerHeartbeat('queue-monitor', 60000, () => {
  for (const agent of agents) {
    if (!activeRuns.has(agent.id)) {
      const pendingCount = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE agent_id = ? AND status = 'todo'").get(agent.id)?.count || 0
      if (pendingCount > 0) {
        processAgentQueue(agent.id)
      }
    }
  }
})

// Memory compaction — every 24 hours, trim agent memories to prevent bloat
registerHeartbeat('memory-compaction', 24 * 60 * 60 * 1000, async () => {
  for (const agent of agents) {
    const memory = readAgentMemory(agent.id)
    if (memory.length > 10000) {
      try {
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2048,
          system: `Compact this agent memory to the most important 50% of content. Keep the most valuable learnings, remove redundant or outdated entries. Preserve markdown formatting.`,
          messages: [{ role: 'user', content: memory }]
        })
        const compacted = response.content.map(b => b.type === 'text' ? b.text : '').join('')
        writeAgentMemory(agent.id, compacted)
        console.log(`🧹 Compacted memory for ${agent.name}: ${memory.length} → ${compacted.length} chars`)
      } catch (e) {
        console.error(`Memory compaction failed for ${agent.name}:`, e.message)
      }
    }
  }
})


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
      isRunning: activeRuns.has(agent.id),
      hasMemory: readAgentMemory(agent.id).length > 0
    }
  })
  res.json(enriched)
})

// ── Agent Memory API ──────────────────────────────
app.get('/api/agents/:id/memory', (req, res) => {
  const memory = readAgentMemory(req.params.id)
  res.json({ agent_id: req.params.id, memory, length: memory.length })
})

app.delete('/api/agents/:id/memory', (req, res) => {
  writeAgentMemory(req.params.id, '')
  res.json({ ok: true, message: 'Memory cleared' })
})

// ── Inter-Agent Consult API ───────────────────────
app.post('/api/agents/:fromId/consult/:toId', async (req, res) => {
  const fromAgent = agents.find(a => a.id === req.params.fromId)
  const toAgent = agents.find(a => a.id === req.params.toId)
  if (!fromAgent || !toAgent) return res.status(404).json({ error: 'Agent not found' })

  const { question, context } = req.body
  if (!question) return res.status(400).json({ error: 'Question required' })

  res.json({ ok: true, message: `${fromAgent.name} is consulting ${toAgent.name}...` })

  const answer = await agentConsult(fromAgent, req.params.toId, question, context || '')
  if (answer) {
    console.log(`💬 ${fromAgent.name} consulted ${toAgent.name}`)
  }
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

  // Trigger queue if agent assigned
  if (agent_id) {
    setTimeout(() => processAgentQueue(agent_id), 2000)
  }
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

// ══════════════════════════════════════════════════════
// ██ IMPROVEMENT 3: ReAct LOOP (Reason → Act → Loop) ██
// ══════════════════════════════════════════════════════
// Multi-step reasoning instead of single-shot API call
// Agent can: think, consult other agents, search memory, iterate

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

  // ── ReAct Loop ──────────────────────────────────
  try {
    const agentMemory = readAgentMemory(agent.id)
    const MAX_STEPS = 3
    let messages = []
    let fullOutput = ''

    // Step 1: Initial reasoning with memory + context
    const initialPrompt = `Task: ${task.title}

Details: ${task.description || 'No additional details.'}

${agentMemory ? `## Your Memory (learnings from past tasks):\n${agentMemory.slice(-2000)}\n` : ''}

## Instructions
You are working on this task using a multi-step approach:
1. First, THINK about the task and what you need to do
2. If you need input from another agent, say: [CONSULT:agent_id] question here
   Available agents: ${agents.filter(a => a.id !== agent.id).map(a => `${a.id} (${a.name} - ${a.role})`).join(', ')}
3. Provide your solution with complete code snippets and clear instructions

Start by analyzing the task and providing your approach.`

    messages.push({ role: 'user', content: initialPrompt })

    for (let step = 0; step < MAX_STEPS; step++) {
      if (abortController.signal.aborted) throw new Error('AbortError')

      db.prepare('INSERT INTO task_logs (task_id, agent_id, message, type) VALUES (?, ?, ?, ?)')
        .run(task.id, agent.id, `ReAct step ${step + 1}/${MAX_STEPS}...`, 'info')

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        system: agent.systemPrompt,
        messages,
      }, { signal: abortController.signal })

      const stepOutput = response.content.map(b => b.type === 'text' ? b.text : '').join('\n')
      fullOutput += `\n--- Step ${step + 1} ---\n${stepOutput}`
      messages.push({ role: 'assistant', content: stepOutput })

      // Check for consultation requests
      const consultMatch = stepOutput.match(/\[CONSULT:(\w+)\]\s*(.+)/s)
      if (consultMatch && step < MAX_STEPS - 1) {
        const [, targetAgentId, question] = consultMatch
        db.prepare('INSERT INTO task_logs (task_id, agent_id, message, type) VALUES (?, ?, ?, ?)')
          .run(task.id, agent.id, `Consulting ${targetAgentId}: ${question.slice(0, 200)}`, 'info')

        const consultResponse = await agentConsult(agent, targetAgentId, question, `Task: ${task.title}`)

        if (consultResponse) {
          messages.push({
            role: 'user',
            content: `Response from ${targetAgentId}:\n${consultResponse}\n\nNow continue with your task, incorporating this input.`
          })
          continue // Do another ReAct step with the consultation result
        }
      }

      // Check if agent indicates it's done (no more consultation needed)
      if (!consultMatch || step === MAX_STEPS - 1) {
        break // Done — no more steps needed
      }
    }

    activeRuns.delete(agent.id)
    db.prepare(`UPDATE tasks SET status = 'done', output = ?, completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
      .run(fullOutput.slice(0, 50000), task.id)
    db.prepare('INSERT INTO task_logs (task_id, agent_id, message, type) VALUES (?, ?, ?, ?)')
      .run(task.id, agent.id, 'Task completed successfully', 'success')

    // Post completion to chat with summary
    const summary = fullOutput.length > 300 ? fullOutput.slice(0, 300) + '…' : fullOutput
    db.prepare('INSERT INTO messages (sender_id, sender_name, sender_avatar, sender_color, text) VALUES (?, ?, ?, ?, ?)')
      .run(agent.id, agent.name, agent.avatar, agent.color, `✅ Finished: "${task.title}"\n\n${summary}`)

    // Push notification
    sendPushToAll({
      title: `${agent.avatar} ${agent.name} finished`,
      body: task.title,
      tag: `task-done-${task.id}`,
      taskId: task.id
    })

    // Update agent memory, then QA review, then generate follow-ups, then queue next
    updateAgentMemory(agent, task, fullOutput)
      .then(() => reviewCompletedWork(task, agent, fullOutput))
      .then(() => generateFollowUpTasks(task, agent, fullOutput))
      .then(() => { setTimeout(() => processAgentQueue(agent.id), 5000) })
      .catch(() => {})

  } catch (err) {
    activeRuns.delete(agent.id)
    const errorMsg = err.name === 'AbortError' || err.message === 'AbortError' ? 'Stopped by user' : err.message
    db.prepare(`UPDATE tasks SET status = 'failed', error = ?, completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
      .run(errorMsg, task.id)
    db.prepare('INSERT INTO task_logs (task_id, agent_id, message, type) VALUES (?, ?, ?, ?)')
      .run(task.id, agent.id, `Task failed: ${errorMsg}`, 'error')

    db.prepare('INSERT INTO messages (sender_id, sender_name, sender_avatar, sender_color, text) VALUES (?, ?, ?, ?, ?)')
      .run(agent.id, agent.name, agent.avatar, agent.color, `❌ Failed: "${task.title}" — ${errorMsg}`)

    sendPushToAll({
      title: `${agent.avatar} ${agent.name} failed`,
      body: `${task.title} — ${errorMsg}`,
      tag: `task-fail-${task.id}`,
      taskId: task.id
    })

    if (errorMsg !== 'Stopped by user') {
      troubleshootAndRetry(task, agent, errorMsg).catch(() => {})
    }
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

// ── Heartbeat Status API ──────────────────────────
app.get('/api/heartbeat', (req, res) => {
  res.json({
    jobs: heartbeatJobs.map(j => ({
      name: j.name,
      intervalMinutes: Math.round(j.intervalMs / 60000)
    })),
    queueStatus: agents.map(a => ({
      agentId: a.id,
      name: a.name,
      isRunning: activeRuns.has(a.id),
      pendingTasks: db.prepare("SELECT COUNT(*) as count FROM tasks WHERE agent_id = ? AND status = 'todo'").get(a.id)?.count || 0
    }))
  })
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
  res.json({
    ok: true,
    uptime: process.uptime(),
    agents: agents.length,
    activeRuns: activeRuns.size,
    heartbeats: heartbeatJobs.length,
    memoryDir: MEMORY_DIR
  })
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
  console.log(`🧠 Agent memory dir: ${MEMORY_DIR}`)
  console.log(`📋 Task queues active for ${agents.length} agents`)
  console.log(`💓 ${heartbeatJobs.length} heartbeat jobs registered`)
})
