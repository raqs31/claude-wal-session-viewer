// test-server.ts — starts wal-server for the tests and benches and resolves with the URL it logs.
//
// Port 0 lets the OS pick a free port, so no guess can land on one another service holds. Tests
// pass `HOME` in `env`: discovery reads `~/.claude` through os.homedir(), which honours it.

import { spawn, type ChildProcess } from 'node:child_process'
import { join, dirname } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

export const startServer = (args: string[], env: Record<string, string> = {}): Promise<{ server: ChildProcess; base: string }> => {
  const server = spawn('node', [join(HERE, 'wal-server.ts'), '--port=0', ...args], {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, TZ: 'UTC', ...env },
  })
  return new Promise((resolve, reject) => {
    createInterface({ input: server.stdout! }).on('line', (l) => {
      const m = /^wal viewer:\s+(http:\/\/\S+)/.exec(l)
      if (m) resolve({ server, base: m[1]! })
    })
    server.once('exit', (code) => reject(new Error(`server exited (${code}) before listening`)))
    setTimeout(() => {
      server.kill()
      reject(new Error('server never listened'))
    }, 30_000).unref()
  })
}
