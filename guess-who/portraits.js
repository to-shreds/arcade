import { characterById } from '../multiplayer/models/guess-who-data.js';
const HAIR = {black:'#202238',brown:'#77452f',blonde:'#f5d46b',red:'#d96736',silver:'#c2ccdd',none:'#302837'};
const SHIRT = {blue:'#4678ec',red:'#e85e73',green:'#3fa779',gold:'#edbb43'};
const SKIN = ['#f3c6a3','#dca778','#b87e58','#805239'];
/* All input resolves through the fixed roster; no player text enters the SVG. */
export function portrait(id) {
  const c = characterById(id); if (!c) return '';
  const h=HAIR[c.hair], s=SKIN[c.skin], shirt=SHIRT[c.shirt];
  let back='';
  if(c.style==='long') back=`<path d="M22 44Q18 13 50 12Q82 13 78 44L82 91H18Z" fill="${h}"/>`;
  if(c.style==='curly') back=`<path d="M23 61Q10 55 18 44Q10 31 22 25Q21 12 34 13Q40 4 50 12Q63 3 68 14Q84 10 81 26Q94 35 83 44Q93 59 77 64Z" fill="${h}"/>`;
  let hair='';
  if(c.style==='short') hair=`<path d="M24 44V31Q24 12 50 13Q77 10 77 34L76 45L69 33Q53 38 35 28L30 45Z" fill="${h}"/>`;
  if(c.style==='long') hair=`<path d="M22 50V31Q23 10 50 12Q80 12 78 46L71 50L70 30Q54 35 43 23Q34 37 30 52Z" fill="${h}"/>`;
  if(c.style==='curly') hair=`<g fill="${h}"><circle cx="29" cy="29" r="12"/><circle cx="44" cy="23" r="12"/><circle cx="60" cy="24" r="12"/><circle cx="73" cy="32" r="11"/></g>`;
  let extras='';
  if(c.glasses) extras+='<g fill="none" stroke="#28293e" stroke-width="3.2"><rect x="28" y="42" width="19" height="15" rx="5"/><rect x="53" y="42" width="19" height="15" rx="5"/><path d="M47 48H53M23 46L28 47M72 47L77 46"/></g>';
  if(c.freckles) extras+='<g fill="#ad593f"><circle cx="31" cy="60" r="1.4"/><circle cx="36" cy="62" r="1.4"/><circle cx="40" cy="59" r="1.4"/><circle cx="60" cy="59" r="1.4"/><circle cx="65" cy="62" r="1.4"/><circle cx="69" cy="60" r="1.4"/></g>';
  if(c.facial==='beard') extras+=`<path d="M27 63Q32 74 50 73Q67 75 74 62L72 76Q51 95 30 77Z" fill="${h}"/><path d="M42 75Q50 79 58 75" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>`;
  if(c.facial==='mustache') extras+=`<path d="M50 64Q40 56 34 68Q43 73 50 67Q58 73 66 68Q60 56 50 64Z" fill="${h}"/>`;
  if(c.earrings) extras+='<g fill="none" stroke="#ffdf62" stroke-width="3"><circle cx="24" cy="61" r="4.3"/><circle cx="77" cy="61" r="4.3"/></g>';
  if(c.hat==='cap') extras+='<path d="M21 29Q23 6 50 7Q77 9 79 29Z" fill="#517cf5"/><path d="M20 28H83Q95 28 88 33H20Z" fill="#304da4"/><path d="M49 10V25" stroke="#92b1ff" stroke-width="2"/>';
  if(c.hat==='beanie') extras+='<circle cx="50" cy="9" r="6" fill="#fc80d5"/><path d="M23 29Q24 6 50 7Q77 7 77 29Z" fill="#bc50ad"/><path d="M24 27H76V36H24Z" fill="#f980d2"/><path d="M32 28V35M40 28V35M48 28V35M56 28V35M64 28V35" stroke="#bd53a8" stroke-width="2"/>';
  return `<svg viewBox="0 0 100 106" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><rect width="100" height="106" rx="12" fill="${shirt}" opacity=".12"/>${back}<path d="M13 106Q13 83 40 81H60Q87 83 87 106" fill="${shirt}"/><path d="M41 74H59V88Q50 96 41 88Z" fill="${s}"/><path d="M41 79Q50 85 59 79V84Q50 90 41 84Z" fill="#000" opacity=".08"/><ellipse cx="24" cy="51" rx="6" ry="9" fill="${s}"/><ellipse cx="76" cy="51" rx="6" ry="9" fill="${s}"/><path d="M25 36Q25 17 50 17Q75 17 75 36V57Q74 81 50 82Q26 81 25 57Z" fill="${s}"/>${hair}<g stroke="#3c2d2a" stroke-width="2" stroke-linecap="round"><path d="M33 40L41 39M59 39L67 40"/><path d="M49 52L47 60H51" opacity=".35"/><path d="M41 68Q50 75 59 68" fill="none"/></g><ellipse cx="37" cy="49" rx="2.3" ry="3" fill="#292535"/><ellipse cx="63" cy="49" rx="2.3" ry="3" fill="#292535"/>${extras}</svg>`;
}
