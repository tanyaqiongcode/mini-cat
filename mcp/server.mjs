#!/usr/bin/env node
/* Mini-CAT MCP Server — 零依赖 stdio JSON-RPC 2.0。
 * 启动: node mcp/server.mjs --data <project.json>
 * 协议: MCP 2.0 (stdio transport)
 *
 * 从 REA (morluto/rea) 借鉴的模式：
 * - 每个 tool 自带教学描述（agent 读了就知道何时/如何用）
 * - 工具返回结构化证据（匹配分数、来源、限制）
 * - 本地执行，数据不出本机 */
'use strict';
import { createInterface } from 'node:readline';
import { CatStore } from './store.js';
import { defineTools } from './tools.js';

// ---- 启动参数 ----
const dataIdx = process.argv.indexOf('--data');
const dataPath = dataIdx > -1 ? process.argv[dataIdx + 1] : null;
if (!dataPath) { console.error('用法: node mcp/server.mjs --data <project.json>'); process.exit(1); }

const store = new CatStore(dataPath);
const tools = defineTools(store);
const toolMap = new Map(tools.map(t => [t.name, t]));

// ---- JSON-RPC 处理 ----
const rl = createInterface({ input: process.stdin });
rl.on('line', line => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (!msg.id || !msg.method) return;
  handle(msg).then(resp => {
    if (resp) process.stdout.write(JSON.stringify(resp) + '\n');
  });
});

async function handle(msg) {
  const { id, method, params } = msg;
  try {
    switch (method) {
      case 'initialize':
        return resp(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'mini-cat', version: '1.0.0' }
        });
      case 'notifications/initialized': return null;
      case 'tools/list':
        return resp(id, { tools: tools.map(({ handler, ...def }) => def) });
      case 'tools/call': {
        const tool = toolMap.get(params.name);
        if (!tool) return resp(id, { error: { code: -32602, message: `未知工具 ${params.name}` } }, msg.id);
        const result = await tool.handler(params.arguments || {});
        return resp(id, result, msg.id);
      }
      case 'resources/list': return resp(id, { resources: [] });
      case 'prompts/list': return resp(id, { prompts: [] });
      default:
        return resp(id, { error: { code: -32601, message: `方法 ${method} 不存在` } }, msg.id);
    }
  } catch (err) {
    return resp(id, { error: { code: -32603, message: err.message } }, msg.id);
  }
}

function resp(id, result, reqId) {
  return { jsonrpc: '2.0', id: reqId ?? id, result: result ?? {} };
}

// 保活
process.stdin.resume();
process.on('SIGTERM', () => process.exit(0));
console.error(`[mini-cat-mcp] 已启动，数据: ${dataPath}，工具: ${tools.map(t => t.name).join(', ')}`);
