// 云图操作注册表
// 来源: yuntu-switch-category.js + yuntu-trend-extract.js + extract-yuntu-selling.js
// 验证产出: 趋势品_男装_5-9月_全量_20260515.json (187KB)
//          卖点识别_全量提取.json (22KB)
//          mens-shoes-products-final.json (10个商品链接)

const runtime = require('../packages/browser-runtime');

// ============================================================
// 趋势表格 (Stage 1) — 全自动
// 来源: yuntu-switch-category.js + yuntu-trend-extract.js
// 产出: 趋势品_男装_5-9月_全量_20260515.json (187KB, 5个月全量翻页)
// ============================================================

/** 打开cascader并获取位置 */
async function openCascader(cdp) {
  const r = await runtime.cdp(cdp, 'Runtime.evaluate', {
    expression: `(function(){
      var all = document.querySelectorAll(".commodity-cascader-select");
      for (var i=0;i<all.length;i++){
        var re = all[i].getBoundingClientRect();
        if (re.width>0 && re.height>0) return JSON.stringify({x:Math.round(re.x+re.width/2), y:Math.round(re.y+re.height/2)});
      }
      return JSON.stringify({x:1465,y:113});
    })()`,
    returnByValue: true
  });
  const pos = JSON.parse(r.result.value);
  await runtime.click(cdp, pos.x, pos.y);
  await runtime.S(4000);
  return pos;
}

/** elementFromPoint + fiber.onClick 点击 */
async function fiberClick(cdp, x, y) {
  return runtime.cdp(cdp, 'Runtime.evaluate', {
    expression: `(function(){
      var el=document.elementFromPoint(${x},${y});
      if(!el)return "no element";
      var fiberKey=Object.keys(el).find(function(k){return k.startsWith("__reactFiber")});
      if(!fiberKey)return "no fiber";
      var fiber=el[fiberKey],depth=0;
      while(fiber&&depth<20){
        if(fiber.memoizedProps&&fiber.memoizedProps.onClick){
          fiber.memoizedProps.onClick({stopPropagation:function(){},preventDefault:function(){}});
          return "clicked depth "+depth;
        }
        fiber=fiber.return;depth++;
      }
      return "no onClick in chain";
    })()`,
    returnByValue: true
  });
}

/** 扫描下拉菜单中的可选项 */
async function scanDropdownItems(cdp) {
  const r = await runtime.cdp(cdp, 'Runtime.evaluate', {
    expression: `(function(){
      var all=document.querySelectorAll("*"),items=[];
      for(var i=0;i<all.length;i++){
        var t=(all[i].innerText||all[i].textContent||"").trim();
        var re=all[i].getBoundingClientRect();
        if(t.length>0&&t.length<30&&re.y>100&&re.y<900&&re.x>1100&&all[i].children.length===0)
          items.push({t:t,x:Math.round(re.x+re.width/2),y:Math.round(re.y+re.height/2)});
      }
      return JSON.stringify(items);
    })()`,
    returnByValue: true
  });
  return JSON.parse(r.result.value || '[]');
}

/**
 * 切换类目 — 全自动
 * 来源: yuntu-switch-category.js v2
 * 产出: 趋势品_男装_5-9月_全量_20260515.json
 */
async function switchCategory(cdp, categoryL1, categoryL2) {
  // 1. 打开cascader
  await openCascader(cdp);

  // 2. 扫描可选项
  let items = await scanDropdownItems(cdp);
  let l1 = items.find(i => i.t === categoryL1);
  if (!l1) throw new Error(`L1 ${categoryL1} not found. Available: ${items.map(i=>i.t).filter(t=>t.length>1&&t.length<15).join(', ')}`);

  // 3. fiber click L1
  await fiberClick(cdp, l1.x, l1.y);
  await runtime.S(4000);

  // 4. 重新扫描找到L2
  let l2 = items.find(i => i.t === categoryL2);
  if (!l2) {
    items = await scanDropdownItems(cdp);
    l2 = items.find(i => i.t === categoryL2);
  }
  if (!l2) throw new Error(`L2 ${categoryL2} not found`);

  // 5. fiber click L2
  await fiberClick(cdp, l2.x, l2.y);
  await runtime.S(3000);

  // 6. 关闭cascader
  await openCascader(cdp);
  await runtime.S(6000);

  // 7. 验证
  const verify = await runtime.cdp(cdp, 'Runtime.evaluate', {
    expression: `(function(){var t=document.body.innerText;var i=t.indexOf("类目：");return i<0?"no match":t.substring(i,i+100);})()`,
    returnByValue: true
  });
  const txt = verify.result.value || '';
  return txt.includes(categoryL2) || txt.includes(categoryL1);
}

