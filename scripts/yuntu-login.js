/**
 * 巨量引擎云图 自动登录脚本
 * ============================================================
 * 功能：自动登录 https://yuntu.oceanengine.com/account/login
 *       支持 Cookie 持久化，后续运行可复用登录态免重复登录
 *
 * CLI 用法:
 *   node scripts/yuntu-login.js                          # 有头模式（首次登录）
 *   node scripts/yuntu-login.js --headless                # 无头模式
 *   node scripts/yuntu-login.js --cookie ./my-state.json  # 复用已有 Cookie
 *   node scripts/yuntu-login.js --headless --cookie ./my-state.json
 *
 * 模块导入:
 *   import { login, checkSession } from './yuntu-login.js'
 *   const result = await login({ headless: true })
 *   console.log(result.success)
 * ============================================================
 */

// ============================================================
// 配置常量
// ============================================================
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { autoMouse } from './auto-mouse.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const LOGIN_URL = 'https://yuntu.oceanengine.com/account/login';
const ACCOUNT = 'a510262246@163.com';
const PASSWORD = 'Xintu123';
const DEFAULT_COOKIE_PATH = resolve(__dirname, 'yuntu-login-state.json');
const DEFAULT_SCREENSHOT_PATH = resolve(__dirname, 'yuntu-login-screenshot.png');

const TIMEOUTS = {
  PAGE_LOAD: 30000,
  ELEMENT_VISIBLE: 15000,
  NAVIGATION: 30000,
  FILL: 10000,
  SHORT_PAUSE: 2000,
};

// 类目选择配置（在此处修改要自动选择的类目）
// 每个元素：{ first: 一级类目名, second: [该一级下的二级类目名列表] }
const CATEGORY_CONFIG = [
  
  { first: '运动户外',   second: ['电动车/配件/交通工具', '户外鞋服', '运动/瑜伽/健身/球迷用品'] },

];


// 三级类目配置（在清除第二个级联选择器 tag 后自动勾选第三级 checkbox）
// first: 一级类目  second: [{ name: 二级类目, third: [三级类目列表] }]
const sub_CONFIG = [
  {
    first: '服饰内衣',
    second: [
      {
        name: '女装',
        third: [
          'POLO衫', 'T恤', '抹胸', '毛衣', '皮衣', '短裤',
          '衬衫', '裤子', '西装', '风衣', '马夹', '卫衣/绒衫',
          '棉衣/棉服', '婚纱/旗袍/礼服', '唐装/民族服装/舞台服装',
          '套装/学生校服/工作制服',
        ],
      },
    ],
  },
];

/** 控制台彩色日志 */
const LOG = {
  info: (msg) => console.log(`\x1b[36m[INFO]\x1b[0m  ${msg}`),
  ok: (msg) => console.log(`\x1b[32m[OK]\x1b[0m    ${msg}`),
  warn: (msg) => console.log(`\x1b[33m[WARN]\x1b[0m  ${msg}`),
  error: (msg) => console.log(`\x1b[31m[ERROR]\x1b[0m ${msg}`),
  step: (msg) => console.log(`\x1b[35m[STEP]\x1b[0m  ${msg}`),
};

/** 转义正则特殊字符，用于构造安全的正则表达式 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================
// 1. 环境检测
// ============================================================
async function checkPlaywright() {
  try {
    await import('playwright');
    LOG.ok('Playwright 已安装');
    return true;
  } catch {
    LOG.error('Playwright 未安装！');
    console.log('');
    console.log('  请执行以下命令安装:');
    console.log('  \x1b[36mnpm install playwright\x1b[0m');
    console.log('  \x1b[36mnpx playwright install chromium\x1b[0m');
    console.log('');
    return false;
  }
}

// ============================================================
// 2. CLI 参数解析
// ============================================================
function parseArgs() {
  const args = process.argv.slice(2);
  return {
    headless: args.includes('--headless'),
    cookiePath: getArgValue(args, '--cookie') || DEFAULT_COOKIE_PATH,
    screenshotPath: getArgValue(args, '--screenshot') || DEFAULT_SCREENSHOT_PATH,
  };
}

function getArgValue(args, key) {
  const idx = args.indexOf(key);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return null;
}

// ============================================================
// 3. 浏览器启动与上下文创建
// ============================================================
async function setup(options = {}) {
  const { headless = false } = options;
  const { chromium } = await import('playwright');

  LOG.step('启动浏览器...');
  const browser = await chromium.launch({
    headless,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });

  const page = await context.newPage();
  LOG.ok(`浏览器已启动 (headless=${headless})`);

  return { browser, context, page };
}

// ============================================================
// 4. Cookie 复用
// ============================================================
async function tryRestoreSession(context, cookiePath) {
  try {
    const fs = await import('fs');
    if (fs.existsSync(cookiePath)) {
      LOG.step(`检测到已保存的登录态文件: ${cookiePath}`);
      await context.addInitScript(() => {
        // 覆盖 webdriver 检测
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });
      await context.addCookies(JSON.parse(fs.readFileSync(cookiePath, 'utf-8')));
      LOG.ok('已加载 Session Cookie');
      return true;
    }
  } catch (e) {
    LOG.warn(`Cookie 加载失败: ${e.message}，将执行完整登录流程`);
  }
  return false;
}

// ============================================================
// 5. 页面导航与显式等待
// ============================================================
async function navigateToLogin(page) {
  LOG.step(`导航到登录页面: ${LOGIN_URL}`);

  await page.goto(LOGIN_URL, {
    waitUntil: 'networkidle',
    timeout: TIMEOUTS.PAGE_LOAD,
  });

  LOG.info('等待页面元素加载...');

  // 等待登录表单关键元素出现
  // 巨量引擎云图登录页表单元素策略（按优先级）
  const selectors = [
    'input[type="text"]',       // 通用文本输入框
    'input[type="password"]',   // 密码输入框
    'input[placeholder*="邮箱"]',
    'input[placeholder*="账号"]',
    'input[name="email"]',
    'input[name="account"]',
  ];

  let found = false;
  for (const sel of selectors) {
    try {
      await page.waitForSelector(sel, {
        state: 'visible',
        timeout: TIMEOUTS.ELEMENT_VISIBLE,
      });
      found = true;
      LOG.ok(`表单元素已就绪: ${sel}`);
      break;
    } catch {
      // 继续尝试下一个选择器
    }
  }

  if (!found) {
    // 兜底：等待页面至少有一个输入框
    await page.waitForSelector('input', {
      state: 'visible',
      timeout: TIMEOUTS.ELEMENT_VISIBLE,
    });
    LOG.warn('未匹配到已知选择器，但页面存在输入框，继续执行');
  }

  // 短暂等待确保 React 组件完全渲染
  await page.waitForTimeout(1000);
  LOG.ok('页面导航完成');
  return true;
}

// ============================================================
// 6. 切换到邮箱登录模式
// ============================================================
async function switchToEmailLogin(page) {
  LOG.step('切换到邮箱登录模式...');

  const tabSelectors = [
    'div[class*="tab"]:has-text("邮箱登录")',
    'div[class*="tab"]:has-text("邮箱")',
    'span:has-text("邮箱登录")',
    'label:has-text("邮箱登录")',
    'div:has-text("邮箱登录")',
  ];

  for (const sel of tabSelectors) {
    try {
      const tab = await page.$(sel);
      if (tab) {
        await tab.click();
        await page.waitForTimeout(500);
        LOG.ok(`已点击"邮箱登录"标签 (${sel})`);
        return true;
      }
    } catch { /*continue*/ }
  }

  // 兜底：遍历所有元素找"邮箱登录"文本
  try {
    const found = await page.evaluate(() => {
      const all = document.querySelectorAll('div, span, label, a, li');
      for (const el of all) {
        if (el.textContent?.trim() === '邮箱登录' || el.textContent?.trim() === '邮箱') {
          el.click();
          return true;
        }
      }
      return false;
    });
    if (found) {
      await page.waitForTimeout(500);
      LOG.ok('已点击"邮箱登录"（文本遍历）');
      return true;
    }
  } catch { /*ignore*/ }

  LOG.info('未找到"邮箱登录"切换标签，可能已在邮箱登录模式');
  return false;
}

