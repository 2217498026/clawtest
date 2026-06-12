/**
 * auto-mouse.js — 自动化鼠标控制模块
 *
 * 提供多策略元素定位、贝塞尔平滑移动、3层点击 fallback、遮挡检测等功能。
 * 作为 ESM 模块被其他脚本（如 yuntu-login.js）导入使用。
 *
 * 导入方式:
 *   import { autoMouse } from './auto-mouse.js'
 *
 * 基本用法:
 *   const mouse = autoMouse(page)
 *   await mouse.clickByText('登录')
 *   await mouse.clickBySelector('.ant-btn-primary')
 *   await mouse.clickAt(500, 300)
 *
 * 高级用法:
 *   await mouse.locateAndClick({
 *     text: '确认',
 *     selector: '.submit-btn',
 *     offsetX: 5,
 *     offsetY: 5
 *   })
 */

// ─── 默认配置 ───────────────────────────────────────────────

const DEFAULTS = {
  moveDuration: 120,       // 鼠标移动总时长 (ms)
  moveStepPx: 8,           // 每步最大像素
  clickDelay: 300,         // 点击后等待 (ms)
  retryCount: 3,           // 定位/点击重试次数
  retryDelay: 500,         // 重试间隔 (ms)
  easing: 'easeOutCubic',  // 缓动函数
  highlight: true,         // 是否高亮目标元素
  highlightDuration: 800,  // 高亮持续 (ms)
  scrollMargin: 100,       // 滚入视口时的边距 (px)
  obscuringCheck: true,    // 是否检测遮挡
  fiberMaxDepth: 20,       // React fiber 查找最大深度
};

// ─── 缓动函数 ───────────────────────────────────────────────

const EASING_FUNCS = {
  easeOutCubic: t => 1 - Math.pow(1 - t, 3),
  easeOutQuad: t => t * (2 - t),
  easeInOutCubic: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  linear: t => t,
  easeOutExpo: t => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
};

// ─── 工具函数 ───────────────────────────────────────────────

/**
 * 生成二次贝塞尔曲线路径点
 * @param {number} x1 起点 X
 * @param {number} y1 起点 Y
 * @param {number} x2 终点 X
 * @param {number} y2 终点 Y
 * @param {number} steps 路径分段数
 * @param {string} easingName 缓动函数名
 * @param {number} jitter 随机抖动像素
 * @returns {Array<{x:number, y:number}>}
 */
function bezierPath(x1, y1, x2, y2, steps, easingName = 'easeOutCubic', jitter = 2) {
  const easing = EASING_FUNCS[easingName] || EASING_FUNCS.easeOutCubic;
  const dist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  // 控制点偏移量与距离成比例
  const controlOffset = Math.min(dist * 0.3, 80);
  const angle = Math.atan2(y2 - y1, x2 - x1) + (Math.random() - 0.5) * 1.2;
  const cx = (x1 + x2) / 2 + Math.cos(angle) * controlOffset;
  const cy = (y1 + y2) / 2 + Math.sin(angle) * controlOffset;

  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = easing(i / steps);
    const u = 1 - t;
    const x = u * u * x1 + 2 * u * t * cx + t * t * x2 + (Math.random() - 0.5) * jitter;
    const y = u * u * y1 + 2 * u * t * cy + t * t * y2 + (Math.random() - 0.5) * jitter;
    points.push({ x: Math.round(x), y: Math.round(y) });
  }
  return points;
}

/**
 * 计算两点间距离
 */
function distance(x1, y1, x2, y2) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

/**
 * 延迟等待
 */
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * 等待条件为真，超时抛出
 */
async function waitFor(conditionFn, timeout = 10000, interval = 200) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await conditionFn();
    if (result) return result;
    await sleep(interval);
  }
  throw new Error(`waitFor 超时 (${timeout}ms)`);
}

// ─── 页面内执行工具 ─────────────────────────────────────────

/**
 * 在页面中获取元素的边界矩形（通过 evaluate）
 */
async function getElementRect(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: rect.x, y: rect.y,
      width: rect.width, height: rect.height,
      left: rect.left, top: rect.top,
      right: rect.right, bottom: rect.bottom,
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
    };
  }, selector);
}

