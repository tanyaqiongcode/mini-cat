import js from "@eslint/js";
import globals from "globals";

/**
 * ESLint flat config（仅作用于独立 .js/.cjs 文件；HTML 内联脚本不在覆盖范围）。
 * 目录分派依据各脚本的实际运行环境：
 *   js/   —— 浏览器 <script> 加载的经典脚本（window.MiniCat* 命名空间）；
 *            各模块带 UMD 探测（typeof module），故 module/require 为已知全局；
 *            term-worker.js 运行在 Web Worker，需 importScripts
 *   tests/ —— Node CommonJS 运行，但通过 linkedom/fake-indexeddb 注入并直接
 *            引用 document/window 等浏览器全局（故叠加 browser globals）
 * 对老代码的放宽（legacy 噪音，均为 lint 级别、不改业务语义）：
 *   - no-unused-vars 关闭对 args / catch 参数的检查，但未用局部变量仍为 error
 *   - no-empty 允许空的 catch 块（历史代码大量 `catch (e) {}`）
 * 刻意行为的豁免（与 multi-align 同款处理）：
 *   - js/officewrite.js 关闭 no-control-regex（XLSX/DOCX 导出时清洗控制字符属刻意行为）
 *   - js/core.js 关闭 no-misleading-character-class（零宽字符清洗正则里的 \u200d
 *     是「删除裸 ZWJ」的刻意意图，不是误拼接）
 */
export default [
  {
    ignores: ["**/node_modules/**", "**/dist/**", ".husky/_/**", "js/term-engine.js"],
  },
  js.configs.recommended,
  {
    rules: {
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["js/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.browser, module: "readonly", require: "readonly", importScripts: "readonly" },
    },
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: ["scripts/**/*.cjs", "tests/**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
  },
  {
    files: ["js/term-worker.js"],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.worker, MiniCatCandidates: "readonly" },
    },
  },
  {
    // Playwright 测试里 page.evaluate(...) 的回调会被序列化到被测页面执行，
    // 回调内引用的是页面上下文的全局（MiniCat* 命名空间与注入的桩），不是本 Node 文件作用域。
    files: ["tests/browser.test.js"],
    languageOptions: {
      globals: {
        MiniCatDB: "readonly", MiniCatIO: "readonly", MiniCatWebRef: "readonly", MiniCatRichText: "readonly",
        searches: "readonly", startSearch: "readonly", searchResult: "readonly",
      },
    },
  },
  {
    files: ["js/officewrite.js"],
    rules: {
      "no-control-regex": "off",
    },
  },
  {
    files: ["js/core.js"],
    rules: {
      "no-misleading-character-class": "off",
    },
  },
];
