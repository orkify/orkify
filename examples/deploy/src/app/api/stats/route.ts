import { NextResponse } from 'next/server';

declare const globalThis: {
  __app: {
    requestCount: number;
    startedAt: number;
    buildInfo: { version: string; builtAt: string; node: string };
    workerId: string;
    processName: string;
  };
};

export function GET() {
  const app = globalThis.__app;
  const mem = process.memoryUsage();
  return NextResponse.json({
    requests: app.requestCount,
    uptime: Math.floor((Date.now() - app.startedAt) / 1000),
    memoryMB: Math.round(mem.rss / 1024 / 1024),
    heapMB: +(mem.heapUsed / 1024 / 1024).toFixed(1),
    buildInfo: app.buildInfo,
    worker: app.workerId,
    processName: app.processName,
    pid: process.pid,
  });
}
