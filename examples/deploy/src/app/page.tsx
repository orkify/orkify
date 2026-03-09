'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Stats {
  requests: number;
  uptime: number;
  memoryMB: number;
  heapMB: number;
  buildInfo: { version: string; builtAt: string; node: string };
  worker: string;
  processName: string;
  pid: number;
  cacheSize: number;
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number;
}

interface LogEntry {
  id: number;
  time: string;
  text: string;
  ok: boolean;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour12: false });
}

const ERROR_TYPES: { label: string; type: string; message?: string; desc: string }[] = [
  { label: 'TypeError (null)', type: 'TypeError', desc: 'Null property access' },
  {
    label: 'TypeError (input)',
    type: 'TypeError',
    message: 'Expected object, got undefined',
    desc: 'Bad input validation',
  },
  { label: 'SyntaxError', type: 'SyntaxError', desc: 'Bad JSON parse' },
  {
    label: 'ECONNREFUSED',
    type: 'Error',
    message: 'ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:5432',
    desc: 'Database connection',
  },
  {
    label: 'ENOENT',
    type: 'Error',
    message: 'ENOENT: no such file or directory',
    desc: 'Missing file',
  },
  {
    label: 'Upstream 503',
    type: 'Error',
    message: 'Request failed with status code 503',
    desc: 'External API failure',
  },
];

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [fakeLogs, setFakeLogs] = useState(true);
  const [customMsg, setCustomMsg] = useState('');
  const nextId = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((text: string, ok: boolean) => {
    setLog((prev) => {
      const entry: LogEntry = { id: nextId.current++, time: formatTime(new Date()), text, ok };
      const next = [entry, ...prev];
      return next.length > 50 ? next.slice(0, 50) : next;
    });
  }, []);

  // Poll stats
  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const res = await fetch('/api/stats');
        if (active && res.ok) setStats(await res.json());
      } catch {
        // ignore
      }
      try {
        const res = await fetch('/api/health');
        if (active) setHealthy(res.ok);
      } catch {
        if (active) setHealthy(false);
      }
      try {
        const res = await fetch('/api/logs');
        if (active && res.ok) {
          const data = await res.json();
          setFakeLogs(data.fakeLogs);
        }
      } catch {
        // ignore
      }
      if (active) setTimeout(poll, 2000);
    }
    poll();
    return () => {
      active = false;
    };
  }, []);

  async function toggleFakeLogs(enabled: boolean) {
    try {
      const res = await fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle', enabled }),
      });
      const data = await res.json();
      setFakeLogs(data.fakeLogs);
      addLog(`Fake logs ${data.fakeLogs ? 'enabled' : 'disabled'} on worker ${data.worker}`, true);
    } catch (err) {
      addLog(`Toggle failed: ${err instanceof Error ? err.message : 'unknown'}`, false);
    }
  }

  async function sendCustomLog() {
    const msg = customMsg.trim();
    if (!msg) return;
    try {
      const res = await fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'log', message: msg }),
      });
      const data = await res.json();
      setCustomMsg('');
      addLog(`Logged "${data.message}" on worker ${data.worker}`, true);
    } catch (err) {
      addLog(`Log failed: ${err instanceof Error ? err.message : 'unknown'}`, false);
    }
  }

  async function triggerChaos(action: string, type?: string, message?: string, delay?: number) {
    try {
      const res = await fetch('/api/chaos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, type, message, delay }),
      });
      const data = await res.json();
      addLog(data.detail || data.error || 'Triggered', data.ok !== false);
    } catch (err) {
      addLog(`Request failed: ${err instanceof Error ? err.message : 'unknown'}`, false);
    }
  }

  return (
    <div className="min-h-screen p-6 max-w-4xl mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Deploy Example</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {stats
              ? `${stats.processName} · Worker ${stats.worker} · PID ${stats.pid}`
              : 'Connecting...'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {stats && (
            <span className="px-2.5 py-1 text-xs font-mono rounded-full bg-zinc-800 text-zinc-300">
              v{stats.buildInfo.version}
            </span>
          )}
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ${
              healthy === true
                ? 'bg-emerald-950 text-emerald-400'
                : healthy === false
                  ? 'bg-red-950 text-red-400'
                  : 'bg-zinc-800 text-zinc-500'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                healthy === true
                  ? 'bg-emerald-400'
                  : healthy === false
                    ? 'bg-red-400'
                    : 'bg-zinc-500'
              }`}
            />
            {healthy === true ? 'Healthy' : healthy === false ? 'Unhealthy' : 'Checking'}
          </span>
        </div>
      </header>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
        <StatCard label="Requests" value={stats?.requests ?? '—'} />
        <StatCard label="Memory" value={stats ? `${stats.memoryMB} MB` : '—'} />
        <StatCard label="Uptime" value={stats ? formatUptime(stats.uptime) : '—'} />
        <StatCard
          label="Cache"
          value={stats ? `${stats.cacheSize} · ${Math.round(stats.cacheHitRate * 100)}%` : '—'}
        />
        <StatCard
          label="Built"
          value={
            stats?.buildInfo.builtAt && stats.buildInfo.builtAt !== 'n/a'
              ? new Date(stats.buildInfo.builtAt).toLocaleTimeString('en-US', { hour12: false })
              : '—'
          }
        />
      </div>

      {/* Error Triggers */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">
          Error Triggers
        </h2>

        {/* Primary actions */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          <ActionButton
            label="Uncaught Exception"
            onClick={() => triggerChaos('throw')}
            variant="red"
          />
          <ActionButton
            label="Unhandled Rejection"
            onClick={() => triggerChaos('reject')}
            variant="orange"
          />
          <ActionButton
            label="Random (50/50)"
            onClick={() => triggerChaos('random')}
            variant="yellow"
          />
          <ActionButton
            label="Delayed (2s)"
            onClick={() => triggerChaos('delayed', undefined, undefined, 2000)}
            variant="purple"
          />
        </div>

        {/* Error type buttons */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {ERROR_TYPES.map((et) => (
            <button
              key={et.label}
              onClick={() => triggerChaos('throw', et.type, et.message)}
              className="text-left px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-600 transition-colors"
            >
              <div className="text-sm font-medium text-zinc-200">{et.label}</div>
              <div className="text-xs text-zinc-500">{et.desc}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Browser Error Triggers */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">
          Browser Error Triggers
        </h2>
        <p className="text-xs text-zinc-500 mb-3">
          These throw errors in the browser. Captured by orkify/next/error-capture and relayed via
          IPC.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <ActionButton
            label="window.onerror"
            onClick={() => {
              addLog('Triggering browser TypeError...', true);
              setTimeout(() => {
                const obj = null as unknown as { foo: string };
                // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                obj.foo;
              }, 0);
            }}
            variant="red"
          />
          <ActionButton
            label="Unhandled Rejection"
            onClick={() => {
              addLog('Triggering browser unhandled rejection...', true);
              Promise.reject(new Error('Browser: unhandled promise rejection'));
            }}
            variant="orange"
          />
          <ActionButton
            label="ReferenceError"
            onClick={() => {
              addLog('Triggering browser ReferenceError...', true);
              setTimeout(() => {
                // eslint-disable-next-line @typescript-eslint/no-implied-eval
                new Function('return nonExistentVariable')();
              }, 0);
            }}
            variant="yellow"
          />
          <ActionButton
            label="RangeError"
            onClick={() => {
              addLog('Triggering browser RangeError...', true);
              setTimeout(() => {
                new Array(-1);
              }, 0);
            }}
            variant="purple"
          />
        </div>
      </section>

      {/* Log Controls */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">
          Log Controls
        </h2>
        <div className="flex flex-col sm:flex-row gap-3">
          <label className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-zinc-900 border border-zinc-800 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={fakeLogs}
              onChange={(e) => toggleFakeLogs(e.target.checked)}
              className="accent-emerald-500"
            />
            <span className="text-sm text-zinc-300">Fake logs</span>
          </label>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendCustomLog();
            }}
            className="flex flex-1 gap-2"
          >
            <input
              type="text"
              value={customMsg}
              onChange={(e) => setCustomMsg(e.target.value)}
              placeholder="Custom log message…"
              className="flex-1 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
            />
            <button
              type="submit"
              disabled={!customMsg.trim()}
              className="px-4 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm font-medium text-zinc-300 hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </form>
        </div>
      </section>

      {/* Activity Log */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
            Activity Log
          </h2>
          {log.length > 0 && (
            <button
              onClick={() => setLog([])}
              className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        <div
          ref={logRef}
          className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 h-48 overflow-y-auto font-mono text-xs space-y-1"
        >
          {log.length === 0 ? (
            <p className="text-zinc-600 text-center py-8">
              Click a trigger button to generate activity
            </p>
          ) : (
            log.map((entry) => (
              <div key={entry.id} className="flex gap-2">
                <span className="text-zinc-600 shrink-0">{entry.time}</span>
                <span className={entry.ok ? 'text-emerald-400' : 'text-red-400'}>
                  {entry.ok ? '✓' : '✗'}
                </span>
                <span className="text-zinc-300">{entry.text}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3">
      <div className="text-lg font-semibold text-zinc-100">{value}</div>
      <div className="text-xs text-zinc-500">{label}</div>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  variant,
}: {
  label: string;
  onClick: () => void;
  variant: 'red' | 'orange' | 'yellow' | 'purple';
}) {
  const colors = {
    red: 'bg-red-950 border-red-900 text-red-300 hover:bg-red-900',
    orange: 'bg-orange-950 border-orange-900 text-orange-300 hover:bg-orange-900',
    yellow: 'bg-yellow-950 border-yellow-900 text-yellow-300 hover:bg-yellow-900',
    purple: 'bg-purple-950 border-purple-900 text-purple-300 hover:bg-purple-900',
  };
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${colors[variant]}`}
    >
      {label}
    </button>
  );
}