/**
 * 查找所有可见的可交互元素（页面内执行）
 * 返回元素信息数组：{ tag, text, rect, role, type, selector }
 */
function getInteractiveElementsFn() {
  const NATIVE_SELECTORS = [
    'a', 'button', 'input', 'select', 'textarea',
    '[role="button"]', '[role="link"]', '[role="tab"]',
    '[role="menuitem"]', '[role="option"]', '[role="checkbox"]',
    '[role="radio"]', '[role="switch"]',
    '[onclick]', '[tabindex]:not([tabindex="-1"])',
    '.ant-btn', '.el-button',
    '[class*="btn"]', '[class*="Btn"]',
  ];
  const all = document.querySelectorAll(NATIVE_SELECTORS.join(','));
  const results = [];
  for (const el of all) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    // 跳过隐藏元素
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const tag = el.tagName.toLowerCase();
    const text = (el.textContent || '').trim().slice(0, 100);
    const ariaLabel = el.getAttribute('aria-label') || '';
    const placeholder = el.getAttribute('placeholder') || '';
    const name = el.getAttribute('name') || '';
    const id = el.id || '';
    // 尝试生成唯一选择器
    let selector = '';
    if (id) selector = '#' + id;
    else if (el.getAttribute('data-testid')) selector = `[data-testid="${el.getAttribute('data-testid')}"]`;
    else if (el.getAttribute('data-id')) selector = `[data-id="${el.getAttribute('data-id')}"]`;
    else if (name && tag !== 'a') selector = `${tag}[name="${name}"]`;
    if (!selector || document.querySelectorAll(selector).length !== 1) {
      // 用 nth-child 兜底
      const path = [];
      let cur = el;
      while (cur && cur !== document.body) {
        let idx = 1;
        let sibling = cur.previousElementSibling;
        while (sibling) { idx++; sibling = sibling.previousElementSibling; }
        path.unshift(`${cur.tagName.toLowerCase()}:nth-child(${idx})`);
        cur = cur.parentElement;
      }
      selector = path.join(' > ');
    }
    results.push({
      tag, text, selector,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
              centerX: rect.left + rect.width / 2, centerY: rect.top + rect.height / 2 },
      role: el.getAttribute('role') || '',
      type: el.getAttribute('type') || '',
      ariaLabel, placeholder, name, id,
    });
  }
  return results;
}

/**
 * 查找 React fiber 上的 onClick 处理器（页面内执行）
 * 返回 { found: boolean, message: string }
 */
function fiberClickFn(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return { found: false, message: 'no element at point' };
  const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
  if (!fiberKey) return { found: false, message: 'no React fiber key' };
  let fiber = el[fiberKey];
  let depth = 0;
  const maxDepth = 20;
  while (fiber && depth < maxDepth) {
    if (fiber.memoizedProps && typeof fiber.memoizedProps.onClick === 'function') {
      try {
        fiber.memoizedProps.onClick({ stopPropagation() {}, preventDefault() {} });
        return { found: true, message: `clicked via fiber at depth ${depth}` };
      } catch (e) {
        return { found: true, message: `fiber onClick threw: ${e.message}` };
      }
    }
    if (fiber.memoizedProps && typeof fiber.memoizedProps.onMouseDown === 'function') {
      try {
        fiber.memoizedProps.onMouseDown({ stopPropagation() {}, preventDefault() {}, button: 0 });
        fiber.memoizedProps.onMouseUp && fiber.memoizedProps.onMouseUp({ stopPropagation() {}, preventDefault() {}, button: 0 });
        return { found: true, message: `clicked via fiber onMouseDown/Up at depth ${depth}` };
      } catch (e) { /* continue */ }
    }
    fiber = fiber.return;
    depth++;
  }
  return { found: false, message: `no onClick in fiber chain (depth ${depth})` };
}

/**
 * dispatchEvent MouseEvent 序列（页面内执行）
 */
