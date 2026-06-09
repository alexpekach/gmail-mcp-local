'use strict';

/**
 * MCP JSON-RPC dispatch (transport-agnostic). Handles the MCP handshake and the
 * tools surface: initialize, tools/list, tools/call, ping, plus the initialized
 * notification. handleMessage(msg) is pure-ish (no I/O) so it is unit-testable;
 * the stdio transport (transport.js) feeds it parsed messages.
 *
 * Tool errors are returned as a RESULT with `isError: true` (MCP convention),
 * not as JSON-RPC protocol errors. Protocol-level problems (bad method, unknown
 * tool, parse error) use JSON-RPC error objects.
 */

const PROTOCOL_VERSION = '2024-11-05';

function toPublicTool(t) {
  return { name: t.name, description: t.description, inputSchema: t.inputSchema };
}

function createMcpServer({ tools = [], deps = {}, serverInfo = { name: 'gmail-mcp-local', version: '0.0.0' } } = {}) {
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  async function callTool(id, params) {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    const tool = toolMap.get(name);
    if (!tool) {
      return { jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${name}` } };
    }
    // Commercial license gate (no-op when deps.licenseGate is absent — OSS/free build).
    if (deps.licenseGate) {
      const lic = await deps.licenseGate.check();
      if (!lic.ok) {
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `License required: ${lic.message || lic.reason}` }], isError: true } };
      }
    }
    try {
      const result = await tool.handler(args, deps);
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } };
    } catch (e) {
      const text = `Error: ${e && e.message ? e.message : String(e)}`;
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: true } };
    }
  }

  async function handleMessage(msg) {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') {
      const id = (msg && msg.id !== undefined) ? msg.id : null;
      return { jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid Request' } };
    }
    const { method, id, params } = msg;
    const isNotification = (id === undefined || id === null);

    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0', id,
          result: {
            protocolVersion: (params && params.protocolVersion) || PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo,
          },
        };
      case 'notifications/initialized':
      case 'initialized':
        return null; // notification — no response
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: tools.map(toPublicTool) } };
      case 'tools/call':
        return callTool(id, params);
      default:
        if (isNotification) return null;
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
    }
  }

  return { handleMessage, serverInfo, tools, PROTOCOL_VERSION };
}

module.exports = { createMcpServer, PROTOCOL_VERSION };
