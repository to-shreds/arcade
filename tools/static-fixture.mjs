import { createServer } from 'node:http';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveStaticFile } from './static-response.mjs';
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.webmanifest':'application/manifest+json','.wasm':'application/wasm'};
export async function startStaticFixture(){
  if(process.env.ARCADE_AUDIT_URL)return {base:process.env.ARCADE_AUDIT_URL,close:async()=>{}};
  const server=createServer(async(req,res)=>{
    try{
      let path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
      if(path!==root&&!path.startsWith(root+sep)){res.writeHead(403);res.end();return;}
      if((await stat(path)).isDirectory())path=resolve(path,'index.html');
      await serveStaticFile(req,res,path,types[extname(path)]||({'.mp4':'video/mp4','.webm':'video/webm'}[extname(path)])||'application/octet-stream');
    }catch{res.writeHead(404);res.end('Not found');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {base:`http://127.0.0.1:${server.address().port}`,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
