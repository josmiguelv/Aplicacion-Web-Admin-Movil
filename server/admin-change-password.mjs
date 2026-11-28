import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto'

// Self-service only: the currently authenticated account may change its own password.
// All existing sessions are invalidated after commit, including the caller's.
const err=(code,message)=>Object.assign(new Error(message),{code})
export function verifyAdminPassword(password,stored){
 if(typeof password!=='string'||typeof stored!=='string')return false
 const parts=stored.split(':')
 if(parts.length!==3||parts[0]!=='scrypt'||!/^[a-f0-9]{32}$/i.test(parts[1])||!/^[a-f0-9]{128}$/i.test(parts[2]))return false
 const candidate=scryptSync(password,parts[1],64),expected=Buffer.from(parts[2],'hex')
 return timingSafeEqual(candidate,expected)
}
export function hashAdminPassword(password){
 const salt=randomBytes(16).toString('hex')
 return 'scrypt:'+salt+':'+scryptSync(password,salt,64).toString('hex')
}
export function validatePasswordChange(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||
  Object.keys(body).sort().join(',')!=='currentPassword,newPassword')throw err(400,'Datos de contraseña inválidos')
 const {currentPassword,newPassword}=body
 if(typeof currentPassword!=='string'||currentPassword.length<1||currentPassword.length>512)throw err(400,'Contraseña actual inválida')
 if(typeof newPassword!=='string'||newPassword.length<14||newPassword.length>128||
    /[\x00-\x1f\x7f]/.test(newPassword))throw err(400,'La nueva contraseña debe tener entre 14 y 128 caracteres y no contener caracteres de control')
 if(currentPassword===newPassword)throw err(400,'La contraseña nueva debe ser diferente de la actual')
 return {currentPassword,newPassword}
}
export async function changeOwnPassword({pool,userId,input}){
 const {currentPassword,newPassword}=validatePasswordChange(input)
 const client=await pool.connect()
 let inTransaction=false
 try{
  await client.query('BEGIN')
  inTransaction=true
  const found=await client.query('SELECT password_hash FROM admin_users WHERE id=$1 AND active=true FOR UPDATE',[userId])
  if(found.rowCount!==1)throw err(401,'La cuenta ya no está activa')
  if(!verifyAdminPassword(currentPassword,found.rows[0].password_hash))throw err(403,'La contraseña actual no es correcta')
  if(verifyAdminPassword(newPassword,found.rows[0].password_hash))throw err(400,'La contraseña nueva debe ser diferente de la actual')
  const nextHash=hashAdminPassword(newPassword)
  await client.query('UPDATE admin_users SET password_hash=$1 WHERE id=$2 AND active=true',[nextHash,userId])
  await client.query('DELETE FROM admin_sessions WHERE user_id=$1',[userId])
  await client.query('COMMIT')
  inTransaction=false
  return {ok:true,requiresLogin:true}
 }catch(error){
  if(inTransaction)await client.query('ROLLBACK').catch(()=>{})
  throw error
 }finally{client.release()}
}
