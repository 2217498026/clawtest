/**
 * 测试 clearCategoryCascader 的 tag 清除逻辑
 *
 * 用法:
 *   node scripts/test-clear-cascader.mjs
 *
 * 功能：
 *   1. 用 `page.setContent` 创建模拟 cascader DOM（2 个 cascader，各含 5 个 tag）
 *   2. 针对第 2 个 cascader (index=1) 执行清除逻辑（对应用户报告的"没找全"场景）
 *   3. 报告每次循环找到的 closeBtn 来源（trigger / popover / page）
 *   4. 测试成功后清理测试文件
 */

import { chromium } from 'playwright';

// ─── 简化版 LOG（避免依赖 yuntu-login.js 的 LOG 模块）───
const LOG = {
  step: (msg) => console.log(`\x1b[36m[STEP] ${msg}\x1b[0m`),
  ok: (msg) => console.log(`\x1b[32m[OK]   ${msg}\x1b[0m`),
  info: (msg) => console.log(`\x1b[34m[INFO] ${msg}\x1b[0m`),
  warn: (msg) => console.log(`\x1b[33m[WARN] ${msg}\x1b[0m`),
  error: (msg) => console.log(`\x1b[31m[ERR]  ${msg}\x1b[0m`),
};

// ─── 测试 1：tag 在 trigger 内部（正常场景）───
async function testTagsInTrigger(page) {
  LOG.step('=== 测试 1：tag 在 trigger 内部（正常场景） ===');
  await page.setContent(`
    <div id="app">
      <!-- cascader 1 -->
      <div class="commodity-cascader-multiple-input-trigger" style="border:1px solid #ccc; min-height:40px; padding:8px;">
        <span class="commodity-tag">品类A<span class="commodity-tag-close" data-tag="A">×</span></span>
        <span class="commodity-tag">品类B<span class="commodity-tag-close" data-tag="B">×</span></span>
        <span class="commodity-tag">品类C<span class="commodity-tag-close" data-tag="C">×</span></span>
      </div>
      <!-- cascader 2 -->
      <div class="commodity-cascader-multiple-input-trigger" style="border:1px solid #ccc; min-height:40px; padding:8px; margin-top:10px;">
        <span class="commodity-tag">品类X<span class="commodity-tag-close" data-tag="X">×</span></span>
        <span class="commodity-tag">品类Y<span class="commodity-tag-close" data-tag="Y">×</span></span>
        <span class="commodity-tag">品类Z<span class="commodity-tag-close" data-tag="Z">×</span></span>
      </div>
    </div>
  `);
  return await runClearTest(page, 1, 3);
}

// ─── 测试 2：popover 打开时，部分 tag 移到 popover 内部 ───
async function testTagsInPopover(page) {
  LOG.step('=== 测试 2：部分 tag 在 trigger 内 + 部分 tag 在 popover 内 ===');
  await page.setContent(`
    <div id="app">
      <div class="commodity-cascader-multiple-input-trigger" style="border:1px solid #ccc; min-height:40px; padding:8px;">
        <span class="commodity-tag">品类A<span class="commodity-tag-close" data-tag="A">×</span></span>
      </div>
      <div class="commodity-cascader-multiple-input-trigger" style="border:1px solid #ccc; min-height:40px; padding:8px; margin-top:10px;">
        <!-- trigger 内只有 1 个 tag -->
        <span class="commodity-tag">品类X<span class="commodity-tag-close" data-tag="X">×</span></span>
      </div>
      <!-- popover wrapper 里还有 3 个 tag（模拟下拉面板打开时的渲染） -->
      <div class="commodity-cascader-popover-wrapper" style="border:1px dashed red; padding:10px; margin-top:5px; display:block;">
        <span class="commodity-tag">品类Y<span class="commodity-tag-close" data-tag="Y-popover">×</span></span>
        <span class="commodity-tag">品类Z<span class="commodity-tag-close" data-tag="Z-popover">×</span></span>
        <span class="commodity-tag">品类W<span class="commodity-tag-close" data-tag="W-popover">×</span></span>
      </div>
    </div>
  `);
  return await runClearTest(page, 1, 4);
}

// ─── 测试 3：每次清除后模拟 DOM re-render（stale handle 场景）───
async function testStaleHandle(page) {
  LOG.step('=== 测试 3：每次清除后模拟 DOM re-render（stale handle 场景） ===');
  await page.setContent(`
    <div id="app">
      <div class="commodity-cascader-multiple-input-trigger" style="border:1px solid #ccc; min-height:40px; padding:8px;">
        <span class="commodity-tag">品类A<span class="commodity-tag-close" data-tag="A">×</span></span>
        <span class="commodity-tag">品类B<span class="commodity-tag-close" data-tag="B">×</span></span>
      </div>
      <div id="target-cascader">
        <div class="commodity-cascader-multiple-input-trigger" style="border:1px solid #ccc; min-height:40px; padding:8px; margin-top:10px;">
          <span class="commodity-tag">品类X<span class="commodity-tag-close" data-tag="X">×</span></span>
          <span class="commodity-tag">品类Y<span class="commodity-tag-close" data-tag="Y">×</span></span>
          <span class="commodity-tag">品类Z<span class="commodity-tag-close" data-tag="Z">×</span></span>
        </div>
      </div>
    </div>
  `);
  return await runClearTest(page, 1, 3, true);
}

