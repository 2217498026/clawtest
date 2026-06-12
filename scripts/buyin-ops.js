// 百应操作注册表
// 来源: baiying-ranking-extract.js + baiying-detail-extract.js
//       + extract-reviews-for-sales-ratio.js
// 验证产出: baiying_sportswear_final_2026-05-13.json (62KB, 166件)
//          联盟榜单_运动户外_2026-05-12.json (12KB)
//          联盟榜单_女装/美妆/食品饮料 (各12-14KB)

const runtime = require('../packages/browser-runtime');

// ============================================================
// 联盟榜单 (merch-picking-hall/rank)
// 产出: 联盟榜单_运动户外_2026-05-12.json
// ============================================================

/** 用侧边栏点击导航到联盟榜单 [137,313] */
async function navigateToRanking(cdp) {
  await runtime.click(cdp, 137, 313);
  await runtime.S(5000);
}

/** 直接URL导航到联盟榜单 */
async function navigateToRankingURL(cdp) {
  await runtime.navigateTo('https://buyin.jinritemai.com/dashboard/merch-picking-hall/rank');
  await runtime.S(8000);
}

/** 切换子榜 (textContent 匹配) */
async function switchSubRank(cdp, name) {
  // name: 爆款榜/热推榜/趋势榜/常销榜
  const r = await runtime.cdp(cdp, 'Runtime.evaluate', {
    expression: `(function(){
      var all=document.querySelectorAll("*");
      for(var i=0;i<all.length;i++){
        if(all[i].textContent.trim()==="${name}"){
          var re=all[i].getBoundingClientRect();
          if(re.y>200){all[i].click();return"clicked";}
        }
      }
      return"nf";
    })()`,
    returnByValue: true
  });
  await runtime.S(3000);
  return r.result.value;
}

/** 切换类目 (textContent 点击, 已知不稳定) */
async function switchCategoryText(cdp, categoryName) {
  const r = await runtime.cdp(cdp, 'Runtime.evaluate', {
    expression: `(function(){
      var all=document.querySelectorAll("*");
      for(var i=0;i<all.length;i++){
        if(all[i].children.length===0&&all[i].textContent.trim()==="${categoryName}"){
          all[i].click();return"clicked";
        }
      }
      return"nf";
    })()`,
    returnByValue: true
  });
  await runtime.S(4000);
  return r.result.value;
}

/**
 * 提取联盟榜单商品 — innerText + compact行解析
 * 产出: 联盟榜单_运动户外_2026-05-12.json (12KB)
 */
async function extractRankingProducts(cdp) {
  const text = await runtime.getPageText(cdp);
  if (!text || text.length < 100) return [];

  const products = [];
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  let i = 0;

  while (i < lines.length) {
    const rank = parseInt(lines[i]);
    if (isNaN(rank) || rank < 1 || rank > 50) { i++; continue; }
    i++;

    // Product name
    let name = lines[i]; i++;
    while (i < lines.length && lines[i].length < 20 &&
      (lines[i].indexOf('分') < 0 || lines[i].length > 4) &&
      lines[i].indexOf('赚') < 0 && lines[i].indexOf('%') < 0) {
      name += ' ' + lines[i]; i++;
    }

    // Shop name + score
    let shop = '', score = 0;
    for (let j = i; j < Math.min(i + 10, lines.length); j++) {
      const m = lines[j].match(/^(\d+)分$/);
      if (m && lines[j-1]) { shop = lines[j-1]; score = parseInt(m[1]); i = j + 1; break; }
    }

    // Commission
    let commRate = '', commEarn = '';
    for (let j = i; j < Math.min(i + 10, lines.length); j++) {
      if (lines[j].indexOf('%') >= 0 && lines[j].length < 5) { commRate = lines[j]; }
      if (lines[j].startsWith('赚¥')) { commEarn = lines[j]; i = j + 1; break; }
    }

    products.push({ rank, name, shop, score, commRate, commEarn });
  }
  return products;
}

// ============================================================
// 商品详情 (merch-promoting)
// 产出: baiying_sportswear_final_2026-05-13.json (含佣金+体验分+蓝海评分)
// ============================================================

/** 在联盟榜单中点击商品TD打开详情页 */
async function clickProductByName(cdp, keyword) {
  const r = await runtime.cdp(cdp, 'Runtime.evaluate', {
    expression: `(function(){
      var kw="${keyword}";
      var all=document.querySelectorAll("*");
      for(var i=0;i<all.length;i++){
        if(all[i].children.length>0)continue;
        var t=all[i].textContent.trim();
        if(t.indexOf(kw)>=0&&t.length>kw.length+3){
          var re=all[i].getBoundingClientRect();
          if(re.x>500&&re.y>200){all[i].click();return JSON.stringify({x:re.x,y:re.y,text:t.substring(0,80)});}
        }
      }
      return"nf";
    })()`,
    returnByValue: true
  });
  await runtime.S(5000);
  return r.result.value;
}