// ============================================================
// 7. 勾选同意协议复选框
// ============================================================
async function checkAgreement(page) {
  LOG.step('勾选"我已阅读并同意"...');

  // === 策略1（最高优先级）：自定义 SVG checkbox（account-center-agreement-check）===
  try {
    const clicked = await page.evaluate(() => {
      const checkbox = document.querySelector('.account-center-agreement-check');
      if (!checkbox) return false;

      // 检查是否已勾选（背景色从白色变成其他颜色说明已勾选）
      const bg = window.getComputedStyle(checkbox).backgroundColor;
      if (bg !== 'rgb(255, 255, 255)' && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        return 'already';
      }

      // 模拟完整鼠标点击事件序列
      ['mousedown', 'mouseup', 'click'].forEach(type => {
        checkbox.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
        }));
      });
      return 'clicked';
    });
    if (clicked === 'clicked') {
      await page.waitForTimeout(300);
      LOG.ok('已勾选 (account-center-agreement-check, 模拟鼠标)');
      return true;
    }
    if (clicked === 'already') {
      LOG.ok('同意协议已勾选');
      return true;
    }
  } catch { /* 继续 */ }

  // === 策略2：.check-box-container 点击 ===
  try {
    const container = await page.$('.check-box-container');
    if (container) {
      await container.click();
      await page.waitForTimeout(300);
      // 验证是否真正勾上
      const stillWhite = await page.evaluate(() => {
        const el = document.querySelector('.account-center-agreement-check');
        if (!el) return true;
        return window.getComputedStyle(el).backgroundColor === 'rgb(255, 255, 255)';
      });
      if (!stillWhite) {
        LOG.ok('已勾选 (.check-box-container 点击)');
        return true;
      }
      // 白色没变，说明容器 click 不生效，尝试子元素
    }
  } catch { /* 继续 */ }

  // === 策略3：直接查找原生 checkbox 并 force check ===
  try {
    const checkbox = await page.$('input[type="checkbox"]');
    if (checkbox) {
      const checked = await checkbox.isChecked();
      if (!checked) {
        await checkbox.check({ force: true });
        LOG.ok('已勾选 (原生 checkbox, force check)');
      } else {
        LOG.ok('同意协议已勾选');
      }
      return true;
    }
  } catch { /* 继续 */ }

  // === 策略4：Ant Design 风格 .ant-checkbox ===
  try {
    const antCheckbox = await page.$('.ant-checkbox:not(.ant-checkbox-checked)');
    if (antCheckbox) {
      await antCheckbox.click();
      await page.waitForTimeout(300);
      LOG.ok('已勾选 (Ant Design checkbox)');
      return true;
    }
  } catch { /* 继续 */ }

  // === 策略5：查找包含"同意"文本的交互区域，向上冒泡找可点击父元素 ===
  try {
    const clicked = await page.evaluate(() => {
      const labels = document.querySelectorAll('label, span, div, p, li');
      for (const el of labels) {
        const text = el.textContent || '';
        if (text.includes('同意') || text.includes('阅读') || text.includes('协议')) {
          let target = el;
          while (target && target !== document.body) {
            const style = window.getComputedStyle(target);
            if (
              style.cursor === 'pointer' ||
              target.tagName === 'LABEL' ||
              target.getAttribute('role') === 'checkbox' ||
              target.getAttribute('role') === 'switch' ||
              target.classList.contains('ant-checkbox')
            ) {
              if (target.classList.contains('ant-checkbox-checked')) return 'already';
              ['mousedown', 'mouseup', 'click'].forEach(type => {
                target.dispatchEvent(new MouseEvent(type, {
                  bubbles: true, cancelable: true, view: window,
                }));
              });
              return true;
            }
            target = target.parentElement;
          }
        }
      }
      return false;
    });
    if (clicked === true) {
      await page.waitForTimeout(300);
      LOG.ok('已勾选同意协议（交互区域查找）');
      return true;
    }
    if (clicked === 'already') {
      LOG.ok('同意协议已勾选');
      return true;
    }
  } catch { /* 继续 */ }

  // === 策略6：Playwright locator 兜底 ===
  try {
    const locator = page.locator('text=/同意|已阅读|服务协议|隐私条款/').first();
    if (await locator.isVisible({ timeout: 3000 }).catch(() => false)) {
      await locator.click();
      await page.waitForTimeout(300);
      LOG.ok('已勾选（文本 locator 兜底）');
      return true;
    }
  } catch { /* 继续 */ }

  LOG.info('未找到同意协议复选框，可能无需勾选');
  return false;
}

// ============================================================
// 8. 表单填充（多种选择器策略）
// ============================================================
async function fillCredentials(page) {
  LOG.step('填写账号密码...');

  // === 邮箱输入框 ===
  const emailSelectors = [
    'input[type="text"]',
    'input[placeholder*="邮箱"]',
    'input[placeholder*="账号"]',
    'input[name="email"]',
    'input[name="account"]',
    'input[autocomplete="username"]',
  ];

  let emailFilled = false;
  for (const sel of emailSelectors) {
    const el = await page.$(sel);
    if (el) {
      try {
        await el.click();
        await page.waitForTimeout(300);
        await el.fill(ACCOUNT);
        emailFilled = true;
        LOG.ok(`邮箱已填入 (selector: ${sel})`);
        break;
      } catch {
        continue;
      }
    }
  }

  if (!emailFilled) {
    // 最终兜底：查找所有可见输入框，选择第一个
    const inputs = await page.$$('input:visible');
    if (inputs.length > 0) {
      await inputs[0].click();
      await page.waitForTimeout(300);
      await inputs[0].fill(ACCOUNT);
      emailFilled = true;
      LOG.warn('使用兜底策略填入邮箱');
    }
  }

  // === 密码输入框 ===
  const passwordSelectors = [
    'input[type="password"]',
    'input[placeholder*="密码"]',
    'input[name="password"]',
    'input[autocomplete="current-password"]',
  ];

  let pwdFilled = false;
  for (const sel of passwordSelectors) {
    const el = await page.$(sel);
    if (el) {
      try {
        await el.click();
        await page.waitForTimeout(300);
        await el.fill(PASSWORD);
        pwdFilled = true;
        LOG.ok(`密码已填入 (selector: ${sel})`);
        break;
      } catch {
        continue;
      }
    }
  }

  if (!pwdFilled) {
    // 兜底：查找密码类型的 input
    const inputs = await page.$$('input');
    for (const inp of inputs) {
      const type = await inp.getAttribute('type');
      if (type === 'password' || !type) {
        await inp.click();
        await page.waitForTimeout(300);
        await inp.fill(PASSWORD);
        pwdFilled = true;
        LOG.warn('使用兜底策略填入密码');
        break;
      }
    }
  }

  if (!emailFilled || !pwdFilled) {
    throw new Error('表单填充失败：无法定位输入框');
  }

  await page.waitForTimeout(500);
  LOG.ok('账号密码填写完成');
  return true;
}

