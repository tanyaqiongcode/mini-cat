/* Mini-CAT MCP Data Store — 内存中的 TM / 术语库 / 句段工作区。
 * 从 JSON 文件加载，被 MCP tools 和 eval runner 共享。
 * 零依赖。 */
'use strict';
import { readFileSync } from 'node:fs';

export class CatStore {
  constructor(dataOrPath) {
    const raw = typeof dataOrPath === 'string'
      ? JSON.parse(readFileSync(dataOrPath, 'utf8'))
      : dataOrPath;
    this.segments = raw.segments || [];     // [{src, tgt, status, para, ...}]
    this.termbase = raw.termbase || [];     // [{zh, en, note}]
    this.tm = raw.tm || [];                 // [{src, tgt, score, origin}]
    this.stylesheet = raw.stylesheet || {}; // { rules: [...] }
    this.meta = raw.meta || {};             // {project, author, ...}
  }

  /* ---- TM 查询 ---- */
  tmLookup(sourceText) {
    const norm = normalize(sourceText);
    return this.tm.map(entry => {
      const score = dice(norm, normalize(entry.src));
      return { ...entry, matchScore: Math.round(score * 100), matchType: score >= 0.99 ? 'exact' : score >= 0.75 ? 'fuzzy' : 'no-match' };
    }).filter(e => e.matchScore >= 50)
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 5);
  }

  /* ---- 术语查找 ---- */
  termLookup(sourceText) {
    return this.termbase.filter(t => sourceText.includes(t.zh))
      .map(t => ({ ...t, found: true }));
  }

  /* ---- 句段操作 ---- */
  getSegment(i) { return this.segments[i] || null; }
  listSegments() { return this.segments; }

  submitSegment(i, translation, author) {
    const seg = this.segments[i];
    if (!seg) return { ok: false, reason: '句段不存在' };
    if (!Array.isArray(seg.revisions)) seg.revisions = [];
    if (!Diff.sameText(seg.tgt || '', translation)) {
      seg.revisions.push({ v: 'V' + (seg.revisions.length + 1), author: author || 'agent', text: translation, date: new Date().toISOString().slice(0, 10) });
    }
    seg.tgt = translation;
    seg.status = 'translated';
    seg.submittedBy = author || 'agent';
    seg.submittedAt = new Date().toISOString();
    return { ok: true, segment: seg };
  }

  /* ---- 体例检查 ---- */
  styleCheck(translation, sourceText) {
    const flags = [];
    // BCE/CE
    if (/\b(BC|AD)\b/.test(translation)) flags.push({ rule: 'calendar', message: '应使用 BCE/CE 而非 BC/AD' });
    // en dash
    if (/\b(1\d{3}|20\d{2})\s*-\s*(1\d{3}|20\d{2})\b/.test(translation)) flags.push({ rule: 'endash', message: '年代范围应使用 en dash' });
    // 1930's
    if (/\b(19|20)\d0['\u2019]s\b/.test(translation)) flags.push({ rule: 'decade', message: '年代十位不加撇号' });
    // 单位空格
    const tight = translation.match(/\b\d+(cm|mm|kg|°C)\b/);
    if (tight) flags.push({ rule: 'units', message: `数值与单位之间留空格：${tight[0]}` });
    // 禁用评价词
    for (const w of ['dazzling', 'enchanting', 'revolutionary', 'breathtaking']) {
      if (new RegExp('\\b' + w + '\\b', 'i').test(translation)) flags.push({ rule: 'praise', message: `禁用评价词：${w}` });
    }
    // 术语表一致性
    for (const t of this.termbase) {
      if (!t.zh || !t.en) continue;
      if (sourceText && sourceText.includes(t.zh)) {
        const re = new RegExp(t.en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'i');
        if (!re.test(translation)) flags.push({ rule: 'termbase', message: `术语「${t.zh}」应使用术语表译法 ${t.en}` });
      }
    }
    return { passed: flags.length === 0, flags };
  }

  /* ---- 序列化 ---- */
  toJSON() {
    return JSON.stringify({ segments: this.segments, termbase: this.termbase, tm: this.tm, meta: this.meta }, null, 1);
  }
}

/* ---- 内部工具（与 core.js 保持一致） ---- */
function normalize(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
function bigrams(s) { const t = normalize(s); const out = new Set(); if (t.length === 1) { out.add(t); return out; } for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2)); return out; }
function dice(a, b) { const A = bigrams(a), B = bigrams(b); if (!A.size || !B.size) return 0; let inter = 0; for (const g of A) if (B.has(g)) inter++; return (2 * inter) / (A.size + B.size); }
const Diff = { sameText: (a, b) => String(a || '').replace(/\s+/g, ' ').trim() === String(b || '').replace(/\s+/g, ' ').trim() };
