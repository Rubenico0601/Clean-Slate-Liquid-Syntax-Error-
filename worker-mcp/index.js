/**
 * Liquid Error Finder — Remote MCP Server (Streamable HTTP transport).
 *
 * Exposes the CleverTap LiqP 0.7.9 linter, Leanplum→CleverTap converter,
 * and a CleverTap syntax rules reference as MCP tools any Claude client
 * can call by URL. Stateless, no auth, no secrets.
 */

import LiquidLinter from './liquid-linter.js';
import LeanplumConverter from './leanplum-converter.js';
import { CLEVERTAP_RULES } from './clevertap-rules.js';

const PROTOCOL_VERSION = '2025-03-26';
const SERVER_NAME = 'liquid-error-finder';
const SERVER_VERSION = '0.1.0';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
  'Access-Control-Allow-Headers': 'Content-Type, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Max-Age': '86400',
};

const TOOLS = [
  {
    name: 'lint_liquid',
    description:
      'Lint a CleverTap Liquid template (LiqP 0.7.9). Returns an array of errors and warnings with line and column numbers, plus a boolean `valid` flag. Use this whenever a user pastes a Liquid template and asks why it is broken or whether it will render.',
    inputSchema: {
      type: 'object',
      properties: {
        template: {
          type: 'string',
          description: 'The full Liquid template source code to lint.',
        },
      },
      required: ['template'],
    },
  },
  {
    name: 'convert_leanplum',
    description:
      'Convert a Leanplum (Jinja2-flavoured) Liquid template into CleverTap LiqP 0.7.9 syntax. Returns the converted template, an ordered list of transformations applied, and warnings about constructs that require manual review. Use this when migrating templates from Leanplum to CleverTap.',
    inputSchema: {
      type: 'object',
      properties: {
        template: {
          type: 'string',
          description: 'The Leanplum-flavoured Liquid template to convert.',
        },
      },
      required: ['template'],
    },
  },
  {
    name: 'list_clevertap_rules',
    description:
      'Return a markdown reference of CleverTap LiqP 0.7.9 syntax rules: supported tags and filters, personalisation token conventions (Profile.X, Event.X, bracket notation), nesting limits, and common Leanplum/Jinja2 migration pitfalls. Call this once at the start of any non-trivial Liquid review or authoring task.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id, error };
}

function toolResult(payload, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    isError,
  };
}

function runLint(template) {
  if (typeof template !== 'string') {
    throw new Error('`template` must be a string');
  }
  const linter = new LiquidLinter({ clevertapMode: true });
  const diagnostics = linter.lint(template);
  const issues = diagnostics.map((d) => ({
    line: d.line,
    column: d.col,
    severity: d.severity,
    message: d.message,
    ...(d.fix ? { fix: d.fix } : {}),
  }));
  return {
    valid: issues.every((i) => i.severity !== 'error'),
    errorCount: issues.filter((i) => i.severity === 'error').length,
    warningCount: issues.filter((i) => i.severity === 'warning').length,
    issues,
  };
}

function runConvert(template) {
  if (typeof template !== 'string') {
    throw new Error('`template` must be a string');
  }
  const converter = new LeanplumConverter();
  return converter.convert(template);
}

function handleToolCall(name, args) {
  switch (name) {
    case 'lint_liquid':
      return toolResult(runLint(args?.template));
    case 'convert_leanplum':
      return toolResult(runConvert(args?.template));
    case 'list_clevertap_rules':
      return { content: [{ type: 'text', text: CLEVERTAP_RULES }], isError: false };
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function handleRpc(message) {
  const { id, method, params } = message;

  if (method === 'initialize') {
    return jsonRpcResult(id, {
      protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    });
  }

  if (method === 'tools/list') {
    return jsonRpcResult(id, { tools: TOOLS });
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const args = params?.arguments || {};
    try {
      const result = handleToolCall(toolName, args);
      return jsonRpcResult(id, result);
    } catch (err) {
      return jsonRpcResult(id, toolResult({ error: err.message }, true));
    }
  }

  if (method === 'ping') {
    return jsonRpcResult(id, {});
  }

  if (method && method.startsWith('notifications/')) {
    return null;
  }

  return jsonRpcError(id, -32601, `Method not found: ${method}`);
}

function jsonResponse(body, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method === 'GET') {
      return new Response(
        'Liquid Error Finder MCP server. POST JSON-RPC 2.0 messages to this URL.',
        { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' } }
      );
    }

    if (request.method === 'DELETE') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(jsonRpcError(null, -32700, 'Parse error'), 400);
    }

    if (Array.isArray(body)) {
      const responses = body.map(handleRpc).filter((r) => r !== null);
      return responses.length === 0 ? new Response(null, { status: 202, headers: CORS_HEADERS }) : jsonResponse(responses);
    }

    const response = handleRpc(body);
    if (response === null) {
      return new Response(null, { status: 202, headers: CORS_HEADERS });
    }
    return jsonResponse(response);
  },
};