// ============================================================
// 9. 登录提交（含重试机制）
// ============================================================
async function submitLogin(page) {
  LOG.step('点击登录按钮...');

  // 首轮先调试 dump 页面按钮结构
  try {
    const buttonsInfo = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]');
      return Array.from(buttons).map(b => ({
        tag: b.tagName,
        type: b.getAttribute('type') || '',
        text: (b.textContent || '').trim().substring(0, 30),
        class: (b.className || '').substring(0, 60),
        visible: b.offsetParent !== null,
        rect: b.getBoundingClientRect ? `${b.getBoundingClientRect().width}x${b.getBoundingClientRect().height}` : '',
      }));
    });
    LOG.info(`页面共找到 ${buttonsInfo.length} 个可点击元素`);
    buttonsInfo.forEach(b => LOG.info(`  ${b.tag} type=${b.type} text="${b.text}" ${b.visible ? '' : '(hidden)'}`));
  } catch { /* ignore debug dump errors */ }

  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    LOG.info(`登录提交尝试 ${attempt}/${maxRetries}`);

    let clicked = false;

    // === 策略1（主策略）：查找按钮索引，用 Playwright 原生 click ===
    if (!clicked) {
      try {
        const result = await page.evaluate(() => {
          // 查找可见的"登录云图"按钮，返回其索引
          const buttons = document.querySelectorAll('button');
          for (let i = 0; i < buttons.length; i++) {
            const text = (buttons[i].textContent || '').trim();
            if (text === '登录云图' && buttons[i].offsetParent !== null) {
              return { index: i, tag: 'BUTTON' };
            }
          }
          // 无 button 时再查 div/span 容器
          const others = document.querySelectorAll('div, span, a, [role="button"]');
          for (let i = 0; i < others.length; i++) {
            const text = (others[i].textContent || '').trim();
            if (text === '登录云图' && others[i].offsetParent !== null) {
              return { index: i, tag: others[i].tagName };
            }
          }
          return null;
        });
        if (result) {
          const tag = result.tag;
          const idx = result.index;
          if (tag === 'BUTTON') {
            const btns = await page.$$('button');
            if (btns[idx]) {
              await btns[idx].click({ timeout: 5000 });
              clicked = true;
              LOG.ok(`策略1: 按钮[${idx}] "登录云图" (Playwright 原生 click)`);
            }
          } else {
            const els = await page.$$('div, span, a, [role="button"]');
            if (els[idx]) {
              await els[idx].click({ timeout: 5000 });
              clicked = true;
              LOG.ok(`策略1: ${tag}[${idx}] "登录云图" (Playwright 原生 click)`);
            }
          }
        }
      } catch { /* 继续 */ }
    }

    // === 策略1b：Playwright 原生点击 button ===
    if (!clicked) {
      try {
        const btn = await page.$('button.account-center-action-button');
        if (btn) {
          await btn.click({ timeout: 5000 });
          clicked = true;
          LOG.ok('策略1b: 专用选择器 button.account-center-action-button');
        }
      } catch { /* 继续 */ }
    }

    // === 策略2：通过按钮选择器 ===
    if (!clicked) {
      const specificSelectors = [
        'button:has-text("登录云图")',
        'button:has-text("登录")',
        'div.account-center-submit button',
        '.account-center-action-button',
        '[class*="primary"]',
        'form button:last-of-type',
        'form input[type="submit"]',
        'form input[type="button"]',
      ];
      for (const sel of specificSelectors) {
        try {
          const btn = await page.$(sel);
          if (btn) {
            await btn.click({ timeout: 5000 });
            clicked = true;
            LOG.ok(`策略2: 选择器 "${sel}" 点击成功`);
            break;
          }
        } catch { /* continue */ }
      }
    }

    // === 策略3：getByRole ===
    if (!clicked) {
      try {
        const btn = page.getByRole('button', { name: /登录云图|登录|登 录|Login/i });
        await btn.click({ timeout: 5000 });
        clicked = true;
        LOG.ok('策略3: getByRole 点击');
      } catch { /* 继续 */ }
    }

    // === 策略4：遍历所有 button ===
    if (!clicked) {
      try {
        const buttons = await page.$$('button');
        for (const btn of buttons) {
          const text = (await btn.textContent() || '').trim();
          if (text.includes('登录云图') || text.includes('登录')) {
            await btn.click();
            clicked = true;
            LOG.ok(`策略4: 按钮文本 "${text}"`);
            break;
          }
        }
      } catch { /* 继续 */ }
    }

    // === 策略5：点击 form 中的最后一个 button ===
    if (!clicked) {
      try {
        const clickedResult = await page.evaluate(() => {
          const form = document.querySelector('form');
          if (form) {
            const lastBtn = form.querySelector('button:last-of-type, input[type="submit"]:last-of-type');
            if (lastBtn) { lastBtn.click(); return true; }
            const allInputs = form.querySelectorAll('button, input');
            if (allInputs.length > 0) { allInputs[allInputs.length - 1].click(); return true; }
          }
          return false;
        });
        if (clickedResult) {
          clicked = true;
          LOG.warn('策略5: 表单内最后一个按钮');
        }
      } catch { /* 继续 */ }
    }

    // === 策略6（兜底）：在密码框按 Enter ===
    if (!clicked) {
      try {
        const pwdInput = await page.$('input[type="password"]');
        if (pwdInput) {
          await pwdInput.focus();
          await page.waitForTimeout(300);
          await page.keyboard.press('Enter');
          clicked = true;
          LOG.warn('策略6: 密码框 Enter 键提交（兜底）');
        }
      } catch { /* 继续 */ }
    }

    if (clicked) {
      try {
        await page.waitForURL(
          (url) => !url.includes('/account/login'),
          { timeout: 20000 }
        );
        LOG.ok(`登录提交成功，URL 已跳转: ${page.url()}`);
        return true;
      } catch {
        const currentUrl = page.url();
        if (!currentUrl.includes('/account/login')) {
          LOG.ok(`URL 已变化: ${currentUrl}`);
          return true;
        }
        if (attempt < maxRetries) {
          LOG.warn('登录尚未成功，准备重试...');
          await page.waitForTimeout(2000);
        }
      }
    } else {
      try {
        await page.screenshot({ path: 'login-page-debug.png' });
        LOG.warn(`第 ${attempt} 次尝试：保存调试截图`);
      } catch { /* ignore */ }
      LOG.error(`第 ${attempt} 次尝试未能找到登录按钮`);
      if (attempt < maxRetries) await page.waitForTimeout(2000);
    }
  }

  return false;
}

