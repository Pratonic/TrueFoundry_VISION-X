'use strict';

const http = require('node:http');
const { randomBytes } = require('node:crypto');

const string = { type: 'string' };
const integer = { type: 'integer' };
const schema = (properties, required) => ({
  type: 'object', properties, required, additionalProperties: false
});

const tools = [
  { name: 'search_workspace', description: 'Find tracked source paths or literal text matches.',
    inputSchema: schema({ query: string }, ['query']), annotations: { readOnlyHint: true } },
  { name: 'read_file', description: 'Read up to 200 lines from an existing project file. Lines are 1-based. Includes any accepted changes staged in memory.',
    inputSchema: schema({ path: string, start_line: integer, end_line: integer }, ['path']),
    annotations: { readOnlyHint: true } },
  { name: 'propose_edit', description: 'Propose exact text replacements in an existing file. Each old_text must be unique and replacements must not overlap. Read the latest file first. Accepted replacements are staged in memory.',
    inputSchema: schema({
      path: string,
      edits: { type: 'array', minItems: 1, maxItems: 12, items:
        schema({ old_text: string, new_text: string }, ['old_text', 'new_text']) }
    }, ['path', 'edits']), annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: 'run_command', description: 'Run a read-only Git command on the saved workspace. The user runs tests after applying and saving edits.',
    inputSchema: schema({ command: { enum: ['git status --short', 'git diff --stat'] } }, ['command']),
    annotations: { readOnlyHint: false, destructiveHint: false } }
];

async function startMcp(callTool) {
  const token = randomBytes(32).toString('hex');
  const server = http.createServer(async (req, res) => {
    const respond = (status, data) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(data == null ? undefined : JSON.stringify(data));
    };
    if (req.url !== '/mcp' || req.headers.authorization !== 'Bearer ' + token
        || req.headers.origin) return respond(403);
    if (req.method !== 'POST') return respond(405);
    let id = null;
    try {
      let size = 0;
      const body = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1_000_000) return respond(413);
        body.push(chunk);
      }
      const request = JSON.parse(Buffer.concat(body).toString('utf8'));
      id = request.id ?? null;
      if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
        return respond(400, { jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid request' } });
      }
      if (id === null) return respond(202);
      let result;
      switch (request.method) {
        case 'initialize': {
          const version = request.params?.protocolVersion;
          result = {
            protocolVersion: ['2025-11-25', '2025-06-18', '2025-03-26'].includes(version)
              ? version : '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'truforgery', version: '0.1.0' }
          };
          break;
        }
        case 'ping':
          result = {};
          break;
        case 'tools/list':
          result = { tools };
          break;
        case 'tools/call': {
          try {
            const value = await callTool(request.params?.name, request.params?.arguments ?? {});
            result = { content: [{ type: 'text', text: JSON.stringify(value) }] };
          } catch (error) {
            result = { isError: true, content: [{ type: 'text', text: error.message }] };
          }
          break;
        }
        default:
          return respond(200, { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
      }
      respond(200, { jsonrpc: '2.0', id, result });
    } catch {
      if (!res.headersSent && !res.destroyed) {
        respond(400, { jsonrpc: '2.0', id, error: { code: -32700, message: 'Invalid JSON' } });
      }
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: 'http://127.0.0.1:' + server.address().port + '/mcp',
    token,
    close() {
      server.close();
      server.closeAllConnections();
    }
  };
}

module.exports = { startMcp };
