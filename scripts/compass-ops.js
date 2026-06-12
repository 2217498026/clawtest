// 罗盘操作注册表
// 来源: compass-switch-category.js + extract-rank-products.js
//       + compass-search-extract.js
// 验证产出: 助手确认攻克17/21子榜 (商品9/9 达人4/4 内容8/8 市场3/4 搜索2/2)
//          全部交互控件测试通过 (时间/品牌/价格带/载体/账号类型/GMV区间)

const runtime = require('../packages/browser-runtime');

// ============================================================
// 类目切换 — ecom-cascader-menu-item DOM click
// 来源: compass-switch-category.js
// 验证: 7个子类目全部切换成功
// ============================================================

/** 罗盘类目切换 — ecom-cascader-menu-item */
async function switchCategory(cdp, categoryL3, categoryL4) {
  // 1. Open cascader picker
  await runtime.click(cdp, 274, 410);
  await runtime.S(3000);

  // 2. Click L3 category
  const r = await runtime.cdp(cdp, 'Runtime.evaluate', {
    expression: `(function(){
      var t="${categoryL3}";
      var items=document.querySelectorAll(".ecom-cascader-menu-item");
      for(var i=0;i<items.length;i++){
        if(items[i].textContent.trim()===t){
          items[i].click();
          items[i].dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true}));
          return JSON.stringify({clicked:t});
        }
      }
      return"not found";
    })()`,
    returnByValue: true
  });
  await runtime.S(4000);

  // 3. Click L4 if specified
  if (categoryL4) {
    await runtime.cdp(cdp, 'Runtime.evaluate', {
      expression: `(function(){
        var t="${categoryL4}";
        var items=document.querySelectorAll(".ecom-cascader-menu-item");
        for(var i=0;i<items.length;i++){
          if(items[i].textContent.trim()===t){
            items[i].click();
            items[i].dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true}));
            return JSON.stringify({clicked:t});
          }
        }
        return"not found";
      })()`,
      returnByValue: true
    });
    await runtime.S(4000);
  }

  return r.result.value;
}

// ============================================================
// 商品榜单 (rank-product) — 9子榜全部攻克
// 来源: extract-rank-products.js
// ============================================================

/**
 * 提取商品榜单 — innerText compact行解析
 * 来源: extract-rank-products.js parseProducts()
 */
async function extractProductRanking(cdp) {
  const text = await runtime.getPageText(cdp);
  if (!text || text.length < 500) return [];

  const lines = text.split('\n');
  // Compact consecutive blank lines
  const compact = [];
  let prevEmpty = true;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l === '点击成交转化率') { compact.push(l); continue; }
    if (l === '') { if (!prevEmpty) compact.push(''); prevEmpty = true; }
    else { compact.push(l); prevEmpty = false; }
  }

  // Find table start after header marker
  let i = 0;
  while (i < compact.length && compact[i] !== '点击成交转化率') i++;
  i++;

  const products = [];
  while (i < compact.length) {
    const l = compact[i];
    if (l === '' || l === '查看详情' || l === '加入追踪' || l === '找货源' ||
        l.startsWith('沪ICP') || l.startsWith('共') || l.startsWith('关联平台')) { i++; continue; }

    const rank = parseInt(l);
    if (isNaN(rank) || rank < 1 || rank > 200) { i++; continue; }

    // Gather product block until next rank number
    const block = [l];
    let j = i + 1;
    while (j < compact.length) {
      const nl = compact[j];
      if (nl === '' || nl === '查看详情' || nl === '加入追踪' || nl === '找货源' ||
          nl.startsWith('沪ICP') || nl.startsWith('共')) { j++; continue; }
      const nr = parseInt(nl);
      if (!isNaN(nr) && nr >= 1 && nr <= 200 && (nr === rank + 1 || nr > rank + 5)) break;
      block.push(nl); j++;
    }

    // Parse: [rank] [name] [priceBand] [store] [payment] [clicks] [sales] [conversion]
    const nonEmpty = block.filter(b => b !== '');
    if (nonEmpty.length >= 5) {
      products.push({
        rank,
        name: nonEmpty[1] || '',
        priceBand: nonEmpty[2] || '',
        store: nonEmpty[3] || '',
        payment: nonEmpty[4] || '',
        clicks: nonEmpty[5] || '',
        sales: nonEmpty[6] || '',
        conversion: nonEmpty[7] || ''
      });
    }
    i = j;
  }
  return products;
}

