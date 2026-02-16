import { NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// Error templates — each produces a realistic-looking error with a proper
// stack trace (same patterns as error-chaos example)
// ---------------------------------------------------------------------------
function fetchUserProfile(userId: number) {
  const user = null as { profile: unknown } | null;
  return user!.profile; // TypeError: Cannot read properties of null
}

function parseConfigFile(_path: string) {
  JSON.parse('{"port": 3000, broken'); // SyntaxError: Unexpected token
}

function validateInput(data: unknown) {
  if (!data || typeof data !== 'object') {
    throw new TypeError(`Expected object, got ${typeof data}`);
  }
}

function connectToDatabase() {
  throw new Error('ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:5432');
}

function readConfigFile() {
  throw new Error('ENOENT: no such file or directory, open "/etc/app/config.json"');
}

function callExternalApi() {
  throw new Error('Request failed with status code 503 — upstream timeout');
}

const ERROR_TEMPLATES = [
  { name: 'TypeError (null access)', make: () => fetchUserProfile(42) },
  { name: 'TypeError (bad input)', make: () => validateInput(undefined) },
  { name: 'SyntaxError (bad JSON)', make: () => parseConfigFile('/etc/app/config.json') },
  { name: 'Error (ECONNREFUSED)', make: () => connectToDatabase() },
  { name: 'Error (ENOENT)', make: () => readConfigFile() },
  { name: 'Error (upstream 503)', make: () => callExternalApi() },
] as const;

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function triggerThrow(type?: string, message?: string) {
  if (message) {
    const ErrorCtor = (globalThis as Record<string, unknown>)[type || 'Error'] as ErrorConstructor;
    throw new (ErrorCtor || Error)(message);
  }

  if (type) {
    const match = ERROR_TEMPLATES.find((t) => t.name.startsWith(type));
    if (match) {
      match.make();
      return;
    }
    const Ctor = (globalThis as Record<string, unknown>)[type] as ErrorConstructor;
    throw new (Ctor || Error)(`Triggered ${type} via chaos API`);
  }

  pickRandom(ERROR_TEMPLATES).make();
}

function triggerReject(type?: string, message?: string) {
  Promise.resolve().then(() => triggerThrow(type, message));
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const {
    action = 'throw',
    type,
    message,
    delay,
  } = body as {
    action?: string;
    type?: string;
    message?: string;
    delay?: number;
  };

  const worker = (globalThis as { __app?: { workerId: string } }).__app?.workerId || '0';

  switch (action) {
    case 'throw':
      setImmediate(() => triggerThrow(type, message));
      return NextResponse.json({
        ok: true,
        action: 'throw',
        detail: `Uncaught exception in worker ${worker}`,
      });

    case 'reject':
      setImmediate(() => triggerReject(type, message));
      return NextResponse.json({
        ok: true,
        action: 'reject',
        detail: `Unhandled rejection in worker ${worker}`,
      });

    case 'random':
      if (Math.random() < 0.5) {
        setImmediate(() => triggerThrow(type, message));
        return NextResponse.json({
          ok: true,
          action: 'throw',
          detail: `Random → uncaught exception in worker ${worker}`,
        });
      } else {
        setImmediate(() => triggerReject(type, message));
        return NextResponse.json({
          ok: true,
          action: 'reject',
          detail: `Random → unhandled rejection in worker ${worker}`,
        });
      }

    case 'delayed': {
      const ms = delay || 1000;
      setTimeout(() => triggerThrow(type, message), ms);
      return NextResponse.json({
        ok: true,
        action: 'delayed',
        detail: `Will throw in ${ms}ms in worker ${worker}`,
      });
    }

    default:
      return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
  }
}
