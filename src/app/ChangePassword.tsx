import {useState, type FormEvent} from 'react'
import {KeyRound, ShieldCheck} from 'lucide-react'

type Props={onPasswordChanged:()=>void}

export default function ChangePassword({onPasswordChanged}:Props){
 const [currentPassword,setCurrentPassword]=useState('')
 const [newPassword,setNewPassword]=useState('')
 const [confirmPassword,setConfirmPassword]=useState('')
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const valid=newPassword.length>=14&&newPassword.length<=128&&
   !/[\x00-\x1f\x7f]/.test(newPassword)&&newPassword!==currentPassword&&
   newPassword===confirmPassword&&currentPassword.length>0
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault()
  if(!valid||busy)return
  setBusy(true);setError('')
  try{
   const response=await fetch('/api/admin/change-password',{
    method:'POST',credentials:'include',cache:'no-store',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({currentPassword,newPassword}),
   })
   const result=await response.json().catch(()=>({error:'Respuesta inesperada del servidor'}))
   if(!response.ok)throw new Error(result.error||'No se pudo cambiar la contraseña')
   setCurrentPassword('');setNewPassword('');setConfirmPassword('')
   onPasswordChanged()
  }catch(cause){
   setError(cause instanceof Error?cause.message:'No se pudo cambiar la contraseña')
  }finally{setBusy(false)}
 }
 return <main className="portal-content portal-account">
  <div className="portal-title"><div><h1>Mi cuenta</h1><p className="portal-muted">Actualiza tu contraseña de acceso al Administrador Web.</p></div></div>
  <section className="portal-panel portal-account-panel" aria-labelledby="account-security-heading">
   <h2 id="account-security-heading"><ShieldCheck size={19}/> Seguridad de mi cuenta</h2>
   <p className="portal-muted">Para proteger tu cuenta, confirma primero tu contraseña actual. La nueva debe tener entre 14 y 128 caracteres y ser diferente.</p>
   <form className="portal-form portal-account-form" onSubmit={event=>{void submit(event)}}>
    <label>Contraseña actual
     <input type="password" autoComplete="current-password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} maxLength={512} required disabled={busy}/>
    </label>
    <label>Nueva contraseña
     <input type="password" autoComplete="new-password" value={newPassword} onChange={e=>setNewPassword(e.target.value)} minLength={14} maxLength={128} required disabled={busy} aria-describedby="password-guidance"/>
    </label>
    <p id="password-guidance" className="portal-muted portal-password-guidance">Utiliza una contraseña única y extensa. No reutilices tu contraseña anterior.</p>
    <label>Confirmar nueva contraseña
     <input type="password" autoComplete="new-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} minLength={14} maxLength={128} required disabled={busy}/>
    </label>
    {confirmPassword&&newPassword!==confirmPassword&&<p className="portal-error" role="alert">Las contraseñas nuevas no coinciden.</p>}
    {error&&<p className="portal-error" role="alert">{error}</p>}
    <button className="portal-primary portal-account-submit" type="submit" disabled={!valid||busy}>
     <KeyRound size={16}/>{busy?'Actualizando contraseña...':'Cambiar contraseña'}
    </button>
   </form>
   <p className="portal-muted portal-password-guidance">Al guardar, se cerrarán todas las sesiones de esta cuenta, incluida la actual. Deberás iniciar sesión con tu nueva contraseña.</p>
  </section>
 </main>
}
