import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://yuntu.oceanengine.com/account/login');
  await page.getByText('类目：').nth(1).click();
  await page.locator('div').filter({ hasText: /^钟表配饰$/ }).first().click();
  await page.locator('div').filter({ hasText: /^钟表类$/ }).nth(2).click();
  await page.locator('div').filter({ hasText: /^腕表$/ }).first().click();
  await page.locator('div').filter({ hasText: /^摇表器$/ }).first().click();
  await page.locator('div').filter({ hasText: /^服饰内衣$/ }).first().click();
  await page.locator('div').filter({ hasText: /^服饰配件\/皮带\/帽子\/围巾$/ }).first().click();
  await page.locator('div').filter({ hasText: /^袖扣$/ }).first().click();
  await page.locator('div').filter({ hasText: /^3C数码家电$/ }).first().click();
  await page.locator('span').filter({ hasText: '二级类目' }).first().click();
  await page.getByText('类目：').nth(1).click();
  await page.locator('div').filter({ hasText: /^服饰内衣$/ }).first().click();
  await page.locator('div').filter({ hasText: /^女装$/ }).first().click();
  await page.locator('div').filter({ hasText: /^POLO衫$/ }).first().click();
  await page.locator('div').filter({ hasText: /^毛衣$/ }).first().click();
});