/**
 * 切换月份
 * 来源: yuntu-trend-extract.js
 * 产出: 趋势品_男装_5-9月_全量_20260515.json (5个月份数据)
 */
async function switchMonth(cdp, monthIndex) {
  // monthIndex: 0=1月 ... 11=12月, Radio at y≈216
  const baseX = 260, stepX = 56;
  await runtime.click(cdp, baseX + monthIndex * stepX, 216);
  await runtime.S(3000);
  const text = await runtime.getPageText(cdp);
  return text.length > 100;
}

/**
 * 翻页 — fiber.onClick pager LI
 * 来源: yuntu-trend-extract.js
 * 产出: 趋势品_男装_5-9月_全量_20260515.json (26页全量翻页)
 */
async function nextPage(cdp) {
  const r = await runtime.cdp(cdp, 'Runtime.evaluate', {
    expression: `(function(){
      var items=document.querySelectorAll('.auxo-pager li');
      for(var i=0;i<items.length;i++){
        if(items[i].className.indexOf('active')>=0&&items[i+1]){
          var fiberKey=Object.keys(items[i+1]).find(function(k){return k.startsWith('__reactFiber')});
          if(fiberKey){
            var fiber=items[i+1][fiberKey];
            for(var d=0;d<10;d++){
              if(fiber.memoizedProps&&fiber.memoizedProps.onClick){
                fiber.memoizedProps.onClick({stopPropagation:function(){},preventDefault:function(){}});
                return "ok";
              }
              fiber=fiber.return;
            }
          }
          items[i+1].click();return "fallback-click";
        }
      }
      return "no next page";
    })()`,
    returnByValue: true
  });
  await runtime.S(4000);
  return r.result.value;
}

/**
 * 提取趋势表格数据
 * 来源: yuntu-trend-extract.js parseSubCategories()
 * 产出: 趋势品_男装_5-9月_全量_20260515.json
 */
async function extractTrendTable(cdp) {
  const text = await runtime.getPageText(cdp);
  if (!text || text.length < 100) return [];

  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  const cats = [];
  const start = lines.indexOf('二级类目');
  if (start < 0) return cats;

  let i = start + 1;
  while (i < lines.length && (lines[i].length < 2 || lines[i] === '操作' || lines[i].includes('指数'))) i++;

  for (; i < lines.length - 5; i++) {
    const name = lines[i];
    if (name.length < 2 || name.length > 30 || name === '操作' || name.startsWith('查看') || name.startsWith('共')) continue;
    const feature = lines[i+1] || '';
    if (feature.includes('热卖潜力') || feature.includes('需求') || feature.includes('供给') || feature.includes('增长') || feature.includes('周期') || feature.includes('其他')) {
      cats.push({ category: name, feature, rank: lines[i+2]||'', contribution: lines[i+3]||'', growth: lines[i+4]||'' });
      i += 5;
    } else { i++; }
  }
  return cats;
}

/** 翻页提取全部趋势数据 */
async function extractAllTrendPages(cdp, maxPages) {
  const all = [];
  for (let p = 1; p <= (maxPages || 26); p++) {
    const cats = await extractTrendTable(cdp);
    if (cats.length === 0) break;
    all.push(...cats);
    if (p < (maxPages || 26)) {
      const r = await nextPage(cdp);
      if (r === 'no next page') break;
    }
  }
  return all;
}

// ============================================================
// 卖点识别 (Stage 2) — 暖启动+cascader搜索+遍历卖点类型
// 来源: extract-yuntu-selling.js
// 产出: 卖点识别_全量提取.json (8种卖点类型)
//      mens-shoes-products-final.json (haohuo商品链接)
// ============================================================

