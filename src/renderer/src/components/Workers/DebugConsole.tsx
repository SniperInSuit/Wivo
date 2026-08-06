/**
 * Debug console — shows recent actions and errors.
 * Visible under Meeskond for owners. Toggle-able in settings later.
 */
import { useState, useEffect, useRef } from 'react'
import { Trash2, AlertTriangle, Info, ChevronDown, ChevronUp } from 'lucide-react'

interface LogEntry {
  id: number
  ts: string
  level: 'info' | 'error' | 'warn'
  message: string
  detail?: string
}

let nextId = 1
const logs: LogEntry[] = []
const listeners = new Set<() => void>()

function notify() { listeners.forEach(fn => fn()) }

/** Call from anywhere to log an action or error */
export function debugLog(level: 'info' | 'error' | 'warn', message: string, detail?: unknown) {
  logs.unshift({
    id: nextId++,
    ts: new Date().toISOString().slice(11, 19),
    level,
    message,
    detail: detail != null ? (typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2)) : undefined,
  })
  // Keep last 200
  if (logs.length > 200) logs.length = 200
  notify()
}

// Intercept console.error globally
const origError = console.error
console.error = (...args: unknown[]) => {
  origError.apply(console, args)
  const msg = args.map(a => typeof a === 'string' ? a : a instanceof Error ? a.message : JSON.stringify(a)).join(' ')
  debugLog('error', msg.slice(0, 200))
}

// Intercept unhandled errors
if (typeof window !== 'undefined') {
  window.addEventListener('error', e => {
    debugLog('error', `Unhandled: ${e.message}`, `${e.filename}:${e.lineno}`)
  })
  window.addEventListener('unhandledrejection', e => {
    debugLog('error', `Unhandled rejection: ${e.reason?.message ?? e.reason}`)
  })
}

export function DebugConsole() {
  const [, forceUpdate] = useState(0)
  const [expanded, setExpanded] = useState(true)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  useEffect(() => {
    const fn = () => forceUpdate(n => n + 1)
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [])

  const levelColor = {
    info: 'text-blue-400',
    warn: 'text-amber-400',
    error: 'text-red-400',
  }

  return (
    <div className="card p-4 mt-4">
      <div className="flex items-center justify-between mb-2 cursor-pointer" onClick={() => setExpanded(e => !e)}>
        <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
          <AlertTriangle size={14} className="text-accent" />
          Debug Console
          <span className="text-[10px] text-ink-faint font-normal">({logs.length} kirjet)</span>
          {logs.some(l => l.level === 'error') && (
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          )}
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={e => { e.stopPropagation(); logs.length = 0; notify() }}
            className="text-ink-faint hover:text-red-500 p-1 transition-colors"
            title="Tühjenda"
          >
            <Trash2 size={12} />
          </button>
          {expanded ? <ChevronUp size={14} className="text-ink-faint" /> : <ChevronDown size={14} className="text-ink-faint" />}
        </div>
      </div>

      {expanded && (
        <div className="max-h-[400px] overflow-y-auto space-y-0.5 font-mono text-[11px]">
          {logs.length === 0 && (
            <p className="text-ink-faint py-4 text-center text-xs font-sans">Logi on tühi</p>
          )}
          {logs.map(entry => (
            <div key={entry.id}
              className={`flex items-start gap-2 px-2 py-1 rounded hover:bg-bg-sidebar/60 ${
                entry.level === 'error' ? 'bg-red-50/50' : ''
              }`}
              onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
            >
              <span className="text-ink-faint tabular-nums flex-shrink-0">{entry.ts}</span>
              <span className={`font-semibold flex-shrink-0 w-10 ${levelColor[entry.level]}`}>
                {entry.level.toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-ink break-all">{entry.message}</p>
                {entry.detail && expandedId === entry.id && (
                  <pre className="text-ink-faint mt-1 text-[10px] whitespace-pre-wrap break-all bg-bg-sidebar rounded p-2">
                    {entry.detail}
                  </pre>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
