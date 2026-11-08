#!/usr/bin/env node
/* Mini-CAT Eval Runner — 评测翻译 agent 是否正确使用 TM 和术语库。
 *
 * 两种模式：
 * 1. validate（默认）— 验证 MCP server 工具 + 指标计算（不需要 LLM）
 * 2. agent <claude>   — 启动 LLM agent 执行翻译任务（需要 LLM API）
 *
 * 从 REA (morluto/rea) 借鉴的模式：
 * - 任务按场景分类（TM 命中 / 术语冲突 / 过期拒绝 / 无匹配）
 * - 每个 agent 行为有对应的自动化断言
 * - 指标基于工具调用序列，而非主观评分 */
'use strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { CatStore } from '../mcp/store.js';
import { calculateMetrics, checkTmReuse, checkTermConsistency } from './metrics.js';

const MODE = process.argv[2] || 'validate';
import path from 'node:path';
const TASKS_PATH = path.resolve('eval', 'tasks.json');
const tasksData = JSON.parse(readFileSync(TASKS_PATH, 'utf8'));

/* ---- 模式 1: validate — 验证 MCP server + 指标计算 ---- */
if (MODE === 'validate') {
  console.log('=== Mini-CAT Eval: Validate Mode ===\n');
  let pass = 0, fail = 0;
  const ok = (c, n) => { if (c) { pass++; } else { fail++; console.error('  ✗ ' + n); } };

  for (const task of tasksData.tasks) {
    console.log(`\n[Task ${task.id}] ${task.type} — ${task.description}`);
    const store = new CatStore({ segments: [], termbase: task.setup.termbase, tm: task.setup.tm });

    // 1. TM 查询
    const tmHits = store.tmLookup(task.source);
    console.log(`  TM 查询: ${tmHits.length} 条, 最高分 ${tmHits[0]?.matchScore ?? 0}`);
    if (task.type === 'tm_exact') {
      ok(tmHits.length > 0 && tmHits[0].matchScore >= 99, 'TM 精确匹配存在');
    }
    if (task.type === 'tm_stale') {
      ok(tmHits.length > 0 && tmHits[0].matchScore < 95, 'TM 有匹配但非精确（stale 场景）');
    }
    if (task.type === 'no_resource') {
      ok(tmHits.length === 0, 'TM 无匹配（预期）');
    }

    // 2. 术语查询
    const termHits = store.termLookup(task.source);
    console.log(`  术语查询: ${termHits.length} 条`);
    if (task.expected.termCheck) {
      ok(termHits.length > 0, '术语表命中存在');
      ok(termHits.length === task.expected.termCheck.length, `术语数匹配 (${termHits.length}/${task.expected.termCheck.length})`);
    }

    // 3. 模拟 agent 行为（正确 vs 错误）
    // 正确 agent：查 TM → 查术语 → 翻译 → 查体例
    const goodAgent = {
      toolCalls: ['tm_lookup', 'term_lookup', 'style_check', 'segment_submit'],
      taskType: task.type,
      tmReused: task.type === 'tm_exact', // 正确 agent 在 exact 时复用
      expected: task.expected,
      termConsistent: task.expected.termCheck ? true : undefined,
      stylePassed: true
    };
    // 错误 agent：跳过 TM/术语查询，直接翻译
    const badAgent = {
      toolCalls: ['segment_submit'],
      taskType: task.type,
      tmReused: false,
      expected: task.expected,
      termConsistent: false,
      stylePassed: false
    };

    // 指标计算验证
    const goodMetrics = calculateMetrics([goodAgent]);
    const badMetrics = calculateMetrics([badAgent]);
    ok(goodMetrics.tmLookupRate === 100, 'good agent: tm_lookup 100%');
    ok(badMetrics.tmLookupRate === 0, 'bad agent: tm_lookup 0%');
    if (task.type === 'tm_exact') {
      ok(goodMetrics.tmReuseRate === 100, 'good agent: TM reuse 100%');
      ok(badMetrics.tmReuseRate === 0, 'bad agent: TM reuse 0%');
    }
    if (task.expected.termCheck) {
      ok(goodMetrics.termConsistencyRate === 100, 'good agent: term consistency 100%');
      ok(badMetrics.termConsistencyRate === 0, 'bad agent: term consistency 0%');
    }
    ok(goodMetrics.agentScore > badMetrics.agentScore, `agent score: good(${goodMetrics.agentScore}) > bad(${badMetrics.agentScore})`);
  }

  console.log(`\n=== Validate: ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
}

/* ---- 模式 2: agent — 启动 LLM agent 执行翻译任务 ---- */
if (MODE === 'agent') {
  console.log('=== Mini-CAT Eval: Agent Mode ===\n');
  console.log('此模式需要 LLM API key 和 agent 框架（如 Claude Code + MCP）。');
  console.log('配置方法：将 mcp/server.mjs 注册为 MCP server，agent 会自动获得翻译工具。');
  console.log('评测指标自动从工具调用序列计算。');
  // TODO: 集成 LLM API（Claude/GPT/本地模型）
  // 1. Spawn MCP server
  // 2. For each task: send source to agent with MCP tools
  // 3. Record tool calls + translations
  // 4. Calculate metrics
  process.exit(0);
}

/* ---- 工具函数 ---- */
