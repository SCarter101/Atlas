import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// braveSearchAdapter.ts calls main/security/keyVault.ts's getSecret(), which
// in production does a real Electron safeStorage + filesystem round trip —
// mocked here the same way openRouterAdapter.test.ts mocks it. The real MCP
// SDK's Client/StdioClientTransport are also mocked at the module boundary
// (vi.mock calls are hoisted above imports) so these tests never actually
// spawn a child process or hit a real MCP wire protocol.
const getSecretMock = vi.fn()
vi.mock('../security/keyVault', () => ({
  getSecret: (name: string) => getSecretMock(name)
}))

const connectMock = vi.fn()
const listToolsMock = vi.fn()
const callToolMock = vi.fn()
const closeMock = vi.fn()
const transportCloseMock = vi.fn()

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = connectMock
    listTools = listToolsMock
    callTool = callToolMock
    close = closeMock
  }
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class {
    close = transportCloseMock
    constructor(public params: unknown) {}
  }
}))

const { runBraveWebSearch, killActiveBraveSearchProcess } = await import('./braveSearchAdapter')

function webResultBlock(url: string, title: string, description: string): { type: 'text'; text: string } {
  return { type: 'text', text: JSON.stringify({ url, title, description }) }
}

describe('runBraveWebSearch', () => {
  beforeEach(() => {
    getSecretMock.mockReset()
    connectMock.mockReset().mockResolvedValue(undefined)
    listToolsMock.mockReset().mockResolvedValue({
      tools: [{ name: 'brave_web_search', inputSchema: { properties: { query: { type: 'string' } } } }]
    })
    callToolMock.mockReset().mockResolvedValue({
      isError: false,
      content: [webResultBlock('https://example.com/a', 'Example A', 'First result'), webResultBlock('https://example.com/b', 'Example B', 'Second result')]
    })
    closeMock.mockReset()
    transportCloseMock.mockReset()
  })

  afterEach(async () => {
    // Reset the module's cached connection between tests — otherwise a
    // connection established in one test would silently carry over into the
    // next (this is exactly why killActiveBraveSearchProcess exists as a
    // real export, not just for main/index.ts's before-quit hook).
    await killActiveBraveSearchProcess()
  })

  it('returns undefined immediately with no API key configured, never attempting to connect', async () => {
    getSecretMock.mockResolvedValue(null)

    const result = await runBraveWebSearch('dragons in medieval folklore')

    expect(result).toBeUndefined()
    expect(connectMock).not.toHaveBeenCalled()
  })

  it('connects, discovers the real web-search tool via tools/list, calls it, and parses each result block', async () => {
    getSecretMock.mockResolvedValue('test-brave-key')

    const result = await runBraveWebSearch('dragons in medieval folklore')

    expect(result).toEqual([
      { title: 'Example A', url: 'https://example.com/a', snippet: 'First result' },
      { title: 'Example B', url: 'https://example.com/b', snippet: 'Second result' }
    ])
    expect(connectMock).toHaveBeenCalledTimes(1)
    expect(callToolMock).toHaveBeenCalledWith({ name: 'brave_web_search', arguments: { query: 'dragons in medieval folklore' } })
  })

  it('returns an empty array (not undefined) when the server reports isError for a zero-result query', async () => {
    getSecretMock.mockResolvedValue('test-brave-key')
    callToolMock.mockResolvedValue({ isError: true, content: [{ type: 'text', text: 'No web results found' }] })

    const result = await runBraveWebSearch('a query with no matches')

    expect(result).toEqual([])
  })

  it('skips content blocks that are not valid JSON or missing url/title, without throwing', async () => {
    getSecretMock.mockResolvedValue('test-brave-key')
    callToolMock.mockResolvedValue({
      isError: false,
      content: [
        { type: 'text', text: 'not json at all' },
        { type: 'text', text: JSON.stringify({ title: 'Missing URL' }) },
        webResultBlock('https://example.com/c', 'Example C', 'Third result')
      ]
    })

    const result = await runBraveWebSearch('query')

    expect(result).toEqual([{ title: 'Example C', url: 'https://example.com/c', snippet: 'Third result' }])
  })

  it('returns undefined when no tool in tools/list looks like a web-search tool', async () => {
    getSecretMock.mockResolvedValue('test-brave-key')
    listToolsMock.mockResolvedValue({ tools: [{ name: 'brave_image_search', inputSchema: { properties: {} } }] })

    const result = await runBraveWebSearch('query')

    expect(result).toBeUndefined()
    expect(callToolMock).not.toHaveBeenCalled()
  })

  it('never throws and returns undefined when the connection itself fails, cleaning up the half-started transport', async () => {
    getSecretMock.mockResolvedValue('test-brave-key')
    connectMock.mockRejectedValue(new Error('spawn failed'))

    const result = await runBraveWebSearch('query')

    expect(result).toBeUndefined()
    expect(transportCloseMock).toHaveBeenCalledTimes(1)
  })

  it('never throws and returns undefined when tools/call itself rejects', async () => {
    getSecretMock.mockResolvedValue('test-brave-key')
    callToolMock.mockRejectedValue(new Error('network error'))

    const result = await runBraveWebSearch('query')

    expect(result).toBeUndefined()
  })

  it('reuses the same connection across calls instead of reconnecting each time', async () => {
    getSecretMock.mockResolvedValue('test-brave-key')

    await runBraveWebSearch('first query')
    await runBraveWebSearch('second query')

    expect(connectMock).toHaveBeenCalledTimes(1)
    expect(callToolMock).toHaveBeenCalledTimes(2)
  })

  it('killActiveBraveSearchProcess closes the client and forces a fresh connection on the next call', async () => {
    getSecretMock.mockResolvedValue('test-brave-key')

    await runBraveWebSearch('first query')
    await killActiveBraveSearchProcess()
    await runBraveWebSearch('second query')

    expect(closeMock).toHaveBeenCalledTimes(1)
    expect(connectMock).toHaveBeenCalledTimes(2)
  })
})
