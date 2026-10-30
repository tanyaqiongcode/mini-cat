/* Mini-CAT save-service.js — 保存队列 + 版本 CAS + 冲突检测，从 app.js 抽离的可测试模块。
 * 所有 IndexedDB 交互通过回调注入（便于 Node 测试用 fake-indexeddb）。 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.MiniCatSaveService = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class SaveService {
    /* onConflict(conflictInfo) → 用户选择的回调（'force' | 'reload'），可省略 */
    constructor(db, opts) {
      this._db = db;
      this._queue = Promise.resolve();
      this._projectedRev = 0;
      this._timer = null;
      this._onConflict = (opts && opts.onConflict) || null;
      this._lastError = null;
    }

    setProjectedRev(rev) { this.projectedRev = rev; }
    getProjectedRev() { return this._projectedRev; }
    get lastError() { return this._lastError; }

    clearDebounce() { if (this._timer) { clearTimeout(this._timer); this._timer = null; } }

    /* 防抖保存 */
    debounce(saveFn, ms) {
      this.clearDebounce();
      this._timer = setTimeout(() => { this._timer = null; saveFn(); }, ms || 600);
    }

    /* 立即保存：串行队列 + 版本 CAS
     * name: 项目名, segments: 深拷贝的句段数组, updated: ISO 时间戳
     * 返回 {ok, newRev} 或 {ok:false, conflict, currentRev, otherSegments} */
    async save(name, segments, updated) {
      this.clearDebounce();
      const expectedRev = this._projectedRev;
      this._projectedRev = expectedRev + 1; // 乐观推进
      const pending = this._queue.catch(() => {}).then(async () => {
        let r;
        try {
          r = await this._db.saveWithRev(name, expectedRev, { segments, updated });
        } catch (err) {
          this._projectedRev = expectedRev; // 写入未落地：投影回滚
          this._lastError = err;
          throw err;
        }
        if (r.ok) {
          this._projectedRev = r.newRev;
          return r;
        }
        // CAS 冲突：回滚投影为 DB 真实值，通知调用方
        this._projectedRev = r.currentRev;
        if (this._onConflict) this._onConflict({ name, currentRev: r.currentRev, otherSegments: r.segments });
        return r;
      });
      this._queue = pending;
      return pending;
    }

    /* 强制覆盖（用户在冲突提示中选择后调用） */
    async forceSave(name, segments, updated) {
      const r = await this._db.saveWithRev(name, null, { segments, updated });
      if (r && r.ok) { this._projectedRev = r.newRev; return r; }
      throw new Error('强制覆盖失败');
    }
  }

  return SaveService;
});
