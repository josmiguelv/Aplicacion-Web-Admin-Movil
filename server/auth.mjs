import {randomBytes,scrypt as scryptCallback,timingSafeEqual,createHash} from 'node:crypto'
import {promisify} from 'node:util'
const scrypt=promisify(scryptCallback)
export async function hashPassword(password){
 if(typeof password!=='string'||password.length<14||password.length>256)throw Error('PASSWORD_POLICY')
 const salt=randomBytes(16).toString('hex')
 const hash=(await scrypt(password,salt,64)).toString('hex')
 return 'scrypt$'+salt+'$'+hash
}
export async function verifyPassword(password,encoded){
 try{
  if(typeof password!=='string'||password.length>256)return false
  const [algorithm,salt,stored]=encoded.split('$')
  if(algorithm!=='scrypt'||!salt||!stored)return false
  const actual=await scrypt(password,salt,64),expected=Buffer.from(stored,'hex')
  return expected.length===actual.length&&timingSafeEqual(actual,expected)
 }catch{return false}
}
export function newSessionToken(){return randomBytes(32).toString('hex')}
export function hashToken(token){return createHash('sha256').update(token).digest('hex')}
export function readCookie(req,name){
 const all=(req.headers.cookie??'').split(';')
 for(const field of all){const [key,...rest]=field.trim().split('=');if(key===name)return rest.join('=')}
 return ''
}
export function sessionCookie(token,secure){
 return 'b3_session='+token+'; HttpOnly; SameSite=Strict; Path=/api; Max-Age=43200'+(secure?'; Secure':'')
}
