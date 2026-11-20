/* Mini-CAT revimport.js — 修订导入文件解析：docx/xlsx/TMX/JSONL/CSV/TSV → {pairs, comments, meta, note}。
 * 从 app.js 的 bindEvents 闭包抽离（v1.12 的 dataRow 回归正是从那段闭包漏测出去的），
 * Node 无头可测、纳入 c8 统计；app.js 只保留 UI 编排。 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./io.js'), require('./msoffice.js'));
  else root.MiniCatRevImport = factory(root.MiniCatIO, root.MiniCatOffice);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (IO, Office) {
  'use strict';

  async function parseFile(f) {
    if (/\.docx$/i.test(f.name)) {
      const parsed = await Office.docxToBlocks(await f.arrayBuffer());
      const t = parsed.tables.find(t2 => t2.rows.length >= 1 && t2.rows[0].length >= 2);
      if (t) {
        // 首行若本身携带 Word 修订标记，则它是数据行而非表头
        const firstRowTracked = (t.rowTracked || []).some(x => x.row === 0);
        const header = firstRowTracked ? t.rows[0].map((_, i2) => '列' + (i2 + 1)) : t.rows[0].map(c2 => String(c2 || '').trim());
        const dataRows = firstRowTracked ? t.rows : t.rows.slice(1);
        const sniff = Office.sniffDocxTable([header, ...dataRows.slice(0, 10)]);
        if (sniff) {
          const pairs = [], comments = [];
          dataRows.forEach((r, ri) => {
            const zh = String(r[sniff.srcCol] || ''), en = String(r[sniff.tgtCol] || '');
            if (!zh.trim() && !en.trim()) return;
            // rowTracked/cellRuns/rowComments 的 row 都是含表头的绝对行号；数据行序号 ri 需换算
            const absRow = firstRowTracked ? ri : ri + 1;
            // 自动识别：Word 修订模式携带的修订人与时间
            const trk = (t.rowTracked || []).find(x => x.row === absRow && x.col === sniff.tgtCol);
            // 自动识别：目标单元格的运行级格式（加粗/斜体，供修订回导保留）
            const cr = (t.cellRuns || []).find(x => x.row === absRow && x.col === sniff.tgtCol);
            const pairIndex = pairs.length;
            pairs.push({ zh, en, author: trk ? trk.author : undefined, date: trk ? trk.date : undefined, runs: cr ? cr.runs : undefined });
            // 自动识别：Word 批注（导师/专家意见）
            (t.rowComments || []).filter(rc => rc.row === absRow && rc.col === sniff.tgtCol).forEach(rc => {
              rc.ids.forEach(id => {
                const c2 = (parsed.comments || []).find(cc => String(cc.id) === String(id));
                if (c2 && c2.text) comments.push({ pairIndex, zh, author: c2.author, date: c2.date, text: c2.text });
              });
            });
          });
          return { pairs, comments, meta: parsed.meta, note: 'docx 表格' };
        }
      }
      return { pairs: parsed.paragraphs.filter(Boolean).map(p => ({ zh: p, en: '' })), comments: [], meta: parsed.meta, note: 'docx 段落（仅原文）' };
    }
    if (/\.xlsx$/i.test(f.name)) {
      const sheets = await Office.xlsxToSheets(await f.arrayBuffer());
      const sheet = sheets.reduce((a, b) => (b.rows.length > a.rows.length ? b : a));
      const header = (sheet.rows[0] || []).map(h => String(h || '').trim());
      const m = IO.mapBilingualHeader(header);
      return { pairs: sheet.rows.slice(1).map(r => ({ zh: String(r[m.src] || ''), en: m.tgt >= 0 ? String(r[m.tgt] || '') : '' })), note: 'xlsx「' + sheet.name + '」' };
    }
    const text = await IO.readAsText(f);
    if (/<tmx[\s>]/i.test(text.slice(0, 400))) {
      const { tus } = IO.parseTMX(text);
      return { pairs: tus.map(tu => ({ zh: tu.src, en: tu.tgt })), note: 'TMX' };
    }
    if (/\.jsonl$/i.test(f.name)) {
      const { rows, errors } = IO.parseJSONLVerbose(text);
      const good = rows.filter(o => o.zh && o.en).map(o => ({ zh: o.zh, en: o.en }));
      const badCount = rows.length - good.length + errors.length;
      const note = badCount > 0 ? `JSONL（成功 ${good.length}，跳过 ${badCount} 行）` : 'JSONL';
      return { pairs: good, note };
    }
    const { rows, mapping } = IO.sniffBilingualTable(text);
    return { pairs: rows.map(r => ({ zh: String(r[mapping.src] || ''), en: String(r[mapping.tgt] || '') })), note: 'CSV/TSV' };
  }

  return { parseFile };
});
