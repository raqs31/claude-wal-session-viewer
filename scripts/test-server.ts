// test-server.ts — starts wal-server for the tests and benches and resolves with the URL it logs.
//
// Port 0 lets the OS pick a free port, so no guess can land on one another service holds. Tests
// pass `HOME` in `env`: discovery reads `~/.claude` through os.homedir(), which honours it.

import { type ChildProcess, spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

export const startServer = (args: string[], env: Record<string, string> = {}): Promise<{ server: ChildProcess; base: string }> => {
  const server = spawn('node', [join(HERE, 'wal-server.ts'), '--port=0', ...args], {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, TZ: 'UTC', ...env },
  })
  // A test that throws skips its own cleanup; an orphan would hold the inherited stderr and hang `node --test`.
  process.once('exit', () => server.kill())
  return new Promise((resolve, reject) => {
    createInterface({ input: server.stdout }).on('line', (l) => {
      const base = /^wal viewer:\s+(http:\/\/\S+)/.exec(l)?.[1]
      if (base) resolve({ server, base })
    })
    server.once('exit', (code) => reject(new Error(`server exited (${code}) before listening`)))
    setTimeout(() => {
      server.kill()
      reject(new Error('server never listened'))
    }, 30_000).unref()
  })
}
