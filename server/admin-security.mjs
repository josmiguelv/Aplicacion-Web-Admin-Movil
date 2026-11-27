// Secure default headers for the admin application and API responses.
export function applySecurityHeaders(res) {
 res.setHeader('X-Content-Type-Options','nosniff')
 res.setHeader('Referrer-Policy','strict-origin-when-cross-origin')
 res.setHeader('X-Frame-Options','DENY')
 res.setHeader('Permissions-Policy','camera=(), microphone=(), payment=()')
 res.setHeader('Cross-Origin-Resource-Policy','cross-origin')
}
// Local per-process throttle: not a substitute for a shared gateway limiter.
const attempts = new Map()
export function limitAdminLogin({address, email, now=Date.now()}) {
 if(attempts.size>10000)attempts.clear()
 const ip=String(address||'unknown').slice(0,128)
 const key=ip+'|'+String(email||'').trim().toLowerCase().slice(0,254)
 const bucket=attempts.get(key)
 if(!bucket||now-bucket.start>=60000){
  attempts.set(key,{start:now,count:1})
  return true
 }
 bucket.count++
 return bucket.count<=8
}
