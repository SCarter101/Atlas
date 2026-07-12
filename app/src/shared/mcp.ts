import type { CapabilityManifest } from './schema/capability'

// MCP-compatible adapter architecture — spec §8: "MCP-compatible adapters
// should allow Atlas to discover and invoke external MCP tools and
// resources without making the internal runtime dependent on MCP."
//
// This is the Phase 2 scope: the adapter *shape* the runtime is built
// against, not a working MCP client. An adapter's job is to translate an
// external MCP server's tools into ordinary CapabilityManifest entries (so
// the rest of Atlas — discovery, permission checks, the routing
// visualization, context inspection — treats an MCP tool exactly like any
// other tool) and to translate a ToolCall into the MCP wire protocol.
// Production MCP connectivity (spec §15, Phase 2 "Not included") means
// implementing McpAdapter for real, not changing this interface.

export type McpTransport = 'stdio' | 'http'

export interface McpServerConfig {
  id: string
  name: string
  transport: McpTransport
  command?: string // stdio transport
  url?: string // http transport
}

export interface McpAdapter {
  server: McpServerConfig
  discoverTools(): Promise<CapabilityManifest[]>
  invokeTool(toolId: string, input: unknown): Promise<unknown>
}

// Illustrative stub — demonstrates that McpAdapter is actually implementable
// against a stdio-transport server without committing to a real MCP client.
// A production version would spawn `server.command`, speak the MCP
// JSON-RPC handshake (initialize → tools/list → tools/call) over the
// child process's stdin/stdout, and map each returned tool description
// into a CapabilityManifest entry. None of that wire protocol exists here;
// this class is never instantiated anywhere in the app (see simulator.ts's
// no-op discovery loop) — it exists purely so the adapter shape has a
// concrete, readable example next to the interface it implements.
export class StdioMcpAdapter implements McpAdapter {
  constructor(public server: McpServerConfig) {}

  async discoverTools(): Promise<CapabilityManifest[]> {
    // Real implementation: spawn(server.command), send an `initialize`
    // request, then `tools/list`, then translate each tool's JSON schema
    // into a CapabilityManifest entry (name, description, input schema,
    // and a permission/data-scope classification per spec §13).
    return []
  }

  async invokeTool(toolId: string, _input: unknown): Promise<unknown> {
    // Real implementation: send a `tools/call` request for `toolId` over
    // the same stdio connection and resolve with its result payload.
    throw new Error(`StdioMcpAdapter is illustrative scaffolding — cannot invoke "${toolId}" on ${this.server.name}`)
  }
}

// Example entries only — illustrative of the kind of external research/
// world-building tools a novelist might wire up (a sandboxed filesystem
// reader for source material, a web-search server for fact-checking), not
// servers Atlas actually talks to. Nothing in the runtime calls
// discoverTools()/invokeTool() on these (simulator.ts's discovery loop is a
// documented no-op — see the comment there), so listing them here has no
// effect on behavior; it only makes the intended shape of a real entry
// legible. Configuring a *real* server and implementing a real McpAdapter
// for it is the Phase 3+ path to production MCP connectivity.
export const configuredMcpServers: McpServerConfig[] = [
  {
    id: 'example-research-filesystem',
    name: 'Example: Research Folder (illustrative, not connected)',
    transport: 'stdio',
    command: 'mcp-server-filesystem --root ~/Documents/Research'
  },
  {
    id: 'example-web-search',
    name: 'Example: Web Search (illustrative, not connected)',
    transport: 'http',
    url: 'https://example.invalid/mcp/web-search'
  }
]