function dispatchMouseEventsFn(x, y, targetSelector) {
  const el = targetSelector ? document.querySelector(targetSelector) : document.elementFromPoint(x, y);
  if (!el) return { success: false, message: 'no element' };
  const cx = Math.round(x);
  const cy = Math.round(y);
  const opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0 };
  try {
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    return { success: true, message: 'dispatched mousedown+mouseup+click' };
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * 遮挡检测（页面内执行）
 * 在目标点周围9个偏移点检测是否有其他元素遮挡
 * 返回 { obscured: boolean, clearPoint: {x,y} | null }
 */
function checkObscuredFn(x, y, targetSelector) {
  const target = targetSelector ? document.querySelector(targetSelector) : document.elementFromPoint(x, y);
  if (!target) return { obscured: false, message: 'no target' };
  // 9个检测点：中心 + 8方向偏移
  const offsets = [
    { dx: 0, dy: 0 },
    { dx: 5, dy: 0 }, { dx: -5, dy: 0 },
    { dx: 0, dy: 5 }, { dx: 0, dy: -5 },
    { dx: 5, dy: 5 }, { dx: -5, dy: 5 },
    { dx: 5, dy: -5 }, { dx: -5, dy: -5 },
  ];
  for (const off of offsets) {
    const px = x + off.dx;
    const py = y + off.dy;
    const topEl = document.elementFromPoint(px, py);
    if (topEl === target || target.contains(topEl) || (topEl && topEl.contains(target))) {
      return { obscured: false, clearPoint: { x: px, y: py }, message: 'clear point found' };
    }
  }
  return { obscured: true, message: 'element is obscured', obscuredAt: { x, y } };
}

/**
 * 高亮元素（页面内执行）
 */
function highlightElementFn(selector, duration) {
  const el = document.querySelector(selector);
  if (!el) return false;
  const origOutline = el.style.outline;
  const origOutlineOffset = el.style.outlineOffset;
  const origBg = el.style.backgroundColor;
  el.style.outline = '3px solid #ff4444';
  el.style.outlineOffset = '2px';
  el.style.backgroundColor = 'rgba(255, 68, 68, 0.08)';
  // 动画闪烁
  let flashes = 0;
  const interval = setInterval(() => {
    flashes++;
    if (flashes % 2 === 0) {
      el.style.outline = '3px solid #ff4444';
    } else {
      el.style.outline = '3px solid #44ff44';
    }
    if (flashes >= 6) {
      clearInterval(interval);
      el.style.outline = origOutline;
      el.style.outlineOffset = origOutlineOffset;
      el.style.backgroundColor = origBg;
    }
  }, duration / 6);
  return true;
}

/**
 * 滚动元素到视口（页面内执行）
 */
function scrollIntoViewFn(selector, margin) {
  const el = document.querySelector(selector);
  if (!el) return { found: false };
  const rect = el.getBoundingClientRect();
  const isInView = rect.top >= 0 && rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth);
  if (!isInView) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  const marginPx = margin || 100;
  // 额外确保不被 header/footer 遮挡
  const afterRect = el.getBoundingClientRect();
  return {
    found: true,
    x: afterRect.left + afterRect.width / 2,
    y: afterRect.top + afterRect.height / 2,
    centerX: afterRect.left + afterRect.width / 2,
    centerY: afterRect.top + afterRect.height / 2,
  };
}

// ─── 主控制器 ───────────────────────────────────────────────

/**
 * 创建自动化鼠标控制器
 *
 * @param {import('playwright').Page} page  Playwright 页面实例
 * @param {object} [globalConfig]  全局覆写配置
 * @returns {object} 控制器对象
 */
