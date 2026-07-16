import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { getSecret } from '../security/keyVault'

// Round 12: World Builder's first real external tool — a genuine MCP stdio
// connection to Brave's Search MCP server (@brave/brave-search-mcp-server),
// spoken over the real @modelcontextprotocol/sdk client. shared/mcp.ts's
// StdioMcpAdapter stays exactly what its own comment says it is — illustrative
// scaffolding, never instantiated — this file is the first real
// implementation of the shape it documents, kept out of shared/mcp.ts because
// that module must stay renderer-safe (no node:child_process/node:fs there).
//
// Every failure mode here — no key configured, spawn failure, a protocol
// error, an unparseable response — degrades to `undefined`, never a thrown
// error, matching every other real-tool call's "augment, never block"
// contract in main/agent/simulator.ts (checkWordCount, codex-search, ...).

export interface BraveSearchResult {
  title: string
  url: string
  snippet: string
}

const SECRET_NAME = 'brave-search-api-key'
const REQUEST_TIMEOUT_MS = 10_000

const require = createRequire(import.meta.url)

interface ActiveConnection {
  client: Client
  transport: StdioClientTransport
  // Codex review (Round 12): the key the child process was actually spawned
  // with — connect() compares this against the currently-saved secret on
  // every call so a writer who rotates/clears their key in Settings doesn't
  // silently keep talking to a process spawned under the old one (Settings'
  // save/clear handlers are renderer-side and have no way to reach into the
  // main process to kill it directly).
  apiKey: string
}

let active: ActiveConnection | undefined
// Dedupes concurrent connect() calls (e.g. two World Builder runs racing)
// onto a single in-flight attempt, so they can't each spawn their own child
// process and only the last one gets tracked for cleanup.
let connecting: Promise<ActiveConnection | undefined> | undefined

// The installed package has no "main"/"exports" field pointing at its bin
// script (only "module", which Node's own require resolver ignores) — read
// its package.json directly and follow the same "bin" field npm itself uses
// to wire up the `brave-search-mcp-server` CLI command.
function resolveBraveSearchServerScript(): string {
  const pkgJsonPath = require.resolve('@brave/brave-search-mcp-server/package.json')
  const pkg = require('@brave/brave-search-mcp-server/package.json') as { bin?: Record<string, string> }
  const binRelative = pkg.bin?.['brave-search-mcp-server'] ?? 'dist/index.js'
  const scriptPath = join(dirname(pkgJsonPath), binRelative)
  // asar is a read-only virtual filesystem — a spawned child process needs a
  // real file on disk. Harmless no-op string replace when unpackaged (there
  // is no "app.asar" substring at all in a dev/unpackaged path); the real
  // substitution only matters once this runs from a packaged build.
  return scriptPath.replace('app.asar', 'app.asar.unpacked')
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer!)
  }
}

// Reuses a live connection across calls within the same app session rather
// than spawning a fresh child process per search — cheap to keep alive, and
// killActiveBraveSearchProcess() (called from main/index.ts's before-quit
// handler) guarantees it never outlives the Electron app.
async function connect(): Promise<ActiveConnection | undefined> {
  if (connecting) return connecting
  connecting = doConnect()
  try {
    return await connecting
  } finally {
    connecting = undefined
  }
}

async function doConnect(): Promise<ActiveConnection | undefined> {
  const apiKey = await getSecret(SECRET_NAME)
  if (!apiKey) {
    // Key was cleared since the last connection (or never set) — drop any
    // stale connection rather than silently keep using it.
    if (active) await killActiveBraveSearchProcess()
    return undefined
  }
  if (active) {
    if (active.apiKey === apiKey) return active
    await killActiveBraveSearchProcess()
  }

  const scriptPath = resolveBraveSearchServerScript()
  // Electron's own binary (process.execPath) run with ELECTRON_RUN_AS_NODE
  // acts as a plain Node runtime — one spawn code path with no dev/packaged
  // branching, since process.execPath is the same real binary either way.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [scriptPath],
    env: {
      ...(process.env as Record<string, string>),
      ELECTRON_RUN_AS_NODE: '1',
      BRAVE_API_KEY: apiKey,
      BRAVE_MCP_TRANSPORT: 'stdio'
    }
  })

  const client = new Client({ name: 'atlas-world-builder', version: '1.0.0' }, { capabilities: {} })
  try {
    await withTimeout(client.connect(transport), REQUEST_TIMEOUT_MS, 'Brave Search MCP connection')
  } catch (err) {
    try {
      await transport.close()
    } catch {
      // Best-effort teardown of a connection attempt that never finished.
    }
    throw err
  }

  active = { client, transport, apiKey }
  return active
}

