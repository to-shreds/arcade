import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { SHARED_ACTIVITY_IDS } from '../multiplayer/models/shared-activity-validator.js';
const require=createRequire(import.meta.url);
const {JSDOM,VirtualConsole}=require('../cloudflare/chess-worker/node_modules/jsdom');
const root=new URL('../',import.meta.url);
const catalog=JSON.parse(await readFile(new URL('catalog.json',root),'utf8'));
const sharedSource=await readFile(new URL('multiplayer/shared-activity.js',root),'utf8');
let checked=0,menus=0;
const checkedActivities=[];
for(const item of catalog.items.filter(item=>item.enabled&&!item.warning)){
  const source=await readFile(new URL(item.launchPath,root),'utf8');
  if(!source.includes('shared-activity.js'))continue;
  const errors=[],virtualConsole=new VirtualConsole();
  virtualConsole.on('jsdomError',error=>errors.push(error.message));
  const dom=new JSDOM(source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''),{
    url:'https://to-shreds.github.io/arcade/'+item.launchPath,runScripts:'outside-only',pretendToBeVisual:true,virtualConsole
  });
  const w=dom.window;
  try{
    let homeCalls=0;
    w.ArcadeSave={goHome(){homeCalls++;}};
    w.ArcadeSharedRoomClient={createRoomClient(){return {session:null,saved(){return null;},disconnect(){}};}};
    w.eval(sharedSource);
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    assert.ok(w.document.querySelector('#shared-menu-home'),item.folder+': local menu has Home');
    w.document.querySelector('#shared-menu-home').click();
    assert.equal(homeCalls,1,item.folder+': local menu uses the shell-preserving Home route');
    for(const content of w.document.querySelectorAll('[data-shared-menu-content]')){
      if(content.id==='shared-menu-online')continue;
      const home=[...content.querySelectorAll('button,a')].find(button=>/back to arcade|arcade home/i.test(button.textContent));
      assert.ok(home,item.folder+': each setup/pause menu includes Back to Arcade');
      const added=content.querySelector('[data-shared-home]');
      if(added){
        assert.equal(added.dataset.sharedUi,'true',item.folder+': navigation stays out of checkpoints');
        const before=homeCalls;added.click();assert.equal(homeCalls,before+1,item.folder+': added Home is wired');
      }
      menus++;
    }
    assert.deepEqual(errors,[],item.folder+': menu build has no JavaScript errors');
    checked++;
    checkedActivities.push(item.folder);
  }finally{w.close();}
}
assert.deepEqual(checkedActivities.sort(),[...SHARED_ACTIVITY_IDS].sort(),'Every allowlisted activity has an enabled catalog entry and shared menus');
console.log(`Verified Back to Arcade in ${menus} shared activity menus across ${checked} activities.`);