// ─── 运行清除测试 ───
async function runClearTest(page, cascaderIndex, expectedCount, staleSimulation = false) {
  let cleared = 0;
  let scopeUsed = 'unknown';
  const results = []; // 记录每轮详情

  for (let round = 0; round < 15; round++) {
    let closeBtn = null;
    let usedStrategy = '';

    // 策略1：在目标 trigger 内搜索
    const triggers = await page.$$('.commodity-cascader-multiple-input-trigger');
    const targetTrigger = triggers[cascaderIndex];
    if (targetTrigger) {
      const triggerCloseBtns = await targetTrigger.$$('.commodity-tag-close');
      if (triggerCloseBtns.length > 0) {
        closeBtn = triggerCloseBtns[0];
        usedStrategy = 'trigger';
      }
    }

    // 策略2：popover 内搜索
    if (!closeBtn) {
      try {
        const popover = page.locator('.commodity-cascader-popover-wrapper');
        if (await popover.isVisible().catch(() => false)) {
          const popoverCloseBtns = await popover.locator('.commodity-tag-close').elementHandles();
          if (popoverCloseBtns.length > 0) {
            closeBtn = popoverCloseBtns[0];
            usedStrategy = 'popover';
          }
        }
      } catch { /* 继续 */ }
    }

    // 策略3：page 级 DOM 位置过滤
    if (!closeBtn) {
      try {
        const triggers2 = await page.$$('.commodity-cascader-multiple-input-trigger');
        const targetTrigger2 = triggers2[cascaderIndex];
        if (targetTrigger2) {
          const allCloseBtns = await page.$$('.commodity-tag-close');
          for (const btn of allCloseBtns) {
            const isAfterTarget = await targetTrigger2.evaluate(
              (trigger, child) => (trigger.compareDocumentPosition(child) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
              btn
            );
            let isBeforeNext = true;
            if (cascaderIndex + 1 < triggers2.length) {
              const nextTrigger = triggers2[cascaderIndex + 1];
              isBeforeNext = await nextTrigger.evaluate(
                (trigger, child) => (trigger.compareDocumentPosition(child) & Node.DOCUMENT_POSITION_FOLLOWING) === 0,
                btn
              );
            }
            if (isAfterTarget && isBeforeNext) {
              closeBtn = btn;
              usedStrategy = 'page';
              break;
            }
          }
        }
      } catch { /* 继续 */ }
    }

    if (!closeBtn) {
      LOG.info(`  第 ${round + 1} 轮：未找到 closeBtn，break`);
      break;
    }

    const tagText = await closeBtn.evaluate(el => el.getAttribute('data-tag') || el.textContent).catch(() => '?');
    await closeBtn.dispatchEvent('click');
    // 模拟 DOM 更新：移除被点击的 closeBtn 的父级 tag
    await closeBtn.evaluate(el => {
      const tag = el.closest('.commodity-tag');
      if (tag) tag.remove();
      else el.remove();
    }).catch(() => {});

    // stale handle 模拟：detach 然后 re-attach target trigger，使旧 handle 失效
    if (staleSimulation) {
      await page.evaluate(() => {
        const trigger = document.querySelectorAll('.commodity-cascader-multiple-input-trigger')[1];
        if (trigger) {
          const parent = trigger.parentNode;
          const nextSibling = trigger.nextSibling;
          const clone = trigger.cloneNode(true); // 真实 re-render 会创建新节点
          parent.replaceChild(clone, trigger);
        }
      });
    }

    cleared += 1;
    scopeUsed = usedStrategy;
    results.push({ round: round + 1, strategy: usedStrategy, tag: tagText });
    LOG.ok(`  第 ${round + 1} 轮: 用 [${usedStrategy}] 策略清除 tag [${tagText}]`);
  }

  const pass = cleared === expectedCount;
  const verdict = pass ? '✅ 通过' : `❌ 失败（预期 ${expectedCount}，实际清除 ${cleared}）`;
  LOG.info(`  结果: 清除 ${cleared}/${expectedCount} 个 tag（scope: ${scopeUsed}）─ ${verdict}`);
  LOG.info('');
  return { cleared, expectedCount, pass, results };
}

// ─── 主函数 ───
async function main() {
  LOG.step('='.repeat(60));
  LOG.step('clearCategoryCascader 清除逻辑测试');
  LOG.step('='.repeat(60));
  console.log('');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const results = [];
    results.push(await testTagsInTrigger(page));
    results.push(await testTagsInPopover(page));
    results.push(await testStaleHandle(page));

    const allPass = results.every(r => r.pass);
    LOG.step('='.repeat(60));
    if (allPass) {
      LOG.ok('所有测试通过 ✅');
    } else {
      LOG.error('部分测试失败 ❌');
      for (const r of results) {
        if (!r.pass) {
          LOG.warn(`  清除 ${r.cleared}/${r.expectedCount} 个 tag - 失败`);
        }
      }
    }
    LOG.step('='.repeat(60));
  } finally {
    await browser.close();
  }
}

main().catch(e => {
  LOG.error(`测试出错: ${e.message}`);
  process.exit(1);
});
