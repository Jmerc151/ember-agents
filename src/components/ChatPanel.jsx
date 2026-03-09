import { useState, useEffect, useRef } from 'react'
import { api } from '../lib/api'

export default function ChatPanel({ agents, onClose, embedded }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [standupLoading, setStandupLoading] = useState(false)
  const bottomRef = useRef(null)
  const prevCountRef = useRef(0)

  useEffect(() => {
    const fetchMsgs = async () => {
      const msgs = await api.getMessages()
      setMessages(msgs)
    }
    fetchMsgs()
    const interval = setInterval(fetchMsgs, 2000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (messages.length !== prevCountRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
      prevCountRef.current = messages.length
    }
  }, [messages])

  const handleSend = async () => {
    if (!input.trim()) return
    await api.sendMessage({ text: input.trim() })
    setInput('')
    const msgs = await api.getMessages()
    setMessages(msgs)
  }

  const handleStandup = async () => {
    setStandupLoading(true)
    try {
      await api.triggerStandup()
    } finally {
      setTimeout(() => setStandupLoading(false), 3000)
    }
  }

  const handleClear = async () => {
    await api.clearMessages()
    setMessages([])
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const formatTime = (ts) => {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const content = (
    <div className={`flex flex-col ${embedded ? 'h-full' : 'h-full'}`}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-ember-700/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-fire/10 flex items-center justify-center">
            <span className="text-sm">💬</span>
          </div>
          <div>
            <h2 className="font-semibold text-sm">Team Chat</h2>
            <p className="text-xs text-ember-500">{agents.length} agents</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClear}
            className="text-xs text-ember-500 hover:text-ember-300 px-2 py-1 rounded-lg active:bg-ember-700"
          >
            Clear
          </button>
          {onClose && (
            <button onClick={onClose} className="text-ember-400 hover:text-ember-200 text-xl">&times;</button>
          )}
        </div>
      </div>

      {/* Standup banner */}
      <div className="px-4 py-2 border-b border-ember-700/30">
        <button
          onClick={handleStandup}
          disabled={standupLoading}
          className="w-full py-2.5 rounded-xl text-sm font-medium transition-all bg-gradient-to-r from-fire/10 to-fire/5 text-fire border border-fire/20 hover:from-fire/20 hover:to-fire/10 disabled:opacity-50 active:scale-[0.98]"
        >
          {standupLoading ? 'Standup in progress...' : '📋 Start Team Standup'}
        </button>
      </div>

      {/* Messages */}
      <div className={`flex-1 overflow-y-auto p-4 space-y-3 ${embedded ? 'pb-20' : ''}`}>
        {messages.length === 0 ? (
          <div className="text-center text-ember-500 py-16">
            <div className="w-16 h-16 rounded-2xl bg-ember-800 flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">💬</span>
            </div>
            <p className="text-sm font-medium text-ember-300">No messages yet</p>
            <p className="text-xs mt-1">Start a team standup or send a message</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.sender_id === 'user'
            const isSystem = msg.sender_id === 'system'

            if (isSystem) {
              return (
                <div key={msg.id} className="flex justify-center">
                  <span className="text-xs text-ember-500 bg-ember-800/80 px-3 py-1 rounded-full border border-ember-700/30">
                    {msg.sender_avatar} {msg.text}
                  </span>
                </div>
              )
            }

            return (
              <div key={msg.id} className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
                <div className="shrink-0 w-8 h-8 rounded-xl bg-ember-700/80 flex items-center justify-center text-sm">
                  {msg.sender_avatar || '👤'}
                </div>
                <div className={`max-w-[80%] ${isUser ? 'text-right' : ''}`}>
                  <div className={`flex items-center gap-2 mb-0.5 ${isUser ? 'justify-end' : ''}`}>
                    {!isUser && (
                      <span className="text-xs font-semibold" style={{ color: msg.sender_color || '#a8a29e' }}>
                        {msg.sender_name}
                      </span>
                    )}
                    <span className="text-[10px] text-ember-600">{formatTime(msg.created_at)}</span>
                  </div>
                  <div className={`text-sm rounded-2xl px-3.5 py-2 inline-block text-left leading-relaxed ${
                    isUser
                      ? 'bg-fire text-white rounded-br-md'
                      : 'bg-ember-800 text-ember-200 border border-ember-700/50 rounded-bl-md'
                  }`}>
                    {msg.text}
                  </div>
                </div>
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className={`p-3 border-t border-ember-700/50 bg-ember-900/80 backdrop-blur-xl ${embedded ? 'safe-bottom pb-20' : ''}`}>
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a message..."
            className="flex-1 bg-ember-800 border border-ember-700 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-fire/30 focus:border-fire/50 placeholder:text-ember-500"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="px-4 py-2.5 bg-fire text-white rounded-xl text-sm font-medium hover:bg-fire-dim transition-all disabled:opacity-30 active:scale-95"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )

  // Embedded mode — render inline (no modal wrapper)
  if (embedded) {
    return content
  }

  // Modal mode — with backdrop
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-lg bg-ember-900 border-l border-ember-700/50 shadow-2xl flex flex-col h-full" onClick={e => e.stopPropagation()}>
        {content}
      </div>
    </div>
  )
}