/** 切换子榜 Tab */
async function switchSubTab(cdp, tabName) {
  // tabName: 总榜/搜索榜/直播榜/商品卡榜/达人带货榜/短视频榜/实时爆品/退后购买/同行低退
  const r = await runtime.cdp(cdp, 'Runtime.evaluate', {
    expression: `(function(){
      var all=document.querySelectorAll("*");
      for(var i=0;i<all.length;i++){
        if(all[i].children.length===0&&all[i].textContent.trim()==="${tabName}"){
          var re=all[i].getBoundingClientRect();
          if(re.y>30&&re.y<80){all[i].click();return"clicked";}
        }
      }
      return"nf";
    })()`,
    returnByValue: true
  });
  await runtime.S(4000);
  return r.result.value;
}

/** 切换品牌类型 — ecom-radio */
async function switchBrandType(cdp, type) {
  // type: 不限/知名品牌/非知名品牌
  return runtime.cdp(cdp, 'Runtime.evaluate', {
    expression: `(function(){
      var all=document.querySelectorAll(".ecom-radio-button-wrapper");
      for(var i=0;i<all.length;i++){
        if(all[i].innerText.includes("${type}")){all[i].click();return"ok";}
      }
      return"nf";
    })()`,
    returnByValue: true
  });
}

/** 切换时间 — ecom-radio-group */
async function switchTimeRange(cdp, range) {
  // range: 近1天/近7天/近30天/自然日/周/月/大促
  // Coordinates: 近1天[1489,234] 近7天[1558,234] 近30天[1630,234]
  const coords = { '近1天': [1489,234], '近7天': [1558,234], '近30天': [1630,234],
                   '自然月': [1706,234], '大促': [1774,234], '更多': [1835,234] };
  if (coords[range]) {
    await runtime.click(cdp, coords[range][0], coords[range][1]);
    await runtime.S(3000);
    return true;
  }
  return false;
}

// ============================================================
// 搜索榜单 (rank-search)
// 来源: compass-search-extract.js
// ============================================================

/** 提取搜索榜单数据 */
async function extractSearchRanking(cdp) {
  const text = await runtime.getPageText(cdp);
  if (!text || text.length < 200) return [];

  // Parse: 搜索词 | 搜索曝光人数 | 支付金额 | 点击率 | 转化率
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  const results = [];
  let i = 0;

  while (i < lines.length - 3) {
    // 搜索词通常是较长的中文词
    if (lines[i].length >= 2 && lines[i].length <= 30 && /[一-龥]/.test(lines[i])) {
      const word = lines[i];
      const exposure = lines[i+1] || '';
      const payment = lines[i+2] || '';
      const clickRate = lines[i+3] || '';
      const conversion = lines[i+4] || '';

      if (exposure.includes('万') || exposure.includes('亿') || payment.includes('¥') || payment.includes('万')) {
        results.push({ word, exposure, payment, clickRate, conversion });
        i += 5;
        continue;
      }
    }
    i++;
  }
  return results;
}

// ============================================================
// 类目挖掘 (category-mining)
// ============================================================

/** 导航到类目挖掘 */
async function navigateToCategoryMining(cdp) {
  await runtime.cdp(cdp, 'Page.navigate', {
    url: 'https://compass.jinritemai.com/shop/chance/category-mining'
  });
  await runtime.S(8000);
}

/** 切换类目挖掘子Tab — ecom-tabs-tab-btn */
async function switchMiningTab(cdp, tabKey) {
  // tabKey: potential(挖掘潜力) / breakout(类目爆款分析) / seasonal(应季日历)
  const r = await runtime.cdp(cdp, 'Runtime.evaluate', {
    expression: `(function(){
      var items=document.querySelectorAll(".ecom-tabs-tab-btn");
      var idx={"potential":0,"breakout":1,"seasonal":2}["${tabKey}"];
      if(!idx&&idx!==0)return"bad key";
      if(idx<items.length){items[idx].click();return"ok";}
      return"out of range";
    })()`,
    returnByValue: true
  });
  await runtime.S(4000);
  return r.result.value;
}

// ============================================================
// 综合流程
// ============================================================

/** 商品榜单完整选品 */
async function rankingSelection(cdp, category, options = {}) {
  const { subTabs = ['总榜'], brandType = '不限' } = options;

  await switchCategory(cdp, category);
  if (brandType !== '不限') await switchBrandType(cdp, brandType);

  const allProducts = [];
  for (const tab of subTabs) {
    await switchSubTab(cdp, tab);
    const products = await extractProductRanking(cdp);
    allProducts.push({ subTab: tab, products });
  }

  return {
    platform: '罗盘',
    category,
    brandType,
    totalExtracted: allProducts.reduce((s, g) => s + g.products.length, 0),
    groups: allProducts
  };
}

module.exports = {
  // 类目
  switchCategory,
  // 商品榜单
  switchSubTab, switchBrandType, switchTimeRange,
  extractProductRanking,
  // 搜索榜单
  extractSearchRanking,
  // 类目挖掘
  navigateToCategoryMining, switchMiningTab,
  // 综合
  rankingSelection
};