/** 暖启动 — dispatchEvent 卖点识别 tab */
async function warmUpSellingTab(cdp) {
  await runtime.cdp(cdp, 'Runtime.evaluate', {
    expression: `(function(){
      var tabs=document.querySelectorAll('.commodity-tab-bar-item');
      for(var i=0;i<tabs.length;i++){
        if(tabs[i].innerText.includes('卖点识别')){
          tabs[i].dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
          tabs[i].dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
          tabs[i].click();
          return 'ok';
        }
      }
      return 'no tab';
    })()`,
    returnByValue: true
  });
  await runtime.S(3000);
}

/** 切换卖点类型 (SelectTagList__FilterItem DOM click) */
async function switchSellingPointType(cdp, typeIndex) {
  const r = await runtime.cdp(cdp, 'Runtime.evaluate', {
    expression: `(function(){
      var items=document.querySelectorAll('.SelectTagList__FilterItem');
      if(${typeIndex}>=items.length)return JSON.stringify({end:true,total:items.length});
      items[${typeIndex}].dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
      items[${typeIndex}].dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
      items[${typeIndex}].click();
      return JSON.stringify({name:items[${typeIndex}].innerText.trim(),index:${typeIndex}});
    })()`,
    returnByValue: true
  });
  await runtime.S(3000);
  return JSON.parse(r.result.value);
}

/** 提取关键词表 */
async function extractKeywords(cdp) {
  const r = await runtime.cdp(cdp, 'Runtime.evaluate', {
    expression: `document.querySelector('[class*=ProductKeywordsTable]')?.innerText||''`,
    returnByValue: true
  });
  return (r.result.value || '').split('\n').filter(l => l.trim());
}

/** 提取商品表 (HotProductsTable innerText) */
async function extractProducts(cdp) {
  const r = await runtime.cdp(cdp, 'Runtime.evaluate', {
    expression: `document.querySelector('[class*=HotProductsTable]')?.innerText||''`,
    returnByValue: true
  });
  return r.result.value || '';
}

/** 提取商品链接 — haohuo.jinritemai.com 格式 */
async function extractProductLinks(cdp) {
  const r = await runtime.cdp(cdp, 'Runtime.evaluate', {
    expression: `(function(){
      var links=[],all=document.querySelectorAll('a[href*="haohuo"]');
      for(var i=0;i<all.length;i++)links.push(all[i].href);
      if(!links.length){
        var text=document.querySelector('[class*=HotProductsTable]')?.innerText||'';
        var ids=text.match(/\\d{19}/g)||[];
        links=ids.map(function(id){return'https://haohuo.jinritemai.com/views/product/detail?id='+id});
      }
      return JSON.stringify([...new Set(links)]);
    })()`,
    returnByValue: true
  });
  return JSON.parse(r.result.value || '[]');
}

// ============================================================
// 综合流程
// ============================================================

/** 趋势品全自动选品 */
async function trendSelection(cdp, categoryL1, options = {}) {
  const { months = [5,6,7,8], maxPages = 26 } = options;

  await switchCategory(cdp, categoryL1, options.categoryL2 || categoryL1);
  const results = { category: categoryL1, months: {}, products: [] };

  for (const m of months) {
    await switchMonth(cdp, m - 1);
    results.months[m] = await extractAllTrendPages(cdp, maxPages);
  }

  // Stage 2: 卖点识别
  await warmUpSellingTab(cdp);

  for (let t = 0; t < 9; t++) {
    const tp = await switchSellingPointType(cdp, t);
    if (tp.end) break;
    const products = await extractProducts(cdp);
    const links = await extractProductLinks(cdp);
    const keywords = await extractKeywords(cdp);
    results.products.push({ type: tp.name, keywords, products, links });
  }

  return results;
}

module.exports = {
  // 类目+月份切换
  switchCategory, switchMonth, nextPage,
  // 数据提取
  extractTrendTable, extractAllTrendPages,
  // 卖点识别
  warmUpSellingTab, switchSellingPointType,
  extractKeywords, extractProducts, extractProductLinks,
  // 综合
  trendSelection,
  // 底层工具
  fiberClick, scanDropdownItems, openCascader
};
