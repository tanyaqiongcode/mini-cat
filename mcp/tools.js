/* Mini-CAT MCP Tool Definitions — 每个 tool 自带教学描述，agent 读了就知道何时/如何使用。 */
'use strict';

export function defineTools(store) {
  return [
    {
      name: 'tm_lookup',
      description: '查询翻译记忆库（TM）。输入中文源文，返回最相似的已有翻译（含匹配分数和类型）。' +
        '翻译新句子之前 MUST 调用此工具：如果有 100% 匹配，直接复用旧译文；如果有 75-99% 模糊匹配，参考旧译文并调整差异部分。' +
        '如果没有 ≥50% 匹配，说明记忆库没有覆盖这个句子，需要自行翻译。',
      inputSchema: {
        type: 'object', properties: {
          source: { type: 'string', description: '中文源文（整句或整段）' }
        }, required: ['source']
      },
      handler: async (args) => {
        const hits = store.tmLookup(args.source);
        if (!hits.length) return { content: [{ type: 'text', text: 'TM 无匹配（<50%）。请自行翻译。' }] };
        const lines = hits.map(h =>
          `[${h.matchScore}% ${h.matchType}] ${h.src.slice(0, 60)}… → ${h.tgt.slice(0, 80)}（来源：${h.origin || '未知'}）`);
        return { content: [{ type: 'text', text: `TM 匹配 ${hits.length} 条：\n` + lines.join('\n') }] };
      }
    },
    {
      name: 'term_lookup',
      description: '查找源文中的术语。输入中文源文，返回所有命中的术语及其规定译法。' +
        '翻译前 MUST 调用此工具：返回的术语译法来自项目术语表，MUST 按术语表译法翻译，不得自行发明。' +
        '如果返回为空，说明源文没有术语表覆盖的术语。',
      inputSchema: {
        type: 'object', properties: {
          source: { type: 'string', description: '中文源文' }
        }, required: ['source']
      },
      handler: async (args) => {
        const hits = store.termLookup(args.source);
        if (!hits.length) return { content: [{ type: 'text', text: '术语表无匹配术语。' }] };
        const lines = hits.map(t => `「${t.zh}」→ ${t.en}${t.note ? '（' + t.note + '）' : ''}`);
        return { content: [{ type: 'text', text: `术语表命中 ${hits.length} 条：\n` + lines.join('\n') }] };
      }
    },
    {
      name: 'segment_get',
      description: '获取工作区中指定序号的句段（含中文原文、当前译文、修订历史）。',
      inputSchema: {
        type: 'object', properties: {
          index: { type: 'number', description: '句段序号（从 0 开始）' }
        }, required: ['index']
      },
      handler: async (args) => {
        const seg = store.getSegment(args.index);
        if (!seg) return { content: [{ type: 'text', text: '句段不存在。' }] };
        return { content: [{ type: 'text', text: JSON.stringify(seg, null, 1).slice(0, 2000) }] };
      }
    },
    {
      name: 'segment_list',
      description: '列出工作区所有句段（含中文原文和翻译状态）。用于了解整个翻译任务的规模和进度。',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        const segs = store.listSegments().map((s, i) => `${i}: [${s.status}] ${s.src.slice(0, 40)}…`);
        return { content: [{ type: 'text', text: `工作区 ${segs.length} 段：\n` + segs.join('\n') }] };
      }
    },
    {
      name: 'segment_submit',
      description: '提交一个句段的译文。提交前 MUST 先调用 tm_lookup 和 term_lookup 确认资源使用正确。' +
        '提交后译文进入修订历史（可追溯）。',
      inputSchema: {
        type: 'object', properties: {
          index: { type: 'number', description: '句段序号' },
          translation: { type: 'string', description: '英文译文' },
          author: { type: 'string', description: '译者署名' }
        }, required: ['index', 'translation']
      },
      handler: async (args) => {
        const r = store.submitSegment(args.index, args.translation, args.author);
        if (!r.ok) return { content: [{ type: 'text', text: r.reason }], isError: true };
        return { content: [{ type: 'text', text: `句段 ${args.index} 已提交。` }] };
      }
    },
    {
      name: 'style_check',
      description: '检查英文译文是否符合项目体例规范（Style Sheet V2.6）。' +
        '检查项：BCE/CE、en dash、1930s 撇号、单位空格、禁用评价词、术语表一致性。' +
        '提交译文前 SHOULD 调用此工具，修复所有"违规"级问题。',
      inputSchema: {
        type: 'object', properties: {
          translation: { type: 'string', description: '英文译文' },
          source: { type: 'string', description: '中文源文（用于术语表一致性检查）' }
        }, required: ['translation']
      },
      handler: async (args) => {
        const r = store.styleCheck(args.translation, args.source);
        if (r.passed) return { content: [{ type: 'text', text: '体例检查通过。' }] };
        const lines = r.flags.map(f => `[${f.rule}] ${f.message}`);
        return { content: [{ type: 'text', text: `体例检查发现 ${r.flags.length} 个问题：\n` + lines.join('\n') }] };
      }
    },
    {
      name: 'project_stats',
      description: '获取翻译项目统计（段落数、已译数、字数、术语数、记忆库大小）。',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        const s = store.segments;
        const done = s.filter(x => x.status === 'translated').length;
        const zhChars = s.reduce((a, x) => a + (x.src.match(/[\u4e00-\u9fff]/g) || []).length, 0);
        return { content: [{ type: 'text', text: `段落 ${done}/${s.length}，中文 ${zhChars} 字，术语 ${store.termbase.length} 条，记忆库 ${store.tm.length} 条。` }] };
      }
    }
  ];
}