export function autoMouse(page, globalConfig = {}) {
  const cfg = { ...DEFAULTS, ...globalConfig };

  // ─── 内部状态 ──────────────────────────────────────────
  let lastMouseX = 0;
  let lastMouseY = 0;

  // ─── 鼠标移动 ──────────────────────────────────────────

  /**
   * 平滑移动鼠标到指定坐标（通过 CDP Input.dispatchMouseEvent）
   *
   * @param {number} x 目标 X
   * @param {number} y 目标 Y
   * @param {object} [opts]
   * @param {number} [opts.duration]  移动时长 (ms)，默认 cfg.moveDuration
   * @param {number} [opts.stepPx]    每步最大像素，默认 cfg.moveStepPx
   * @param {string} [opts.easing]    缓动函数，默认 cfg.easing
   * @param {number} [opts.jitter]    随机抖动，默认 2
   * @returns {Promise<{x:number, y:number}>}
   */
  async function smoothMove(x, y, opts = {}) {
    const duration = opts.duration ?? cfg.moveDuration;
    const stepPx = opts.stepPx ?? cfg.moveStepPx;
    const easing = opts.easing || cfg.easing;
    const jitter = opts.jitter ?? 2;

    const dist = distance(lastMouseX, lastMouseY, x, y);
    const steps = Math.max(Math.round(dist / stepPx), 2);
    const path = bezierPath(lastMouseX, lastMouseY, x, y, steps, easing, jitter);
    const stepDelay = duration / steps;

    const cdpSession = await page.context().newCDPSession(page);
    try {
      for (const pt of path) {
        await cdpSession.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: pt.x,
          y: pt.y,
          button: 'none',
          buttons: 0,
        });
        await sleep(stepDelay);
      }
    } finally {
      await cdpSession.detach();
    }

    lastMouseX = x;
    lastMouseY = y;
    return { x, y };
  }

  // ─── 点击 ──────────────────────────────────────────────

  /**
   * 在指定坐标执行稳定点击（3层 fallback）
   *
   * 层级:
   *   1. Playwright 原生 page.mouse.click(x, y)
   *   2. dispatchEvent(mousedown+mouseup+click)
   *   3. React fiber onClick 强制触发
   *
   * @param {number} x      点击 X 坐标
   * @param {number} y      点击 Y 坐标
   * @param {object} [opts]
   * @param {string} [opts.targetSelector]  用于 dispatchEvent 的目标元素选择器
   * @returns {Promise<{success:boolean, method:string, message:string}>}
   */
  async function stableClick(x, y, opts = {}) {
    const delay = cfg.clickDelay;

    // Layer 1: Playwright 原生 mouse.click
    try {
      await page.mouse.click(x, y);
      await sleep(delay);
      return { success: true, method: 'playwright', message: 'page.mouse.click' };
    } catch (e) {
      // fall through
    }

    // Layer 2: dispatchEvent MouseEvent 序列
    try {
      const result = await page.evaluate(dispatchMouseEventsFn, x, y, opts.targetSelector || null);
      if (result.success) {
        await sleep(delay);
        return { success: true, method: 'dispatchEvent', message: result.message };
      }
    } catch (e) {
      // fall through
    }

    // Layer 3: React fiber onClick
    try {
      const result = await page.evaluate(fiberClickFn, x, y);
      if (result.found) {
        await sleep(delay);
        return { success: true, method: 'fiberClick', message: result.message };
      }
    } catch (e) {
      // fall through
    }

    return { success: false, method: 'none', message: '所有点击方式均失败' };
  }

  // ─── 元素定位 ──────────────────────────────────────────

  /**
   * 定位目标元素（3策略）
   *
   * 策略:
   *   1. selector — CSS 选择器精确查找
   *   2. text — 文本精确/包含匹配
   *   3. fullScan — 全量扫描兜底
   *
   * @param {object} target
   * @param {string} [target.selector]  CSS 选择器
   * @param {string} [target.text]      目标文本（支持部分匹配）
   * @param {string} [target.tag]       标签名过滤（用于全量扫描）
   * @param {string} [target.role]      角色过滤（用于全量扫描）
   * @returns {Promise<{found:boolean, rect:object|null, selector:string|null, source:string}>}
   */
  async function locateElement(target = {}) {
    // 策略1: CSS 选择器
    if (target.selector) {
      const rect = await getElementRect(page, target.selector);
      if (rect && rect.width > 0) {
        return { found: true, rect, selector: target.selector, source: 'selector' };
      }
    }

    // 策略2: 文本匹配
    if (target.text) {
      const text = target.text.trim();
      const escaped = CSS.escape ? CSS.escape(text) : text.replace(/["']/g, '');
      // 精确文本匹配
      const exactSelector = `:is(a,button,span,div,[role="button"],[role="tab"],[role="menuitem"],[role="option"]):text-is("${escaped}")`;
      let rect = await getElementRect(page, exactSelector);
      if (rect && rect.width > 0) {
        return { found: true, rect, selector: exactSelector, source: 'text-exact' };
      }
      // 包含匹配
      const containSelector = `:is(a,button,span,div,[role="button"],[role="tab"],[role="menuitem"],[role="option"]):has-text("${escaped}")`;
      rect = await getElementRect(page, containSelector);
      if (rect && rect.width > 0) {
        return { found: true, rect, selector: containSelector, source: 'text-contain' };
      }
      // 通过 evaluate 文本匹配
      rect = await page.evaluate((searchText) => {
        const all = document.querySelectorAll('a, button, span, div, [role="button"], [role="tab"], [role="menuitem"]');
        for (const el of all) {
          const t = (el.textContent || '').trim();
          if (t === searchText || t.includes(searchText)) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) return {
              x: r.x, y: r.y, width: r.width, height: r.height,
              left: r.left, top: r.top, right: r.right, bottom: r.bottom,
              centerX: r.left + r.width / 2, centerY: r.top + r.height / 2,
            };
          }
        }
        return null;
      }, text);
      if (rect) {
        return { found: true, rect, selector: null, source: 'text-evaluate' };
      }
    }

    // 策略3: 全量扫描兜底
    const interactive = await page.evaluate(getInteractiveElementsFn);
    let candidates = interactive;
    if (target.tag) {
      candidates = candidates.filter(e => e.tag === target.tag.toLowerCase());
    }
    if (target.role) {
      candidates = candidates.filter(e => e.role === target.role);
    }
    if (target.text) {
      candidates = candidates.filter(e => e.text.includes(target.text) || e.ariaLabel.includes(target.text));
    }
    if (candidates.length > 0) {
      const best = candidates[0];
      const centerX = best.rect.centerX;
      const centerY = best.rect.centerY;
      return {
        found: true,
        rect: { ...best.rect, centerX, centerY },
        selector: best.selector,
        source: 'fullScan',
      };
    }

    return { found: false, rect: null, selector: null, source: 'none' };
  }

  /**
   * 获取目标元素的边界框信息
   *
   * @param {object} target  同 locateElement 参数
   * @returns {Promise<object|null>}
   */
  async function getElementBox(target) {
    const result = await locateElement(target);
    return result.found ? result.rect : null;
  }

  /**
   * 扫描页面上的可交互元素
   *
   * @param {object} [filter]  过滤条件 { tag, role, text }
   * @returns {Promise<Array>}
   */
  async function scanInteractive(filter = {}) {
    const all = await page.evaluate(getInteractiveElementsFn);
    let results = all;
    if (filter.tag) results = results.filter(e => e.tag === filter.tag.toLowerCase());
    if (filter.role) results = results.filter(e => e.role === filter.role);
    if (filter.text) results = results.filter(e => e.text.includes(filter.text));
    return results;
  }

  // ─── 高级组合 ──────────────────────────────────────────

  /**
   * 定位目标 → 滚入视口 → 检测遮挡 → 平滑移动 → 稳定点击
   *
   * @param {object} target  目标描述 { selector, text, tag, role, offsetX, offsetY }
   * @returns {Promise<{success:boolean, method:string, message:string, rect:object|null}>}
   */
  async function locateAndClick(target = {}) {
    for (let attempt = 0; attempt < cfg.retryCount; attempt++) {
      // 1. 定位元素
      const loc = await locateElement(target);
      if (!loc.found) {
        if (attempt < cfg.retryCount - 1) {
          await sleep(cfg.retryDelay);
          continue;
        }
        return { success: false, method: 'locate', message: `元素定位失败: ${JSON.stringify(target)}`, rect: null };
      }

      // 2. 滚入视口
      let clickX = loc.rect.centerX;
      let clickY = loc.rect.centerY;
      if (loc.selector) {
        const scrollResult = await page.evaluate(scrollIntoViewFn, loc.selector, cfg.scrollMargin);
        if (scrollResult.found) {
          clickX = scrollResult.centerX;
          clickY = scrollResult.centerY;
        }
        // 短等待滚动动画
        await sleep(150);
      }

      // 3. 高亮（可选）
      if (cfg.highlight && loc.selector) {
        await page.evaluate(highlightElementFn, loc.selector, cfg.highlightDuration).catch(() => {});
      }

      // 4. 遮挡检测
      if (cfg.obscuringCheck) {
        const occlusion = await page.evaluate(checkObscuredFn, clickX, clickY, loc.selector || null);
        if (!occlusion.obscured && occlusion.clearPoint) {
          clickX = occlusion.clearPoint.x;
          clickY = occlusion.clearPoint.y;
        } else if (occlusion.obscured) {
          // 遮挡时尝试 offset 点击
          const offsets = [
            { dx: 0, dy: 0 },
            { dx: 10, dy: 0 }, { dx: -10, dy: 0 },
            { dx: 0, dy: 10 }, { dx: 0, dy: -10 },
            { dx: 15, dy: 10 }, { dx: -15, dy: -10 },
            { dx: 20, dy: 0 }, { dx: -20, dy: 0 },
          ];
          let foundClear = false;
          for (const off of offsets) {
            const checkX = clickX + off.dx;
            const checkY = clickY + off.dy;
            const oc = await page.evaluate(checkObscuredFn, checkX, checkY, loc.selector || null);
            if (!oc.obscured && oc.clearPoint) {
              clickX = oc.clearPoint.x;
              clickY = oc.clearPoint.y;
              foundClear = true;
              break;
            }
          }
          if (!foundClear) {
            // 所有偏移点仍遮挡，使用 fiber 强制穿透
            const fiberResult = await page.evaluate(fiberClickFn, clickX, clickY);
            if (fiberResult.found) {
              await sleep(cfg.clickDelay);
              return { success: true, method: 'fiberClick-obscured', message: '遮挡穿透 via fiber', rect: loc.rect };
            }
            if (attempt < cfg.retryCount - 1) {
              await sleep(cfg.retryDelay);
              continue;
            }
            return { success: false, method: 'obscured', message: `元素被遮挡且无法穿透: ${occlusion.message}`, rect: loc.rect };
          }
        }
      }

      // 5. 应用用户偏移
      if (target.offsetX) clickX += target.offsetX;
      if (target.offsetY) clickY += target.offsetY;

      // 6. 平滑移动
      await smoothMove(clickX, clickY);

      // 7. 稳定点击
      const clickResult = await stableClick(clickX, clickY, { targetSelector: loc.selector || undefined });
      if (clickResult.success) {
        return { ...clickResult, rect: loc.rect };
      }

      if (attempt < cfg.retryCount - 1) {
        await sleep(cfg.retryDelay);
      }
    }

    return { success: false, method: 'exhausted', message: `重试 ${cfg.retryCount} 次后仍失败`, rect: null };
  }

  /**
   * 通过文本内容点击元素
   *
   * @param {string} text 目标文本
   * @param {object} [opts]  额外选项 { offsetX, offsetY, tag, role }
   * @returns {Promise<object>}
   */
  async function clickByText(text, opts = {}) {
    return locateAndClick({ text, ...opts });
  }

  /**
   * 通过 CSS 选择器点击元素
   *
   * @param {string} selector CSS 选择器
   * @param {object} [opts]  额外选项 { offsetX, offsetY }
   * @returns {Promise<object>}
   */
  async function clickBySelector(selector, opts = {}) {
    return locateAndClick({ selector, ...opts });
  }

  /**
   * 直接点击指定坐标
   *
   * @param {number} x
   * @param {number} y
   * @returns {Promise<object>}
   */
  async function clickAt(x, y) {
    await smoothMove(x, y);
    return stableClick(x, y);
  }

  // ─── 初始化鼠标位置 ─────────────────────────────────────

  // 获取当前鼠标位置
  (async function initMousePos() {
    try {
      const cdpSession = await page.context().newCDPSession(page);
      const result = await cdpSession.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: 0, y: 0,
        button: 'none',
        buttons: 0,
      });
      await cdpSession.detach();
    } catch (e) {
      // 忽略初始化错误
    }
  })();

  // ─── 返回控制器 ─────────────────────────────────────────

  return {
    // 配置
    config: cfg,

    // 基础操作
    smoothMove,
    stableClick,
    clickAt,

    // 元素定位
    locateElement,
    getElementBox,
    scanInteractive,

    // 高级点击
    clickByText,
    clickBySelector,
    locateAndClick,
  };
}