// ============================================================
// 10. 登录验证（双重检测）
// ============================================================
async function verifyLogin(page) {
  LOG.step('验证登录状态...');

  // === 第一重：URL 检测 ===
  LOG.info('第一重验证：检测 URL 跳转...');
  let urlChanged = false;

  try {
    await page.waitForURL(
      (url) => !url.includes('/account/login'),
      { timeout: TIMEOUTS.NAVIGATION }
    );
    urlChanged = true;
    LOG.ok(`URL 已跳转: ${page.url()}`);
  } catch {
    const currentUrl = page.url();
    if (currentUrl.includes('/account/login')) {
      const bodyText = await page.evaluate(() => document.body?.innerText || '');
      if (bodyText.includes('验证码') || bodyText.includes('captcha')) {
        throw new Error('需要人工验证码，请在浏览器中手动完成验证后重试');
      }
      LOG.warn('URL 仍在登录页，进行第二重验证...');
    } else {
      urlChanged = true;
      LOG.ok(`URL 已变化: ${currentUrl}`);
    }
  }

  // === 第二重：关键元素检测 ===
  LOG.info('第二重验证：检测页面关键元素...');

  const successIndicators = [
    '[class*="avatar"]',
    '[class*="user-name"]',
    '[class*="userInfo"]',
    '[class*="sidebar"]',
    '[class*="menu"]',
    '[class*="navigation"]',
    '[class*="logo"]',
  ];

  let elementFound = false;
  for (const sel of successIndicators) {
    try {
      await page.waitForSelector(sel, {
        state: 'visible',
        timeout: 5000,
      });
      elementFound = true;
      LOG.ok(`检测到登录后元素: ${sel}`);
      break;
    } catch { continue; }
  }

  // === 第三重兜底：文本检测 ===
  if (!elementFound && !urlChanged) {
    LOG.info('第三重验证：页面文本内容检测...');
    await page.waitForTimeout(3000);
    const bodyText = await page.evaluate(() => document.body?.innerText || '');

    const loginKeywords = ['云图', '仪表盘', 'Dashboard', '分析', '策略', '人群', '洞察'];
    elementFound = loginKeywords.some(kw => bodyText.includes(kw));

    if (elementFound) {
      LOG.ok('通过文本内容检测确认已登录');
    }
  }

  const isLoggedIn = urlChanged || elementFound;

  if (isLoggedIn) {
    LOG.ok('✓ 登录验证通过！');
  } else {
    LOG.warn('登录验证未完全通过，但可能在跳转中...');
  }

  return {
    success: isLoggedIn,
    url: page.url(),
    urlChanged,
    elementFound,
  };
}

// ============================================================
// 11. 状态持久化（Cookie + 截图）
async function persistState(context, page, options = {}) {
  const cookiePath = options.cookiePath || DEFAULT_COOKIE_PATH;
  const screenshotPath = options.screenshotPath || DEFAULT_SCREENSHOT_PATH;

  LOG.step('保存登录状态...');

  // 保存 Cookie / Storage
  // storageState() 包含 cookies + localStorage + sessionStorage
  // 但以 JSON 格式直接保存 cookies 更便于后续改写和复用
  const cookies = await context.cookies();
  const fs = await import('fs');
  fs.writeFileSync(cookiePath, JSON.stringify(cookies, null, 2), 'utf-8');
  LOG.ok(`Cookie 已保存到: ${cookiePath}`);

  // 截图
  await page.screenshot({
    path: screenshotPath,
    fullPage: false,
  });
  LOG.ok(`截图已保存到: ${screenshotPath}`);

  return { cookiePath, screenshotPath };
}

// ============================================================
// 12. 登录后导航：点击"商品"→"品类趋势参考"
// ============================================================
async function navigateToProductAnalysis(page) {
  LOG.step('导航到 商品 > 品类趋势参考...');

  // === 第一步：点击顶部导航"商品" ===
  try {
    const productNav = await page.waitForSelector('div[data-log-value="商品"]', {
      timeout: 10000,
    });
    await productNav.click();
    LOG.ok('已点击顶部导航"商品"');
    await page.waitForTimeout(1500);
  } catch {
    try {
      // 兜底：通过文本查找
      const productNav = page.locator('text=商品').first();
      await productNav.click({ timeout: 5000 });
      LOG.ok('已点击"商品"（文本兜底）');
      await page.waitForTimeout(1500);
    } catch {
      LOG.warn('未找到"商品"导航项，可能已在该页面');
    }
  }

  // === 第二步：点击侧边栏"品类趋势参考" ===
  try {
    const categoryNav = await page.waitForSelector('div[data-log-value="品类趋势参考"]', {
      timeout: 10000,
    });
    await categoryNav.click();
    LOG.ok('已点击侧边栏"品类趋势参考"');
    await page.waitForTimeout(2000);
    // 清除级联选择器中的已选项（不打开 popover，直接点 tag close 按钮）
    await clearCategoryCascader(page, 0, false);
   
    // 自动选择类目
    await selectCascaderCategory(page, 0);

    // === 第三步：切换到二级类目视图，清除第二个级联选择器的 tag ===
    try {
      await page.locator('span').filter({ hasText: /^二级类目$/ }).first().click({ timeout: 5000 });
      LOG.ok('已切换至"二级类目"视图');
      await page.waitForTimeout(1000);
      // 清除第二个级联选择器的 tag
      const secondTrigger = page.locator('.commodity-cascader-multiple-input-trigger').nth(1);
      if (await secondTrigger.isVisible().catch(() => false)) {
        await secondTrigger.click({ timeout: 3000 });
        await page.waitForTimeout(500);
      }
      await clearCategoryCascader(page, 1, false);

      
      try {
        const popover = page.locator('.commodity-cascader-popover-wrapper');
        if (await popover.isVisible().catch(() => false)) {
          await secondTrigger.click({ timeout: 3000 });
          await page.waitForTimeout(400);
        }
      } catch {}
      LOG.ok('已清除第二个级联选择器的类目 tag');
    } catch (e) {
      LOG.warn(`切换至二级类目视图失败: ${e.message}`);
    }

    // 根据 sub_CONFIG 自动勾选三级类目 checkbox
    await selectSubCategory(page, 1);

    // 查找"去年同期爆发品类"相关元素
    try {
      const elementInfo = await page.evaluate(() => {
        const results = [];
        // 搜索所有包含"去年同期爆发品类"的文本节点
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          null,
          false
        );
        let node;
        while (node = walker.nextNode()) {
          const text = node.textContent.trim();
          if (text.includes('去年同期爆发品类')) {
            const parent = node.parentElement;
            results.push({
              text,
              tag: parent.tagName,
              className: parent.className.substring(0, 100),
              parentTag: parent.parentElement?.tagName,
              parentClass: parent.parentElement?.className?.substring(0, 100),
              rect: parent.getBoundingClientRect(),
            });
          }
        }
        // 也搜索 attribute 中包含该文本的元素
        const allElements = document.querySelectorAll('*');
        for (const el of allElements) {
          for (const attr of ['title', 'aria-label', 'data-log-value']) {
            const val = el.getAttribute(attr);
            if (val && val.includes('去年同期爆发品类')) {
              results.push({
                attribute: `${attr}=${val}`,
                tag: el.tagName,
                className: el.className.substring(0, 100),
                rect: el.getBoundingClientRect(),
              });
            }
          }
        }
        return results;
      });

      if (elementInfo.length > 0) {
        LOG.info(`找到"去年同期爆发品类"元素（${elementInfo.length} 个）:`);
        for (const info of elementInfo) {
          LOG.info(`  ${JSON.stringify(info)}`);
        }
      } else {
        LOG.info('未找到包含"去年同期爆发品类"文本的元素');
      }
    } catch (e) {
      LOG.warn(`查找"去年同期爆发品类"时出错: ${e.message}`);
    }

    return true;
  } catch {
    try {
      const categoryNav = page.locator('text=品类趋势参考').first();
      await categoryNav.click({ timeout: 5000 });
      LOG.ok('已点击"品类趋势参考"（文本兜底）');
      await page.waitForTimeout(2000);
      // 清除级联选择器中的已选项（不打开 popover，直接点 tag close 按钮）
      await clearCategoryCascader(page, 0, false);
    
    
    
      // 暂停，等待用户手动操作
      await pauseForInteraction(page, '请在"品类趋势参考"页面完成手动操作，完成后按 Enter 继续');
      return true;
    } catch {
      LOG.error('未找到"品类趋势参考"导航项');
      return false;
    }
  }
}

