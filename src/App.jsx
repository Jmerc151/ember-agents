import { useState, useEffect, useCallback } from 'react'
import { api } from './lib/api'
import Sidebar from './components/Sidebar'
import TaskBoard from './components/TaskBoard'
import CreateTaskModal from './components/CreateTaskModal'
import TaskDetail from './components/TaskDetail'
import ChatPanel from './components/ChatPanel'
import MobileNav from './components/MobileNav'
import AgentCards from './components/AgentCards'

export default function App() {
  const [agents, setAgents] = useState([])
  const [tasks, setTasks] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [selectedTask, setSelectedTask] = useState(null)
  const [filterAgent, setFilterAgent] = useState(null)
  const [showChat, setShowChat] = useState(false)
  const [mobileView, setMobileView] = useState('board') // board, agents, chat

  const refresh = useCallback(async () => {
    const [a, t] = await Promise.all([api.getAgents(), api.getTasks()])
    setAgents(a)
    setTasks(t)
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 3000)
    return () => clearInterval(interval)
  }, [refresh])

  // Subscribe to push notifications
  useEffect(() => {
    async function setupPush() {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
      try {
        const reg = await navigator.serviceWorker.ready
        const existing = await reg.pushManager.getSubscription()
        if (existing) return // already subscribed

        const { key } = await api.getVapidKey()
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key
        })
        await api.subscribePush(sub.toJSON())
      } catch (e) {
        console.log('Push subscription skipped:', e.message)
      }
    }
    setupPush()
  }, [])

  const handleCreateTask = async (data) => {
    await api.createTask(data)
    setShowCreate(false)
    refresh()
  }

  const handleRunTask = async (taskId) => {
    await api.runTask(taskId)
    refresh()
  }

  const handleUpdateTask = async (taskId, data) => {
    await api.updateTask(taskId, data)
    refresh()
  }

  const handleDeleteTask = async (taskId) => {
    await api.deleteTask(taskId)
    setSelectedTask(null)
    refresh()
  }

  const handleStopAgent = async (agentId) => {
    await api.stopAgent(agentId)
    refresh()
  }

  const filteredTasks = filterAgent
    ? tasks.filter(t => t.agent_id === filterAgent)
    : tasks

  const activeCount = agents.filter(a => a.isRunning).length

  return (
    <div className="flex h-screen h-[100dvh] overflow-hidden bg-ember-900">
      {/* Desktop sidebar — hidden on mobile */}
      <div className="hidden md:block">
        <Sidebar
          agents={agents}
          filterAgent={filterAgent}
          onFilterAgent={setFilterAgent}
          onStopAgent={handleStopAgent}
          onNewTask={() => setShowCreate(true)}
          taskCount={tasks.length}
        />
      </div>

      <main className="flex-1 overflow-hidden flex flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b border-ember-700/50 bg-ember-900/80 backdrop-blur-xl safe-top">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-fire to-fire-dim flex items-center justify-center shadow-lg shadow-fire/20">
              <span className="text-base">🔥</span>
            </div>
            <div>
              <h1 className="text-base md:text-lg font-bold tracking-tight">Ember Agents</h1>
              <p className="text-xs text-ember-400">
                {filterAgent
                  ? agents.find(a => a.id === filterAgent)?.name || filterAgent
                  : `${tasks.length} tasks · ${activeCount} active`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeCount > 0 && (
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-sentinel/10 border border-sentinel/20 rounded-full">
                <div className="w-1.5 h-1.5 rounded-full bg-sentinel animate-pulse" />
                <span className="text-xs font-medium text-sentinel">{activeCount} running</span>
              </div>
            )}
            <button
              onClick={() => setShowChat(true)}
              className="hidden md:flex items-center gap-1.5 px-3 py-2 bg-ember-800 text-ember-200 rounded-xl text-sm hover:bg-ember-700 transition-colors border border-ember-700"
            >
              💬 <span className="hidden lg:inline">Chat</span>
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1 px-3 py-2 bg-gradient-to-r from-fire to-fire-dim text-white rounded-xl font-medium text-sm shadow-lg shadow-fire/20 hover:shadow-fire/30 transition-all active:scale-95"
            >
              <span className="text-lg leading-none">+</span>
              <span className="hidden sm:inline">New Task</span>
            </button>
          </div>
        </header>

        {/* Mobile: switch views based on bottom nav */}
        {mobileView === 'agents' && (
          <div className="md:hidden flex-1 overflow-y-auto">
            <AgentCards
              agents={agents}
              tasks={tasks}
              filterAgent={filterAgent}
              onFilterAgent={setFilterAgent}
              onStopAgent={handleStopAgent}
            />
          </div>
        )}
        {mobileView === 'chat' && (
          <div className="md:hidden flex-1 overflow-hidden">
            <ChatPanel agents={agents} embedded />
          </div>
        )}

        {/* Task board: always visible on desktop, visible on mobile when board tab selected */}
        <div className={`flex-1 overflow-hidden ${mobileView !== 'board' ? 'hidden md:flex' : 'flex'}`}>
          <TaskBoard
            tasks={filteredTasks}
            agents={agents}
            onSelectTask={setSelectedTask}
            onRunTask={handleRunTask}
            onUpdateTask={handleUpdateTask}
          />
        </div>
      </main>

      {/* Mobile bottom nav */}
      <MobileNav
        view={mobileView}
        onChangeView={setMobileView}
        activeCount={activeCount}
        onNewTask={() => setShowCreate(true)}
      />

      {/* Modals */}
      {showCreate && (
        <CreateTaskModal
          agents={agents}
          onSubmit={handleCreateTask}
          onClose={() => setShowCreate(false)}
        />
      )}

      {showChat && (
        <div className="hidden md:block">
          <ChatPanel agents={agents} onClose={() => setShowChat(false)} />
        </div>
      )}

      {selectedTask && (
        <TaskDetail
          task={tasks.find(t => t.id === selectedTask)}
          agent={agents.find(a => a.id === tasks.find(t => t.id === selectedTask)?.agent_id)}
          onClose={() => setSelectedTask(null)}
          onRun={handleRunTask}
          onUpdate={handleUpdateTask}
          onDelete={handleDeleteTask}
        />
      )}
    </div>
  )
}
