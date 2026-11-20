/* Node tests for revimport.js: 修订导入文件解析（docx 表格 → pairs/comments）。
 * 重点回归 v1.13 修复的两类缺陷：
 *  1) cellRuns 查找曾引用未定义的 dataRow，带运行级格式（加粗/斜体）的 docx 修订表必然抛错；
 *  2) 行号换算：rowTracked/cellRuns/rowComments 均为含表头绝对行号，首行自带修订时
 *     数据行起点不同（absRow = firstRowTracked ? ri : ri + 1）。 */
const Write = require('../js/officewrite.js');
const Office = require('../js/msoffice.js');
const RevImport = require('../js/revimport.js');
const { DOMParser } = require('linkedom');
Office.setXmlParser(DOMParser); // Node 测试环境注入 XML 解析器（运行时零依赖不变）

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗ FAIL:', name); }
}

const fakeFile = (name, buf) => ({ name, arrayBuffer: async () => buf });

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

const pkgRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:creator>谭雅琼</dc:creator><cp:lastModifiedBy>刘小婷</cp:lastModifiedBy>
<dcterms:modified xsi:type="dcterms:W3CDTF">2026-11-20T10:00:00Z</dcterms:modified>
</cp:coreProperties>`;

function docxBytes(documentXml) {
  return Write.zipStore([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: pkgRels },
    { name: 'word/document.xml', data: documentXml },
    { name: 'docProps/core.xml', data: coreXml }
  ]);
}

(async () => {
  /* --- Case A：首行自带修订（firstRowTracked）→ 该行是数据行；目标格加粗 run 须被带回 --- */
  const trackedHeaderDocx = docxBytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:tbl>
  <w:tr>
    <w:tc><w:p><w:r><w:t>青釉</w:t></w:r></w:p></w:tc>
    <w:tc><w:p>
      <w:del w:id="1" w:author="刘小婷" w:date="2026-11-20T09:00:00Z"><w:r><w:delText> glaze</w:delText></w:r></w:del>
      <w:ins w:id="2" w:author="刘小婷" w:date="2026-11-20T09:00:00Z"><w:r><w:rPr><w:b/></w:rPr><w:t>-green glaze</w:t></w:r></w:ins>
    </w:p></w:tc>
  </w:tr>
  <w:tr>
    <w:tc><w:p><w:r><w:t>窑具</w:t></w:r></w:p></w:tc>
    <w:tc><w:p><w:r><w:t>kiln furniture</w:t></w:r></w:p></w:tc>
  </w:tr>
</w:tbl>
</w:body></w:document>`);

  const a = await RevImport.parseFile(fakeFile('修订-首行即数据.docx', trackedHeaderDocx));
  ok(a.pairs.length === 2, `A: both rows parsed as data rows (got ${a.pairs.length})`);
  ok(a.pairs[0].zh === '青釉' && a.pairs[0].en.includes('-green glaze'), `A: row 0 content (got ${JSON.stringify(a.pairs[0])})`);
  ok(a.pairs[0].author === '刘小婷', `A: revision author detected on row 0 (got ${JSON.stringify(a.pairs[0].author)})`);
  ok(Array.isArray(a.pairs[0].runs) && a.pairs[0].runs.some(r2 => r2.bold && r2.text.includes('-green glaze')),
    `A: bold cellRuns attached to row 0 (got ${JSON.stringify(a.pairs[0].runs)})`);
  ok(a.pairs[1].runs === undefined, 'A: plain row 1 carries no runs');
  ok(a.note === 'docx 表格', `A: note (got ${a.note})`);

  /* --- Case B：普通表头 → 数据行 ri+1 换算；数据行加粗 run + 修订人须被带回（v1.13 前此路径抛 ReferenceError）--- */
  const normalHeaderDocx = docxBytes(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:tbl>
  <w:tr>
    <w:tc><w:p><w:r><w:t>中文</w:t></w:r></w:p></w:tc>
    <w:tc><w:p><w:r><w:t>英文</w:t></w:r></w:p></w:tc>
  </w:tr>
  <w:tr>
    <w:tc><w:p><w:r><w:t>青釉</w:t></w:r></w:p></w:tc>
    <w:tc><w:p>
      <w:del w:id="1" w:author="王评阅" w:date="2026-11-20T10:00:00Z"><w:r><w:delText>glaze</w:delText></w:r></w:del>
      <w:ins w:id="2" w:author="王评阅" w:date="2026-11-20T10:00:00Z"><w:r><w:rPr><w:i/></w:rPr><w:t>celadon glaze</w:t></w:r></w:ins>
    </w:p></w:tc>
  </w:tr>
  <w:tr>
    <w:tc><w:p><w:r><w:t>窑具</w:t></w:r></w:p></w:tc>
    <w:tc><w:p><w:r><w:t>kiln furniture</w:t></w:r></w:p></w:tc>
  </w:tr>
</w:tbl>
<w:p><w:r><w:t>尾段。</w:t></w:r></w:p>
</w:body></w:document>`);

  const b = await RevImport.parseFile(fakeFile('修订-普通表头.docx', normalHeaderDocx));
  ok(b.pairs.length === 2, `B: data rows only (got ${b.pairs.length})`);
  ok(b.pairs[0].zh === '青釉' && b.pairs[0].en === 'celadon glaze', `B: row content (got ${JSON.stringify(b.pairs[0])})`);
  ok(b.pairs[0].author === '王评阅', `B: author via absRow = ri+1 (got ${JSON.stringify(b.pairs[0].author)})`);
  ok(Array.isArray(b.pairs[0].runs) && b.pairs[0].runs.some(r2 => r2.italic && r2.text.includes('celadon glaze')),
    `B: italic cellRuns attached to data row 1 (got ${JSON.stringify(b.pairs[0].runs)})`);
  ok(b.pairs[1].runs === undefined && b.pairs[1].author === undefined, 'B: untouched row 2 carries no runs/author');
  ok(b.meta && b.meta.lastModifiedBy === '刘小婷', `B: file meta passed through (got ${JSON.stringify(b.meta)})`);

  /* --- Case C：xlsx 路径经 buildXlsx 合成 --- */
  const xlsx = Write.buildXlsx([{ name: '对照表', rows: [['中文', '英文'], ['釉', 'glaze'], ['窑具', 'kiln furniture']] }]);
  const c = await RevImport.parseFile(fakeFile('对照.xlsx', xlsx));
  ok(c.pairs.length === 2, `C: xlsx rows (got ${c.pairs.length})`);
  ok(c.pairs[0].zh === '釉' && c.pairs[0].en === 'glaze', `C: xlsx content (got ${JSON.stringify(c.pairs[0])})`);
  ok(c.note.startsWith('xlsx'), `C: note (got ${c.note})`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error('  ✗ FAIL: uncaught', err); process.exit(1); });