// ============================================================
// 12b. 暂停等待手动操作（readline）
// ============================================================
async function pauseForInteraction(page, message) {
  console.log('');
  console.log('\x1b[33m╔══════════════════════════════════════════════════════╗\x1b[0m');
  console.log(`\x1b[33m║ ${message.padEnd(54)}\x1b[33m║\x1b[0m`);
  console.log('\x1b[33m║  完成后请在此窗口按 Enter 继续...                      ║\x1b[0m');
  console.log('\x1b[33m╚══════════════════════════════════════════════════════╝\x1b[0m');
  console.log('');

  const { createInterface } = await import('readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('', () => {
      rl.close();
      resolve();
    });
  });
}

// ============================================================
// 12c. 清除品类级联选择器的所有已选项（关闭 tag）
// ============================================================
/**
 * 清除指定级联选择器中所有已选的类目 tag。
 * @param {Page} page - Playwright page
 * @param {number} [cascaderIndex=0] - 第几个 cascader（从 0 开始）
 * @param {boolean} [clickTrigger=true] - 是否先点击触发区域打开下拉
 */
async function clearCategoryCascader(page, cascaderIndex = 0, clickTrigger = true) {
  LOG.step('清除品类级联选择器选项...');

  if (clickTrigger) {
    try {
      // 点击触发区域打开下拉面板
      const triggers = await page.$$('.commodity-cascader-multiple-input-trigger');
      if (triggers[cascaderIndex]) {
        await triggers[cascaderIndex].click();
        await page.waitForTimeout(500);
        LOG.ok(`已点击第 ${cascaderIndex + 1} 个 cascader 触发区域`);
      }
    } catch { /* 继续 */ }
  }

  // 清除指定级联选择器内所有已选的 tag（点击每个 close 图标）
  // round 同时用作循环计数和已清除的 tag 个数
  // 三级回退搜索：trigger 内 → popover 内 → page 级（DOM 位置过滤）
  try {
    let scopeUsed = 'unknown';
    let round = 0;

    // 每次迭代重新查询 trigger 避免 stale ElementHandle
    // 实际 break 条件为找不到更多 closeBtn，round 即已清除的 tag 数量
    while (true) {
      let closeBtn = null;

      // 策略1: 在目标 trigger 内搜索（每次重新查询避免 stale handle）
      const triggers = await page.$$('.commodity-cascader-multiple-input-trigger');
      const targetTrigger = triggers[cascaderIndex];
      if (targetTrigger) {
        const triggerCloseBtns = await targetTrigger.$$('.commodity-tag-close');
        if (triggerCloseBtns.length > 0) {
          closeBtn = triggerCloseBtns[0];
          scopeUsed = 'trigger';
        }
      }

      // 策略2: trigger 内没找到，尝试在 popover 内搜索
      if (!closeBtn) {
        try {
          const popover = page.locator('.commodity-cascader-popover-wrapper');
          if (await popover.isVisible().catch(() => false)) {
            const popoverCloseBtns = await popover.locator('.commodity-tag-close').elementHandles();
            if (popoverCloseBtns.length > 0) {
              closeBtn = popoverCloseBtns[0];
              scopeUsed = 'popover';
            }
          }
        } catch { /* 继续 */ }
      }

      // 策略3: 兜底 — page 级搜索，用 DOM 位置过滤属于目标 cascader 的 tag
      if (!closeBtn) {
        try {
          const triggers2 = await page.$$('.commodity-cascader-multiple-input-trigger');
          const targetTrigger2 = triggers2[cascaderIndex];
          if (targetTrigger2) {
            const allCloseBtns = await page.$$('.commodity-tag-close');
            for (const btn of allCloseBtns) {
              // 检查该 close button 是否在目标 trigger 之后（DOM 顺序）
              const isAfterTarget = await targetTrigger2.evaluate(
                (trigger, child) =>
                  (trigger.compareDocumentPosition(child) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
                btn
              );
              // 同时确保不在下一个 trigger 之后（如果 cascaderIndex < 总数-1）
              let isBeforeNext = true;
              if (cascaderIndex + 1 < triggers2.length) {
                const nextTrigger = triggers2[cascaderIndex + 1];
                isBeforeNext = await nextTrigger.evaluate(
                  (trigger, child) =>
                    (trigger.compareDocumentPosition(child) & Node.DOCUMENT_POSITION_FOLLOWING) === 0,
                  btn
                );
              }
              if (isAfterTarget && isBeforeNext) {
                closeBtn = btn;
                scopeUsed = 'page';
                break;
              }
            }
          }
        } catch { /* 继续 */ }
      }

      if (!closeBtn) break;

      await closeBtn.dispatchEvent('click');
      round += 1;
      await page.waitForTimeout(300);
    }
    if (round > 0) {
      LOG.ok(`已清除第 ${cascaderIndex + 1} 个级联选择器的 ${round} 个类目 tag（scope: ${scopeUsed}）`);
    } else {
      LOG.info(`第 ${cascaderIndex + 1} 个级联选择器没有需要清除的类目 tag`);
    }
    return round;
  } catch (e) {
    LOG.warn(`清除第 ${cascaderIndex + 1} 个级联选择器的类目 tag 失败: ${e.message}`);
    return 0;
  }
}


// ============================================================
// 12d. 自动选择级联类目 — 点击一级类目 → 勾选所有二级类目
// ============================================================
/**
 * 打开级联选择器弹出面板，根据 CATEGORY_CONFIG 自动选择类目。
 *
 * 交互方式基于 recorded.js 已验证：该级联选择器是"点击文字即勾选"模式，
 * 完全无需操作 .commodity-checkbox-icon。
 *
 *   recorded.js 验证模式:
 *     - 一级展开: page.getByText('鞋靴箱包').click()
 *                 page.locator('div').filter({ hasText: /^鞋靴箱包$/ }).first().click()
 *     - 二级勾选: page.locator('div').filter({ hasText: /^女鞋$/ }).first().click()
 *     - 弹面板:   一次打开 → 连续点击多个一级+二级 → 最后关闭
 *     - 关键:     无任何 checkbox 选择器操作，纯文字点击
 *
 * @param {Page} page - Playwright page
 * @param {number} [cascaderIndex=0] - 第几个 cascader（从 0 开始）
 * @returns {Promise<boolean>} 是否有至少一个类目选择成功
 */
async function selectCascaderCategory(page, cascaderIndex = 0) {
  if (!CATEGORY_CONFIG || CATEGORY_CONFIG.length === 0) {
    LOG.info('CATEGORY_CONFIG 为空，跳过自动选择类目');
    return false;
  }

  LOG.step(`自动选择类目（共 ${CATEGORY_CONFIG.length} 组）...`);

  const trigger = page.locator('.commodity-cascader-multiple-input-trigger').nth(cascaderIndex);

  // 1. 打开 popover（仅一次，recorded.js 验证：连续点击无需重新打开）
  try {
    await trigger.click({ timeout: 5000 });
    await page.waitForSelector('.commodity-cascader-popover-wrapper', { state: 'visible', timeout: 5000 });
    await page.waitForTimeout(800);
    LOG.ok('已打开级联选择器弹出面板');
  } catch (e) {
    LOG.warn(`打开级联选择器弹出面板失败: ${e.message}`);
    return false;
  }

  // 获取 popover 引用，所有类目选择操作 scope 到 popover 内
  const popover = page.locator('.commodity-cascader-popover-wrapper');

  let anySelected = false;

  // 2. 遍历 CATEGORY_CONFIG
  //    文本定位用 div.filter({hasText}) — recorded.js 唯一验证的有效模式
  //    虚构的 CSS 类名（xxx-container-level-1/2、xxx-checkbox-icon 等）在真实 DOM 中不存在
  for (const [idx, entry] of CATEGORY_CONFIG.entries()) {
    const { first: firstName, second: secondItems } = entry;

    // 2a. 一级类目：点击文本导航到二级类目
    //     DOM 诊断确认：容器内只有 .commodity-cascader-item-label + 右箭头图标，
    //     没有 input/checkbox/label。级联导航模式，非 checkbox 多选。
    let l2ColVisible = false;
    try {
      const l1Text = popover.locator('div').filter({ hasText: new RegExp(`^${escapeRegex(firstName)}$`) }).first();
      await l1Text.click({ timeout: 5000 });
      LOG.ok(`[${idx + 1}] 已展开一级类目 "${firstName}"`);
      anySelected = true;

      // 等待二级列渲染。不依赖 popover 可见性检测（可能过渡动画），
      // 直接用 page 级定位查找二级类目（recorded.js 验证模式）
      await page.waitForTimeout(2000);

      // 检查是否有二级列容器出现
      const l2Columns = page.locator('.commodity-cascader-column-inner');
      const l2ColCount = await l2Columns.count().catch(() => 0);
      l2ColVisible = l2ColCount >= 2;
      if (l2ColVisible) {
        LOG.ok(`[${idx + 1}] 检测到二级列`);
      } else {
        LOG.info(`[${idx + 1}] 未检测到二级列，直接尝试按文本查找二级类目`);
      }
    } catch (e) {
      LOG.warn(`[${idx + 1}] 未找到一级类目 "${firstName}"（${e.message}），跳过`);
      await page.screenshot({ path: resolve(__dirname, 'debug-cascader.png'), fullPage: false }).catch(() => {});
      continue;
    }

    // 2b. 二级类目：按文本定位点击（recorded.js 模式：page 级 div.filter({hasText})）
    if (secondItems && secondItems.length > 0) {
      let l2Count = 0;
      for (const l2Name of secondItems) {
        let clicked = false;
        // 多策略：尝试 body/页面级定位（级联切换后可能在新的 popover 实例中）
        for (const strategy of [
          // 策略 1: page 级 getByText
          () => page.getByText(l2Name).first(),
          // 策略 2: page 级 div.filter({hasText}) — recorded.js 验证
          () => page.locator('div').filter({ hasText: new RegExp(`^${escapeRegex(l2Name)}$`) }).first(),
          // 策略 3: popover 级 div.filter({hasText}) — 回退
          () => popover.locator('div').filter({ hasText: new RegExp(`^${escapeRegex(l2Name)}$`) }).first(),
        ]) {
          try {
            await strategy().click({ timeout: 3000 });
            clicked = true;
            break;
          } catch { /* try next */ }
        }
        if (clicked) {
          l2Count++;
          await page.waitForTimeout(300);
        } else {
          LOG.warn(`[${idx + 1}] 勾选二级类目 "${l2Name}" 失败（3种策略均超时）`);
        }
      }
      if (l2Count > 0) {
        LOG.ok(`[${idx + 1}] 已勾选 ${l2Count}/${secondItems.length} 个二级类目`);
      }
      if (secondItems.length > 0 && l2Count === 0) {
        await page.screenshot({ path: resolve(__dirname, 'debug-cascader.png'), fullPage: false }).catch(() => {});
      }
    }
  }

  // 3. 关闭 popover（recorded.js 验证：所有选择完成后统一关闭）
  try {
    await trigger.click({ timeout: 3000 });
    await page.waitForTimeout(400);
    LOG.ok('已关闭级联选择器弹出面板');
  } catch (e) {
    LOG.warn(`关闭级联选择器弹出面板失败: ${e.message}`);
  }

  if (anySelected) {
    LOG.ok('自动选择类目完成');
  } else {
    LOG.warn('未成功选择任何类目');
  }
  return anySelected;
}


// ============================================================
// 12e. 根据 sub_CONFIG 自动勾选三级类目 checkbox
// ============================================================
/**
 * 在二级类目视图中，根据 sub_CONFIG 自动勾选第三个级联选择器的三级 checkbox。
 * 执行流程：打开 popover → 点击一级类目展开二级 → 点击二级类目展开三级 →
 *           在每个三级类目项中定位并点击 commodity-checkbox。
 *
 * @param {Page} page - Playwright page
 * @param {number} [cascaderIndex=1] - 第几个 cascader（从 0 开始，第二个级联选择器默认 1）
 * @returns {Promise<boolean>} 是否有至少一个 checkbox 勾选成功
 */
async function selectSubCategory(page, cascaderIndex = 1) {
  if (!sub_CONFIG || sub_CONFIG.length === 0) {
    LOG.info('sub_CONFIG 为空，跳过三级类目自动勾选');
    return false;
  }

  LOG.step(`自动勾选三级类目 checkbox（共 ${sub_CONFIG.length} 组一级类目）...`);

  // 1. 找到正确的 cascader trigger（在"二级类目"视图下使用 commodity-popper-trigger）
  // 根据 DOM 调试：类目：标签 → .commodity-input-prefix → .commodity-input-inner__wrapper
  // → .commodity-input-wrapper → .commodity-popper-trigger.commodity-popper-trigger-click.commodity-select-input
  // 通过 "类目：" 文本定位
  const categoryText = page.locator('.commodity-input-prefix').filter({ hasText: '类目：' }).nth(cascaderIndex);
  let popperTrigger;
  try {
    popperTrigger = categoryText.locator('xpath=ancestor::span[contains(@class, "commodity-popper-trigger")]').first();
    await popperTrigger.waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    // 兜底：直接用 .commodity-popper-trigger.commodity-popper-trigger-click 的 nth
    popperTrigger = page.locator('.commodity-popper-trigger.commodity-popper-trigger-click.commodity-select-input').nth(cascaderIndex);
  }

  // 2. 打开 popover
  let popoverOpened = false;
  for (const strategy of [
    // 策略1: 点击 popper trigger 打开
    async () => {
      await popperTrigger.click({ timeout: 5000 });
      await page.waitForTimeout(1500);
      // 检查是否有可见的 popover 面板内容
      const visiblePopover = await page.evaluate(() => {
        const panels = document.querySelectorAll('.commodity-cascader-popover-panel-inner');
        for (const p of panels) {
          if (p.offsetParent !== null) return true;
        }
        return false;
      });
      if (!visiblePopover) throw new Error('无可见 popover 面板');
    },
    // 策略2: 直接点击"类目："文本
    async () => {
      await categoryText.click({ force: true, timeout: 5000 });
      await page.waitForTimeout(1500);
      const visiblePopover = await page.evaluate(() => {
        const panels = document.querySelectorAll('.commodity-cascader-popover-panel-inner');
        for (const p of panels) {
          if (p.offsetParent !== null) return true;
        }
        return false;
      });
      if (!visiblePopover) throw new Error('无可见 popover 面板');
    },
    // 策略3: dispatchEvent
    async () => {
      await popperTrigger.dispatchEvent('click');
      await page.waitForTimeout(2000);
      const visiblePopover = await page.evaluate(() => {
        const panels = document.querySelectorAll('.commodity-cascader-popover-panel-inner');
        for (const p of panels) {
          if (p.offsetParent !== null) return true;
        }
        return false;
      });
      if (!visiblePopover) throw new Error('无可见 popover 面板');
    },
  ]) {
    try {
      await strategy();
      LOG.ok('已打开第二个级联选择器弹出面板');
      popoverOpened = true;
      break;
    } catch { /* try next */ }
  }

  if (!popoverOpened) {
    LOG.warn('打开第二个级联选择器弹出面板失败');
    await page.screenshot({ path: resolve(__dirname, 'debug-popover-fail.png'), fullPage: false }).catch(() => {});
    return false;
  }

  // 等待虚拟列表渲染
  await page.waitForTimeout(2000);

  // 找到包含可见 panel-inner 的 popover wrapper
  const visibleIndex = await page.evaluate(() => {
    const wrappers = document.querySelectorAll('.commodity-cascader-popover-wrapper');
    for (let i = 0; i < wrappers.length; i++) {
      const inner = wrappers[i].querySelector('.commodity-cascader-popover-panel-inner');
      if (inner && inner.offsetParent !== null) return i;
    }
    return -1;
  });
  if (visibleIndex === -1) {
    LOG.warn('未找到可见的级联选择器弹出面板');
    return false;
  }
  const popover = page.locator('.commodity-cascader-popover-wrapper').nth(visibleIndex);
  let anyChecked = false;

  // 3. 遍历 sub_CONFIG
  for (const [idx, entry] of sub_CONFIG.entries()) {
    const { first: firstName, second: secondItems } = entry;

    // 3a. 点击一级类目（第一列），展开二级列
    try {
      const l1Text = popover.locator('.commodity-cascader-column').first()
        .locator('.commodity-cascader-item-label')
        .filter({ hasText: new RegExp(`^${escapeRegex(firstName)}$`) })
        .first();
      await l1Text.click({ timeout: 5000 });
      LOG.ok(`[${idx + 1}] 已展开一级类目 "${firstName}"`);
      await page.waitForTimeout(1000);
    } catch (e) {
      LOG.warn(`[${idx + 1}] 未找到一级类目 "${firstName}"（${e.message}），跳过`);
      continue;
    }

    if (!secondItems || secondItems.length === 0) {
      continue;
    }

    // 2b. 遍历二级类目
    for (const secEntry of secondItems) {
      const { name: secondName, third: thirdItems } = secEntry;

      // 点击二级类目（第二列），展开三级列
      try {
        const l2Text = popover.locator('.commodity-cascader-column').nth(1)
          .locator('.commodity-cascader-item-label')
          .filter({ hasText: new RegExp(`^${escapeRegex(secondName)}$`) })
          .first();
        await l2Text.click({ timeout: 5000 });
        LOG.ok(`  已展开二级类目 "${secondName}"`);
        await page.waitForTimeout(1000);
      } catch (e) {
        LOG.warn(`  未找到二级类目 "${secondName}"（${e.message}），跳过`);
        continue;
      }

      if (!thirdItems || thirdItems.length === 0) {
        continue;
      }

      // 2c. 遍历三级类目，点击 commodity-checkbox
      let l3Count = 0;
      for (const l3Name of thirdItems) {
        let clicked = false;
        for (const strategy of [
          // 策略1: 在第三列中按文本精确定位 item-container，再找内部 checkbox
          async () => {
            const label = popover.locator('.commodity-cascader-column').nth(2)
              .locator('.commodity-cascader-item-label')
              .filter({ hasText: new RegExp(`^${escapeRegex(l3Name)}$`) })
              .first();
            // 从 label 上溯到 commodity-list-item-container，再找 checkbox
            const container = label.locator('xpath=ancestor::div[contains(@class, "commodity-list-item-container")]').first();
            const cb = container.locator('.commodity-checkbox').first();
            await cb.click({ force: true, timeout: 3000 });
          },
          // 策略2: 直接用 container hasText 模糊匹配 + checkbox
          async () => {
            const cb = popover.locator('.commodity-cascader-column').nth(2)
              .locator('.commodity-list-item-container', { hasText: l3Name })
              .locator('.commodity-checkbox')
              .first();
            await cb.click({ force: true, timeout: 3000 });
          },
          // 策略3: page 级回退 — 按文本匹配后上溯到 checkbox
          async () => {
            const label = page.locator('.commodity-cascader-item-label')
              .filter({ hasText: new RegExp(`^${escapeRegex(l3Name)}$`) })
              .first();
            const container = label.locator('xpath=ancestor::div[contains(@class, "commodity-list-item-container")]').first();
            const cb = container.locator('.commodity-checkbox').first();
            await cb.click({ force: true, timeout: 3000 });
          },
        ]) {
          try {
            await strategy();
            clicked = true;
            break;
          } catch { /* try next */ }
        }
        if (clicked) {
          l3Count++;
          anyChecked = true;
          await page.waitForTimeout(250);
        } else {
          LOG.warn(`  勾选三级类目 "${l3Name}" 失败（3种策略均超时）`);
        }
      }
      if (l3Count > 0) {
        LOG.ok(`  已勾选 ${l3Count}/${thirdItems.length} 个三级类目（${secondName}）`);
      }
    }
  }

  // 3. 关闭 popover
  try {
    await popperTrigger.click({ timeout: 3000 });
    await page.waitForTimeout(400);
    LOG.ok('已关闭级联选择器弹出面板');
  } catch (e) {
    LOG.warn(`关闭级联选择器弹出面板失败: ${e.message}`);
  }

  if (anyChecked) {
    LOG.ok('三级类目 checkbox 自动勾选完成');
  } else {
    LOG.warn('未成功勾选任何三级类目');
  }
  return anyChecked;
}


// ============================================================
// 13. 检查已保存的登录态是否有效（独立导出函数）
// ============================================================
/**
 * 检查已保存的 Cookie 登录状态是否仍然有效。
 * 不会执行完整登录流程，主要用于登录态预检。
 *
 * @param {Object} options - { cookiePath }
 * @returns {Promise<{ valid: boolean, cookiePath: string }>}
 */
async function checkSession(options = {}) {
  const cookiePath = options.cookiePath || DEFAULT_COOKIE_PATH;

  try {
    const fs = await import('fs');
    if (!fs.existsSync(cookiePath)) {
      LOG.warn('未找到已保存的 Cookie 文件');
      return { valid: false, cookiePath };
    }

    const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf-8'));
    if (!Array.isArray(cookies) || cookies.length === 0) {
      LOG.warn('Cookie 文件为空');
      return { valid: false, cookiePath };
    }

    // 检查是否包含目标域名 Cookie 且未过期
    const yuntuCookies = cookies.filter(c =>
      c.domain?.includes('oceanengine.com') || c.domain?.includes('yuntu')
    );

    if (yuntuCookies.length === 0) {
      LOG.warn('Cookie 中不包含云平台相关会话');
      return { valid: false, cookiePath };
    }

    // 检查是否有未过期的 Cookie
    const now = Date.now() / 1000;
    const validCookies = yuntuCookies.filter(c => !c.expires || c.expires > now);

    if (validCookies.length === 0) {
      LOG.warn('Cookie 已过期，需要重新登录');
      return { valid: false, cookiePath };
    }

    // 找到 session cookie 的有效期
    const maxExpiry = Math.max(...validCookies.map(c => c.expires || 0));
    const expireDate = maxExpiry ? new Date(maxExpiry * 1000).toLocaleString() : '未知';
    LOG.ok(`Cookie 有效 (${validCookies.length} 个有效 Cookie，过期时间: ${expireDate})`);
    return { valid: true, cookiePath };

  } catch (e) {
    LOG.warn(`检查登录态失败: ${e.message}`);
    return { valid: false, cookiePath };
  }
}

// ============================================================
// 13. 主流程
// ============================================================
/**
 * 执行云图登录完整流程。
 *
 * @param {Object} [options] - 配置选项
 * @param {boolean} [options.headless] - 无头模式
 * @param {string} [options.cookiePath] - Cookie 保存/读取路径
 * @param {string} [options.screenshotPath] - 截图保存路径
 * @param {boolean} [options.reuseCookie] - 是否优先尝试复用已保存的 Cookie（默认 true）
 * @returns {Promise<Object>} 登录结果 { success, cookiePath, screenshotPath, url, error? }
 */
async function login(options = {}) {
  const {
    headless = false,
    cookiePath = DEFAULT_COOKIE_PATH,
    screenshotPath = DEFAULT_SCREENSHOT_PATH,
    reuseCookie = true,
  } = options;

  let browser = null;
  let pageRef = null; // 在 finally 中用于暂停
  let result = { success: false, cookiePath, screenshotPath, url: '' };

  try {
    // 环境检测
    const playwrightReady = await checkPlaywright();
    if (!playwrightReady) {
      result.error = 'Playwright 未安装';
      return result;
    }

    // 启动浏览器
    const ctx = await setup({ headless });
    browser = ctx.browser;
    const { context, page } = ctx;
    pageRef = page;

    // 尝试复用 Cookie
    let cookieRestored = false;
    if (reuseCookie) {
      cookieRestored = await tryRestoreSession(context, cookiePath);
    }

    if (cookieRestored) {
      // 使用 Cookie 登录：直接导航验证
      LOG.step('使用已保存的登录态尝试直接访问...');
      await page.goto(LOGIN_URL, {
        waitUntil: 'networkidle',
        timeout: TIMEOUTS.PAGE_LOAD,
      });
      await page.waitForTimeout(2000);

      const verifyResult = await verifyLogin(page);
      if (verifyResult.success) {
        LOG.ok('✓ 使用已保存的登录态登录成功！');
        result.success = true;
        result.url = page.url();
        // 导航到商品分析页面
        await navigateToProductAnalysis(page);
        return result;
      }

      LOG.warn('已保存的登录态已失效，执行完整登录流程...');
    }

    // === 完整登录流程 ===
    // 导航
    await navigateToLogin(page);

    // 切换到邮箱登录模式
    await switchToEmailLogin(page);

    // 勾选同意协议
    await checkAgreement(page);

    // 填写表单
    await fillCredentials(page);

    // 提交登录
    const submitOk = await submitLogin(page);
    if (!submitOk) {
      throw new Error('登录提交失败：多次尝试后仍无法触发登录');
    }

    // 等待跳转
    await page.waitForTimeout(3000);

    // 验证登录
    const verifyResult = await verifyLogin(page);

    if (verifyResult.success) {
      // 持久化登录状态
      await persistState(context, page, { cookiePath, screenshotPath });
      result.success = true;
      result.url = page.url();
      LOG.ok('=== 云图登录成功 ===');
      // 导航到商品分析页面
      await navigateToProductAnalysis(page);
      return result;
    } else {
      // 保存当前状态供调试
      try {
        await page.screenshot({ path: screenshotPath.replace('.png', '-debug.png') });
      } catch { /* ignore */ }
      result.url = page.url();
      result.error = '登录验证未通过，请检查页面状态';
      LOG.error('登录失败：验证未通过');
    }

  } catch (e) {
    result.error = e.message;
    LOG.error(`登录流程异常: ${e.message}`);
  } finally {
    if (browser) {
      // 暂停，让用户查看浏览器状态，按 Enter 后关闭
      await pauseForInteraction(pageRef, '测试完成，请查看页面状态');
      await browser.close();
      LOG.info('浏览器已关闭');
    }
  }

  return result;
}

// ============================================================
// 14. CLI 入口
// ============================================================
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║       巨量引擎云图 · 自动登录脚本            ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  const args = parseArgs();

  LOG.info(`目标: ${LOGIN_URL}`);
  LOG.info(`账号: ${ACCOUNT}`);
  LOG.info(`Cookie: ${args.cookiePath}`);
  LOG.info(`截图: ${args.screenshotPath}`);
  LOG.info(`模式: ${args.headless ? '无头' : '有头'}`);
  console.log('');

  // 如果是 --cookie 模式，先检查 Cookie 是否有效
  const cookieArgIndex = process.argv.indexOf('--cookie');
  const explicitCookie = cookieArgIndex !== -1;
  if (explicitCookie) {
    const sessionCheck = await checkSession({ cookiePath: args.cookiePath });
    if (sessionCheck.valid) {
      LOG.info('已保存的登录态有效，无需重新登录');
    } else {
      LOG.info('登录态已失效或不存在，将执行完整登录');
    }
  }

  // 如果提供了 --check 参数，只检查登录态不执行登录
  if (process.argv.includes('--check')) {
    const result = await checkSession({ cookiePath: args.cookiePath });
    process.exit(result.valid ? 0 : 1);
  }

  const result = await login({
    headless: args.headless,
    cookiePath: args.cookiePath,
    screenshotPath: args.screenshotPath,
    reuseCookie: true,
  });

  // 输出结构化的 JSON 结果
  console.log('\n--- 登录结果 ---');
  console.log(JSON.stringify(result, null, 2));

  process.exit(result.success ? 0 : 1);
}

// 当直接作为 CLI 执行时
if (process.argv[1] && process.argv[1].endsWith('yuntu-login.js')) {
  main();
}

// ============================================================
// 导出模块接口
// ============================================================
export { login, checkSession };