/** 切换商品详情 sub-tab (y=503) */
async function switchDetailTab(cdp, tabX) {
  // 带货数据[680]|受众数据[776]|带货内容[872]|商品评价[968]|商品详情[1064]
  await runtime.click(cdp, tabX, 503);
  await runtime.S(3000);
}

/** 提取商品评价数据 [968,503] */
async function extractReviews(cdp) {
  // 点击 商品评价 tab
  await switchDetailTab(cdp, 968);
  const text = await runtime.getPageText(cdp);

  // Parse: 全部\n[数字] | 好评\n[数字] | 中差评\n[数字] | 有图\n[数字] | 追评\n[数字]
  const extract = (label) => {
    const re = new RegExp(label + '\\s*\\n?\\s*(\\d+)');
    const m = text.match(re);
    return m ? parseInt(m[1]) : 0;
  };

  return {
    total: extract('全部'),
    good: extract('好评'),
    bad: extract('中差评'),
    withImage: extract('图'),
    followUp: extract('追评')
  };
}

/** 提取商品基本信息 (带货数据tab) */
async function extractProductInfo(cdp) {
  await switchDetailTab(cdp, 680);
  await runtime.S(2000);
  const text = await runtime.getPageText(cdp);

  // Extract: 到手价/已售/佣金/店铺分
  const info = {};
  const priceM = text.match(/到手价\s*¥?(\d+\.?\d*)/);
  if (priceM) info.price = parseFloat(priceM[1]);

  const salesM = text.match(/已售\s*(\d+\.?\d*)万?\+?/);
  if (salesM) {
    info.sales = parseFloat(salesM[1]);
    if (text.match(/已售\s*\d+\.?\d*万/)) info.sales *= 10000;
  }

  const commM = text.match(/(\d+)%/);
  if (commM) info.commissionRate = parseInt(commM[1]);

  const scoreM = text.match(/(\d+)分/);
  if (scoreM) info.shopScore = parseInt(scoreM[1]);

  // 获取当前URL
  const urlR = await runtime.cdp(cdp, 'Runtime.evaluate', {
    expression: 'location.href', returnByValue: true
  });
  info.url = urlR.result.value;

  return info;
}

// ============================================================
// 蓝海评分 (验证产出: baiying_sportswear_final)
// ============================================================

/** 计算蓝海评分 */
function blueOceanScore(product) {
  const salesScore = product.sales > 100000 ? 5 : product.sales > 10000 ? 4 :
    product.sales > 1000 ? 3 : product.sales > 100 ? 2 : 1;
  const commScore = product.commissionRate > 30 ? 5 : product.commissionRate > 20 ? 4 :
    product.commissionRate > 10 ? 3 : product.commissionRate > 5 ? 2 : 1;
  const shopScore = product.shopScore > 95 ? 5 : product.shopScore > 90 ? 4 :
    product.shopScore > 85 ? 3 : product.shopScore > 80 ? 2 : 1;

  const total = salesScore + commScore + shopScore;
  return {
    total,
    salesScore, commScore, shopScore,
    level: total >= 12 ? '强烈推荐' : total >= 9 ? '推荐' : total >= 6 ? '可考虑' : '观望',
    estimatedProfit: product.commissionRate ? (product.price * product.commissionRate / 100).toFixed(1) : 0
  };
}

// ============================================================
// 综合流程
// ============================================================

/** 联盟榜单完整选品 */
async function rankingSelection(cdp, category, options = {}) {
  const { subRanks = ['爆款榜'] } = options;
  const allProducts = [];

  for (const subRank of subRanks) {
    await switchSubRank(cdp, subRank);
    await switchCategoryText(cdp, category);
    const products = await extractRankingProducts(cdp);

    // 评分
    for (const p of products) {
      p.blueOcean = blueOceanScore(p);
    }

    allProducts.push({ subRank, products });
  }

  return {
    platform: '百应',
    method: '联盟榜单+蓝海评分',
    category,
    extracted: allProducts.reduce((s, g) => s + g.products.length, 0),
    groups: allProducts
  };
}

module.exports = {
  // 联盟榜单
  navigateToRanking, navigateToRankingURL,
  switchSubRank, switchCategoryText,
  extractRankingProducts,
  // 商品详情
  clickProductByName, switchDetailTab,
  extractReviews, extractProductInfo,
  // 评分
  blueOceanScore,
  // 综合
  rankingSelection
};
