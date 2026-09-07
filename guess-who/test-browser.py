import asyncio, json, os, shutil
from pathlib import Path
from playwright.async_api import async_playwright
BASE='http://127.0.0.1:8787/guess-who/'
OUT=Path(os.environ.get('GUESS_WHO_SCREENSHOTS','test-results/guess-who'));OUT.mkdir(parents=True,exist_ok=True)
MAPPING="""(() => {
 const f=window.fetch.bind(window);window.fetch=(url,opts)=>f(typeof url==='string'?url.replace('https://arcade-chess.jonathanjablon.workers.dev','http://127.0.0.1:8788'):url,opts);
 const WS=window.WebSocket;window.WebSocket=class extends WS{constructor(url,protocols){const mapped=String(url).replace('wss://arcade-chess.jonathanjablon.workers.dev','ws://127.0.0.1:8788');if(protocols===undefined)super(mapped);else super(mapped,protocols);}};
})();"""
async def prepare_capture(page):
 # Browser interactions legitimately scroll these panels. Start each independent
 # viewport capture at the same board position without changing runtime behavior.
 await page.evaluate("""() => {for(const id of ['boardScroll','sidebar']) {const el=document.getElementById(id);el.scrollTop=0;el.scrollLeft=0;}}""")
 await page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or (None if os.environ.get('CI') else shutil.which('chromium')),headless=True,args=['--no-sandbox'])
  errors=[]; contexts=[];pages=[]
  for i in range(2):
   c=await browser.new_context(viewport={'width':390,'height':844} if i else {'width':1280,'height':900},device_scale_factor=1)
   await c.add_init_script(MAPPING);page=await c.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
   contexts.append(c);pages.append(page);await page.goto(BASE);await page.wait_for_selector('#preview svg')
  a,b=pages
  await a.screenshot(path=str(OUT/'guess-setup.png'))
  await a.locator('#nickname').fill('Detective Alice');await a.locator('#create').click();await a.locator('#setup').wait_for(state='hidden')
  code=await a.locator('#roomCode').inner_text();print('Created',code,flush=True)
  await b.locator('#nickname').fill('Detective Bob');await b.locator('#joinCode').fill(code);await b.locator('#join').click();await b.locator('#setup').wait_for(state='hidden')
  await a.wait_for_function('!document.getElementById("start").disabled');await a.locator('#start').click()
  for page,character in [(a,'ada'),(b,'ben')]:
   await page.wait_for_function('document.getElementById("headline").textContent==="Pick your secret character"')
   await page.locator(f'[data-character="{character}"]').click();await page.locator('#modalActions button').click();await page.locator('#modal').wait_for(state='hidden')
  await a.wait_for_function('document.getElementById("headline").textContent.includes("turn")')
  await b.wait_for_function('document.getElementById("headline").textContent.includes("turn")')
  print('Started',await a.locator('#headline').inner_text(),await b.locator('#headline').inner_text(),flush=True)
  await prepare_capture(a);await prepare_capture(b);await a.screenshot(path=str(OUT/'guess-desktop.png'));await b.screenshot(path=str(OUT/'guess-mobile.png'))
  actor=a if await a.locator('#headline').inner_text()=='Your turn, detective!' else b
  other=b if actor==a else a
  await actor.locator('#question').select_option('glasses');await actor.locator('#ask').click()
  await other.wait_for_function('document.getElementById("headline").textContent==="Your turn, detective!"')
  await actor.wait_for_function('document.querySelectorAll("#clueList .clue").length === 1')
  await actor.locator('[data-character="cleo"]').click();assert 'down' in (await actor.locator('[data-character="cleo"]').get_attribute('class'))
  await actor.locator('#undo').click();assert 'down' not in (await actor.locator('[data-character="cleo"]').get_attribute('class'))
  await actor.locator('#applyClues').click();assert await actor.locator('.person.down').count()>0
  await other.locator('details.custom').evaluate('(el)=>el.open=true')
  await other.locator('#customText').fill('Do they like <img src=x onerror="window.BAD=1">?');await other.locator('#askCustom').click()
  await actor.locator('#answerPanel').wait_for(state='visible');assert await actor.locator('#pendingText img').count()==0
  await actor.locator('[data-answer="unsure"]').click();await actor.wait_for_function('document.getElementById("headline").textContent==="Your turn, detective!"')
  await actor.locator('[data-mode="guess"]').click();target='ben' if actor==a else 'ada'
  await actor.locator(f'[data-character="{target}"]').click();await actor.locator('#modalActions button').last.click()
  await a.locator('#result').wait_for(state='visible');await b.locator('#result').wait_for(state='visible')
  assert await actor.locator('#resultTitle').inner_text()=='You win! 🎉'
  assert await a.locator('#reveals .reveal').count()==2
  await a.locator('#rematch').click();await b.locator('#rematch').click()
  await a.wait_for_function('document.getElementById("headline").textContent==="Pick your secret character"')
  for page,ch in [(a,'cleo'),(b,'dex')]:
   await page.locator(f'[data-character="{ch}"]').click();await page.locator('#modalActions button').click();await page.locator('#modal').wait_for(state='hidden')
  await b.wait_for_function('document.getElementById("headline").textContent.includes("turn")')
  await b.locator('[data-character="wren"]').click();assert await b.locator('.person.down').count()==1
  await b.reload();await b.locator('#resume').wait_for(state='visible');await b.locator('#resume').click();await b.locator('#setup').wait_for(state='hidden')
  assert await b.locator('.person.down').count()==1
  await b.locator('#mySecret').click();assert 'Dex' in await b.locator('#modalTitle').inner_text();await b.locator('#modalClose').click()
  for width,height in [(320,568),(390,844),(844,390),(768,1024)]:
   await b.set_viewport_size({'width':width,'height':height});await prepare_capture(b);await b.screenshot(path=str(OUT/f'guess-{width}x{height}.png'))
   bounds=await b.evaluate('({width:document.documentElement.scrollWidth,view:innerWidth,board:document.getElementById("boardScroll").clientHeight,sidebar:document.getElementById("sidebar").clientHeight})')
   assert bounds['width']<=width, bounds
   assert bounds['board']>=100,bounds
  print('BROWSER PASS: create/join/select, turns, built-in/custom questions, XSS text, flip/undo/apply, win/reveal, rematch, saved reconnect, four viewports. Errors:',errors,flush=True)
  assert not errors
  await browser.close()
asyncio.run(main())
