import { WEAPONS,weaponById } from './weapons.js';
import { createGame,applyAction,groundAt } from './engine.js';
import { drawBattle,weaponSvg,terrainSummary } from './graphics.js';

const $=id=>document.getElementById(id);
const canvas=$('field'),weaponSelect=$('weapon'),fireButton=$('fire');
let practice=createGame({seed:123456,terrainType:'hilly'});
let animation=null;
for(const weapon of WEAPONS){
 const option=document.createElement('option');option.value=weapon.id;
 option.textContent=`${weapon.name}${weapon.funNew?' (new)':''}`;weaponSelect.append(option);
}
weaponSelect.value='meatball-meteor';
function selected(){return weaponById(weaponSelect.value)||WEAPONS[0];}
function info(){
 const w=selected();$('weaponInfo').innerHTML=weaponSvg(w);
 const summary=document.createElement('div');const heading=document.createElement('strong');
 const desc=document.createElement('p');heading.textContent=w.name;
 desc.textContent=`${w.description} ${terrainSummary(w)}`;summary.append(heading,desc);
 $('weaponInfo').append(summary);
}
function aims(){
 return [{angle:Number($('angle').value),power:Number($('power').value),weaponId:selected().id},
 {angle:135,power:55,weaponId:null}];
}
function render(now=performance.now()){
 const current=animation?.after||practice;
 if(animation){
  const fraction=Math.min(1,(now-animation.start)/animation.duration);
  animation.tick=fraction*animation.after.lastShot.duration;
  drawBattle(canvas,current,{aims:aims(),animation:{before:animation.before,shot:animation.after.lastShot,tick:animation.tick},time:now,viewportTop:0,displayScale:canvas.clientWidth/1000});
  if(fraction<1){requestAnimationFrame(render);return;}
  practice=current;animation=null;fireButton.disabled=false;
 }else drawBattle(canvas,current,{aims:aims(),time:now,viewportTop:0,displayScale:canvas.clientWidth/1000});
}
function freshReady(){
 const ready=createGame({seed:123456,terrainType:'hilly'});
 ready.terrain=practice.terrain.slice();ready.mines=JSON.parse(JSON.stringify(practice.mines));
 for(const tank of ready.tanks){
  tank.y=Math.round(Math.min(groundAt(ready,tank.x-12),groundAt(ready,tank.x),groundAt(ready,tank.x+12))*100)/100;
 }
 const id=selected().id;
 ready.tanks[0].inventory=[id,...ready.tanks[0].inventory.filter(w=>w!==id)].slice(0,10);
 return ready;
}
function fire(){
 if(animation)return;
 const before=freshReady();
 try{
  const after=applyAction(before,{type:'fire',weaponId:selected().id,angle:Number($('angle').value),power:Number($('power').value)});
  practice=after;
  fireButton.disabled=true;
  const gain=after.lastShot.scoreGain[0];
  $('status').textContent=`${selected().name} fired. ${gain} practice points on the target.`;
  const duration=Math.max(900,Math.min(4200,after.lastShot.duration*1000/30));
  animation={before,after,start:performance.now(),duration,tick:0};requestAnimationFrame(render);
 }catch(error){$('status').textContent=error.message;fireButton.disabled=false;}
}
fireButton.addEventListener('click',fire);
$('reset').addEventListener('click',()=>{
 animation=null;practice=createGame({seed:123456,terrainType:'hilly'});
 fireButton.disabled=false;$('status').textContent='Terrain reset.';render();
});
weaponSelect.addEventListener('change',()=>{info();if(!animation)render();});
for(const kind of ['angle','power'])$(kind).addEventListener('input',()=>{
 $(kind+'Out').textContent=$(kind).value+(kind==='angle'?'°':'%');
 if(!animation)render();
});
window.addEventListener('resize',()=>{if(!animation)render();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&animation){
 practice=animation.after;animation=null;fireButton.disabled=false;
}});
info();render();
