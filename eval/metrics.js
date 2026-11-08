/* Mini-CAT Eval Metrics — 翻译 agent 资源使用行为评测指标。
 * 从 REA 的"evidence-based assertion"模式借鉴：
 * 每个指标基于 agent 的工具调用序列和产出内容，而非主观评分。 */
'use strict';

export function calculateMetrics(taskResults) {
  const total = taskResults.length;
  if (!total) return {};

  /* 工具调用行为 */
  const tmLookupTasks = taskResults.filter(r => r.toolCalls.includes('tm_lookup'));
  const termLookupTasks = taskResults.filter(r => r.toolCalls.includes('term_lookup'));
  const styleCheckTasks = taskResults.filter(r => r.toolCalls.includes('style_check'));

  /* TM 复用行为 */
  const tmExactTasks = taskResults.filter(r => r.taskType === 'tm_exact');
  const tmReused = tmExactTasks.filter(r => r.tmReused === true);
  const tmStaleTasks = taskResults.filter(r => r.taskType === 'tm_stale');
  const tmStaleIncorrectlyReused = tmStaleTasks.filter(r => r.tmReused === true);

  /* 术语一致性 */
  const termTasks = taskResults.filter(r => r.expected.termCheck);
  const termPassed = termTasks.filter(r => r.termConsistent === true);

  /* 体例合规 */
  const stylePassed = taskResults.filter(r => r.stylePassed === true);

  return {
    /* 覆盖率 */
    totalTasks: total,
    /* 工具使用率 */
    tmLookupRate: pct(tmLookupTasks.length, total),
    termLookupRate: pct(termLookupTasks.length, total),
    styleCheckRate: pct(styleCheckTasks.length, total),
    /* TM 复用 */
    tmExactCount: tmExactTasks.length,
    tmReuseRate: pct(tmReused.length, tmExactTasks.length),
    /* 术语一致性 */
    termTaskCount: termTasks.length,
    termConsistencyRate: pct(termPassed.length, termTasks.length),
    /* 错误复用 */
    tmStaleCount: tmStaleTasks.length,
    errorReuseRate: pct(tmStaleIncorrectlyReused.length, tmStaleTasks.length),
    /* 体例合规 */
    styleComplianceRate: pct(stylePassed.length, total),
    /* 综合评分 */
    agentScore: calculateAgentScore({
      tmLookupRate: pct(tmLookupTasks.length, total),
      termLookupRate: pct(termLookupTasks.length, total),
      tmReuseRate: pct(tmReused.length, tmExactTasks.length),
      termConsistencyRate: pct(termPassed.length, termTasks.length),
      errorReuseRate: pct(tmStaleIncorrectlyReused.length, tmStaleTasks.length),
      styleComplianceRate: pct(stylePassed.length, total)
    })
  };
}

function pct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0; }

/* 综合评分（0-100）：
 * 正向指标（查 TM、查术语、复用正确、术语一致、体例合规）加权求和
 * 负向指标（错误复用）扣分 */
function calculateAgentScore(m) {
  let score = 0;
  score += m.tmLookupRate * 0.15;         // 查 TM 是基本操作
  score += m.termLookupRate * 0.15;       // 查术语是基本操作
  score += m.tmReuseRate * 0.20;          // 正确复用 TM
  score += m.termConsistencyRate * 0.25;  // 术语一致性（最重要）
  score += m.styleComplianceRate * 0.15;  // 体例合规
  score -= m.errorReuseRate * 0.10;       // 错误复用扣分
  return Math.max(0, Math.min(100, Math.round(score)));
}

/* 检查 agent 的译文是否复用了 TM */
export function checkTmReuse(translation, tmEntry) {
  if (!tmEntry || !tmEntry.tgt) return false;
  const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const overlap = diceSimilarity(norm(translation), norm(tmEntry.tgt));
  return overlap >= 0.7;
}

/* 检查 agent 的译文是否使用了术语表译法 */
export function checkTermConsistency(translation, termCheck) {
  if (!termCheck || !termCheck.length) return true;
  const lower = String(translation || '').toLowerCase();
  return termCheck.every(en => lower.includes(en.toLowerCase()));
}

function diceSimilarity(a, b) {
  const bg = s => { const o = new Set(); for (let i = 0; i < s.length - 1; i++) o.add(s.slice(i, i + 2)); return o; };
  const A = bg(a), B = bg(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}
