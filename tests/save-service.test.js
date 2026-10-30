/* Node tests: save-service.js — CAS + 冲突 + 队列管理 */
require('fake-indexeddb/auto');
const SaveService = require('../js/save-service.js');
const DB = require('../js/db.js');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗ FAIL:', name); }
}

(async () => {
  /* --- 正常保存流程 --- */
  const svc = new SaveService(DB.Projects);
  svc.setProjectedRev(0);
  const r1 = await svc.save('T项目', [{ src: 'A', tgt: 'a' }], 't1');
  ok(r1.ok && r1.newRev === 1, 'first save → rev 1');
  ok(svc.getProjectedRev() === 1, 'projectedRev advanced');

  /* --- 冲突检测 --- */
  // 另一个 "标签页" 直接写 DB（绕过 service）
  await DB.Projects.put({ name: 'T项目', rev: 5, segments: [{ src: 'B', tgt: 'b' }] });
  const r2 = await svc.save('T项目', [{ src: 'A2', tgt: 'a2' }], 't2');
  ok(r2.ok === false && r2.conflict === true, 'stale rev → conflict');
  ok(r2.currentRev === 5, `conflict reports currentRev (got ${r2.currentRev})`);
  ok(svc.getProjectedRev() === 5, 'projectedRev rolled back to DB truth');

  /* --- 强制覆盖 --- */
  const r3 = await svc.forceSave('T项目', [{ src: 'Forced', tgt: 'f' }], 't3');
  ok(r3.ok && r3.newRev === 6, 'force save → rev 6');
  ok(svc.getProjectedRev() === 6, 'projectedRev after force');

  /* --- 串行队列：同页连续保存不自冲突 --- */
  svc.setProjectedRev(6);
  const p1 = svc.save('T项目', [{ src: 'S1' }], 't4');
  const p2 = svc.save('T项目', [{ src: 'S2' }], 't5');
  const [q1, q2] = await Promise.all([p1, p2]);
  ok(q1.ok && q2.ok, 'back-to-back saves both succeed');
  ok(q2.newRev === q1.newRev + 1, `serial rev increment (q1=${q1.newRev} q2=${q2.newRev})`);

  /* --- 防抖 --- */
  let debounceCount = 0;
  svc.debounce(() => { debounceCount++; }, 50);
  svc.debounce(() => { debounceCount++; }, 50); // second call replaces first
  await new Promise(r => setTimeout(r, 150));
  ok(debounceCount === 1, `debounce: only last fires (got ${debounceCount})`);

  /* --- 串行队列：同页连续保存不自冲突（冲突后恢复） --- */
  const svc2 = new SaveService(DB.Projects);
  svc2.setProjectedRev(0);
  // 直接写 DB 模拟另一标签页
  await DB.Projects.put({ name: 'P2', rev: 3, segments: [] });
  svc2.setProjectedRev(0);
  // 第一次保存 → 冲突（DB rev=3, expected=0）
  const c1 = await svc2.save('P2', [{ src: 'x' }], 't');
  ok(c1.conflict === true, 'conflict on stale');
  ok(svc2.getProjectedRev() === 3, 'projectedRev synced to DB truth after conflict');
  // 第二次保存应该用同步后的 rev → 成功
  const c2 = await svc2.save('P2', [{ src: 'y' }], 't');
  ok(c2.ok && c2.newRev === 4, 'post-conflict save succeeds');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
