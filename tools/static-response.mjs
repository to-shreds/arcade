import {readFile} from 'node:fs/promises';

// Browser fixtures serve bundled movies with the same seeking contract as Pages.
export async function serveStaticFile(request,response,file,mime){
  const data=await readFile(file),headers={'content-type':mime,'cache-control':'no-store'};
  if(/^video\//.test(mime)){
    headers['accept-ranges']='bytes';
    if(request.headers.range){
      const match=/^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
      let start=0,end=data.length-1;
      if(match&&(match[1]||match[2])){
        if(!match[1])start=Math.max(0,data.length-Number(match[2]));
        else {start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}
      }
      if(!match||!(match[1]||match[2])||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=data.length){
        response.writeHead(416,{...headers,'content-range':`bytes */${data.length}`});response.end();return;
      }
      const part=data.subarray(start,end+1);
      response.writeHead(206,{...headers,'content-range':`bytes ${start}-${end}/${data.length}`,'content-length':part.length});
      response.end(request.method==='HEAD'?undefined:part);return;
    }
  }
  response.writeHead(200,{...headers,'content-length':data.length});response.end(request.method==='HEAD'?undefined:data);
}
