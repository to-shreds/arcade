// Real navigation for menu-specific checks and the public smoke test.
export async function openMultiplayerMenu(page, gesture='click'){
  if(await page.locator('#shared-panel').isVisible())return;
  let entry=page.locator('[data-shared-open]:visible').first();
  if(!await entry.count()){
    const toggle=page.locator('[data-shared-menu-toggle]:visible').first();
    await toggle[gesture]();
    entry=page.locator('[data-shared-open]:visible').first();
  }
  await entry[gesture]();
  await page.locator('#shared-panel').waitFor({state:'visible'});
}
