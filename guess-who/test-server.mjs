// Local browser-test fixture. Uses the actual Worker and Durable Object, not a mock room.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from '../cloudflare/chess-worker/node_modules/miniflare/dist/src/index.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const mf=new Miniflare({modulesRoot:root,modules:['cloudflare/chess-worker/src/index.js','multiplayer/models/room-model.js','multiplayer/models/generic-room-model.js','multiplayer/models/guess-who-authority.js','multiplayer/models/guess-who-data.js','multiplayer/models/chess-engine.js'].map(path=>({type:'ESModule',path:resolve(root,path)})),compatibilityDate:'2026-08-06',compatibilityFlags:['nodejs_compat'],port:8788,host:'127.0.0.1',bindings:{ALLOWED_ORIGINS:'http://127.0.0.1:8787,http://localhost:8787'},durableObjects:{ARCADE_ROOMS:{className:'ArcadeRoom',useSQLite:true}}});
await mf.ready;
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=createServer(async(req,res)=>{
  try {
    let path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if(!path.startsWith(root)||path.includes('/node_modules/')||path.includes('/.git/')){res.writeHead(403);return res.end();}
    if((await stat(path)).isDirectory())path=resolve(path,'index.html');
    res.writeHead(200,{'content-type':types[extname(path)]||'application/octet-stream','cache-control':'no-store'});res.end(await readFile(path));
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(8787,'127.0.0.1',()=>console.log('Guess Who test site http://127.0.0.1:8787; real Worker http://127.0.0.1:8788'));
async function close(){server.close();await mf.dispose();process.exit(0);}
process.on('SIGTERM',close);process.on('SIGINT',close);
