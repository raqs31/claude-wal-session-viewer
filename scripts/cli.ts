#!/usr/bin/env node
// cli.ts — the package's `wal` command: `wal legacy` folds old logs, otherwise the viewer runs in
// the foreground and the URL it prints is opened in the browser.

import { spawn } from 'node:child_process'
import { constants } from 'node:os'
import { extname, join } from 'node:path'
import { createInterface } from 'node:readline'

const usage = `usage: wal [--port=N] [--source=<config-dir>]...
       wal legacy [--source=<config-dir>]...`

// Same extension as this file, so it runs both from the .ts sources and from the compiled dist/.
const script = (name: string) => join(import.meta.dirname, name + extname(import.meta.filename))
const args = process.argv.slice(2)

if (args[0] === '-h' || args[0] === '--help') {
  console.log(usage)
} else if (args[0] === 'legacy') {
  spawn(process.execPath, [script('legacy'), ...args.slice(1)], { stdio: 'inherit' }).on('exit', (code) => process.exit(code ?? 1))
} else {
  const server = spawn(process.execPath, [script('wal-server'), ...args], { stdio: ['ignore', 'pipe', 'inherit'] })
  let opened = false
  createInterface({ input: server.stdout }).on('line', (line) => {
    console.log(line)
    const url = opened ? undefined : /^wal viewer:\s+(http:\/\/\S+)/.exec(line)?.[1]
    if (!url) return
    opened = true
    // A headless machine has no opener; the printed URL is enough there.
    spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore', detached: true })
      .on('error', () => {})
      .unref()
  })
  // Ctrl-C reaches both processes; the handlers keep this one alive until the server has exited.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.kill(signal))
  server.on('exit', (code, signal) => process.exit(signal ? 128 + constants.signals[signal] : code))
}
