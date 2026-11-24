// Receipt images are referenced by URL; this backend never fetches them.
// Reject internal endpoints and credentials to avoid forwarding private network references.
export function validReceiptImageUrl(value){
 if(typeof value!=='string'||value.length>2048||!value||/[\x00-\x20\x7f]/.test(value))return false
 let url
 try{url=new URL(value)}catch{return false}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!url.hostname||!url.hostname.includes('.'))return false
 const host=url.hostname.toLowerCase().replace(/\.$/,'')
 if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||
    host.endsWith('.internal')||host.endsWith('.test')||host.endsWith('.example')||
    /^\d+(?:\.\d+){3}$/.test(host)||host.includes(':')||host.includes('..'))return false
 return true
}
