// Diagnóstico seguro en PC del administrador: nunca imprime rutas, claves ni tokens.
import {readFile} from 'node:fs/promises'
import {createPrivateKey} from 'node:crypto'
import {loadLocalEnv} from './load-local-env.mjs'
import {pushConfig} from './fcm-push.mjs'

async function main(){
 const envResult=loadLocalEnv()
 console.log('Configuración local: '+(envResult.loaded?'archivo .env cargado':envResult.reason==='production'?'producción: usa variables del proceso':'no se encontró .env'))
 const cfg=pushConfig({...process.env,FCM_ENABLED:'true'})
 console.log('Proyecto Firebase: '+(cfg.projectId==='pollosb3-84297'?'OK':'REVISAR'))
 console.log('Aplicación Android: '+(cfg.appId==='com.integrab2g.pollosb3'?'OK':'REVISAR'))
 console.log('Tema de promociones: '+(cfg.topic==='pollosb3_promotions'?'OK':'REVISAR'))
 if(cfg.projectId!=='pollosb3-84297'||cfg.appId!=='com.integrab2g.pollosb3'||cfg.topic!=='pollosb3_promotions')
  throw Error('El proyecto, aplicación o tema no coinciden con Pollos B3')
 let raw
 if(process.env.FCM_SERVICE_ACCOUNT_JSON)raw=process.env.FCM_SERVICE_ACCOUNT_JSON
 else if(process.env.GOOGLE_APPLICATION_CREDENTIALS){
  try{raw=await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS,'utf8')}
  catch{throw Error('No se puede leer el archivo privado de cuenta de servicio desde Node.js')}
 }else throw Error('Falta GOOGLE_APPLICATION_CREDENTIALS o FCM_SERVICE_ACCOUNT_JSON')
 let credentials
 try{credentials=JSON.parse(raw)}catch{throw Error('La cuenta de servicio no contiene JSON válido')}
 if(credentials.type!=='service_account'||credentials.project_id!==cfg.projectId||
   typeof credentials.client_email!=='string'||!credentials.client_email.endsWith('.iam.gserviceaccount.com'))
  throw Error('Credencial incorrecta: no corresponde a la cuenta de servicio Firebase del proyecto')
 try{createPrivateKey(credentials.private_key)}catch{throw Error('La clave privada de la cuenta de servicio no es válida')}
 console.log('Cuenta de servicio privada: OK')
 let status
 try{
  const response=await fetch(cfg.origin+'/health/live',{signal:AbortSignal.timeout(8000)})
  const data=await response.json().catch(()=>({}))
  status=response.status===200&&data.status==='ok'
 }catch{status=false}
 if(!status)throw Error('La API no responde por HTTPS en FCM_PUBLIC_BASE_URL (/health/live)')
 console.log('API pública HTTPS: OK')
 console.log('FCM_ENABLED: '+(process.env.FCM_ENABLED==='true'?'ACTIVADO':'DESACTIVADO (activar al terminar las comprobaciones)'))
 console.log('PREFLIGHT: PASS (sin enviar notificaciones reales)')
}
main().catch(e=>{console.error('PREFLIGHT: NO LISTO - '+String(e?.message||'Error de configuración'));process.exitCode=1})
