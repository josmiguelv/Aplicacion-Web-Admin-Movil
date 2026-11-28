import {readFile,realpath,stat} from 'node:fs/promises'
import {resolve,relative,extname,sep} from 'node:path'

const mime={
 '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
 '.css':'text/css; charset=utf-8','.svg':'image/svg+xml',
 '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg',
 '.webp':'image/webp','.ico':'image/x-icon','.woff':'font/woff',
 '.woff2':'font/woff2','.json':'application/json; charset=utf-8'
}
const badPath=()=>Object.assign(new Error('Ruta estática inválida'),{code:403})
const notFound=()=>Object.assign(new Error('Recurso no encontrado'),{code:404})
export async function resolveStaticRequest(baseDir,pathname){
 if(typeof pathname!=='string'||pathname.length>2048)throw badPath()
 let decoded
 try{decoded=decodeURIComponent(pathname)}catch{throw badPath()}
 if(!decoded.startsWith('/')||decoded.startsWith('//')||/[\\\x00-\x1f\x7f]/.test(decoded)||
  decoded.split('/').some(p=>p==='..'||p==='.'||p.startsWith('.'))||
  decoded.includes('%'))throw badPath()
 const root=await realpath(baseDir)
 let path=resolve(root,'.'+(decoded==='/'?'/index.html':decoded))
 const inside=target=>{const rel=relative(root,target);return rel&&!rel.startsWith('..'+sep)&&rel!=='..'&&!resolve(rel).startsWith('..'+sep)}
 if(!inside(path))throw badPath()
 const extension=extname(path).toLowerCase()
 if(extension&&!Object.hasOwn(mime,extension))throw notFound()
 let s
 try{s=await stat(path)}catch{
  // Valid SPA routes (without an extension) fall back to the React shell.
  if(extension)throw notFound()
  path=resolve(root,'index.html')
  s=await stat(path).catch(()=>{throw notFound()})
 }
 if(!s.isFile())throw notFound()
 const real=await realpath(path)
 if(!inside(real))throw badPath()
 const finalExt=extname(path).toLowerCase()
 if(!Object.hasOwn(mime,finalExt))throw notFound()
 return {path:real,mime:mime[finalExt],html:finalExt==='.html'}
}
export async function serveStatic(res,pathname,distDirectory){
 const item=await resolveStaticRequest(distDirectory,pathname)
 const content=await readFile(item.path)
 res.writeHead(200,{'Content-Type':item.mime,'X-Content-Type-Options':'nosniff',
  'Cache-Control':item.html?'no-cache':'public,max-age=300'})
 res.end(content)
}