// Real MCP wire protocol per spec §8: initialize (inside connect() above) ->
// tools/list -> tools/call. Discovers the actual tool rather than hardcoding
// a guessed name/schema — the installed server's tool names aren't part of
// this app's own contract, so a future server upgrade renaming/adding tools
// shouldn't silently break this without at least trying the obvious matches.
function findWebSearchTool(
  tools: { name: string; inputSchema?: { properties?: Record<string, unknown> } }[]
): { name: string } | undefined {
  const byName = tools.find((t) => /web[_-]?search/i.test(t.name))
  if (byName) return byName
  return tools.find((t) => Object.prototype.hasOwnProperty.call(t.inputSchema?.properties ?? {}, 'query'))
}

// Each Brave web-search result arrives as its own `content` block whose
// `text` is a JSON-stringified `{url, title, description, ...}` object (see
// the installed package's dist/tools/web/index.js), not a single JSON array
// and not `structuredContent`. Parsed defensively per-block: a block that
// isn't valid JSON, or doesn't look like a search result (no url/title), is
// simply skipped rather than failing the whole call — the "No web results
// found" text block the server sends back on a zero-hit query is exactly one
// such block, and should produce an empty array, not a thrown error.
function parseResultBlocks(content: unknown): BraveSearchResult[] {
  if (!Array.isArray(content)) return []
  const results: BraveSearchResult[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object' || (block as { type?: string }).type !== 'text') continue
    const text = (block as { text?: unknown }).text
    if (typeof text !== 'string') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object') continue
    const { url, title, description } = parsed as { url?: unknown; title?: unknown; description?: unknown }
    if (typeof url !== 'string' || typeof title !== 'string') continue
    results.push({ title, url, snippet: typeof description === 'string' ? description : '' })
  }
  return results
}

// Never throws — every failure (no key configured, spawn/connect failure,
// protocol error, an unparseable response) degrades to `undefined`, which
// callers (runWorldBuilder in main/agent/simulator.ts) treat as "research
// unavailable this run," never a run-ending error.
export async function runBraveWebSearch(query: string): Promise<BraveSearchResult[] | undefined> {
  try {
    const connection = await connect()
    if (!connection) return undefined

    const { tools } = await withTimeout(connection.client.listTools(), REQUEST_TIMEOUT_MS, 'Brave Search MCP tools/list')
    const tool = findWebSearchTool(tools)
    if (!tool) return undefined

    const result = await withTimeout(
      connection.client.callTool({ name: tool.name, arguments: { query } }),
      REQUEST_TIMEOUT_MS,
      'Brave Search MCP tools/call'
    )
    if ((result as { isError?: boolean }).isError) return []
    return parseResultBlocks((result as { content?: unknown }).content)
  } catch (err) {
    console.error('[mcp] Brave Search request failed', err)
    await killActiveBraveSearchProcess()
    return undefined
  }
}

// Called from main/index.ts's before-quit handler so a spawned Brave-search
// MCP child process never outlives the Electron app — same reasoning as the
// pre-existing removeCurrentProjectLock() call there.
export async function killActiveBraveSearchProcess(): Promise<void> {
  if (!active) return
  const { client } = active
  active = undefined
  try {
    await client.close()
  } catch {
    // Best-effort teardown — the process may already be gone.
  }
}
