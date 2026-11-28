import {createHash} from 'node:crypto'

// Per-account + per-network caps, tracking FAILED attempts only.
// No database migrations, third-party dependencies, or interference with
// logged-in sessions. A single-server Railway deployment is the target.
export function createAdminLoginLimiter({windowMs=15*60_000,accountLimit=8,networkLimit=40,
 now=()=>Date.now(),maxEntries=10000}={}){
 const account=new Map(),network=new Map()
 const hash=s=>createHash('sha256').update(s).digest('hex')
 function checkBucket(map,key,limit,ts){
  const row=map.get(key)
  return !row||ts-row.since>=windowMs||row.fails<limit
 }
 function failBucket(map,key,ts){
  const old=map.get(key)
  if(!old||ts-old.since>=windowMs)map.set(key,{fails:1,since:ts})
  else old.fails++
 }
 function prune(ts){
  for(const map of [account,network]){
   for(const [key,val] of map)if(ts-val.since>=windowMs)map.delete(key)
   // On overflow we fail closed rather than clearing denial counters.
  }
 }
 function keys(email,networkId){
  return {accountKey:hash(String(email||'').trim().toLowerCase()),
   networkKey:hash(String(networkId||'unknown'))}
 }
 return {
  allowed(email,networkId){
   const ts=now();prune(ts)
   if(account.size>=maxEntries||network.size>=maxEntries)return false
   const {accountKey,networkKey}=keys(email,networkId)
   return checkBucket(account,accountKey,accountLimit,ts)&&checkBucket(network,networkKey,networkLimit,ts)
  },
  failed(email,networkId){
   const ts=now();prune(ts)
   const {accountKey,networkKey}=keys(email,networkId)
   failBucket(account,accountKey,ts)
   failBucket(network,networkKey,ts)
  },
  succeeded(email){
   account.delete(keys(email,'').accountKey)
  }
 }
}
