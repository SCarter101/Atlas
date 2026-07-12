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

// No servers are configured in this build — the registry exists so the
// agent runtime has a real (if empty) discovery point to call, rather than
// MCP being unaddressed anywhere in the codebase. Configuring a server here
// and implementing a real McpAdapter is the Phase 3+ path to production
// MCP connectivity.
export const configuredMcpServers: McpServerConfig[] = []
