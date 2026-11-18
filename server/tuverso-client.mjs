export const TUVERSO_BASE='https://api.tuverso.integra-b2g.com'
export const TUVERSO_SCOPES=['queue.availability.read','interactions.create','interactions.read','interactions.events.read','conversations.read','conversations.messages.write']
const simulation=process.env.TUVERSO_SIMULATION_URL
if(simulation){
 const u=new URL(simulation)
 if(process.env.NODE_ENV!=='test'||u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.username||u.password||u.search||u.hash||!/^\/tuverso$/.test(u.pathname))throw Error('Simulation is only allowed on test loopback /tuverso')
}
export const connectionMode=()=>simulation?'SIMULATED':process.env.TUVERSO_LIVE_CHECKS_ENABLED==='true'?'LIVE':'DISABLED'
const messages={401:'Credencial, licencia o scopes rechazados.',403:'Acceso no autorizado.',409:'Conflicto de configuración.',429:'Límite de consultas; espera antes de reintentar.',503:'Servicio o función no habilitada.'}
export async function checkAvailability(token,binding){
 const url=new URL((simulation||TUVERSO_BASE)+'/api/v1/queues/availability')
 url.searchParams.set('externalLocationId',binding.external_location_id);url.searchParams.set('purpose',binding.purpose)
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000)
 try{
  const response=await fetch(url,{method:'GET',headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},redirect:'error',signal:controller.signal})
  const base={httpStatus:response.status,checkedAt:new Date().toISOString(),simulation:!!simulation,bindingId:binding.id}
  if(response.status!==200){await response.body?.cancel();return {...base,result:null,errorCode:'UPSTREAM_'+response.status,message:messages[response.status]||'Respuesta no satisfactoria de TU VERSO.'}}
  // Bound the body; never forward upstream JSON, headers or error messages to clients/logs.
  const reader=response.body?.getReader();let raw='',size=0
  if(!reader)return {...base,result:null,errorCode:'INVALID_RESPONSE',message:'Respuesta 1A inválida.'}
  const chunks=[]
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384){await reader.cancel();throw Error('Oversize response')}chunks.push(value)}
  raw=Buffer.concat(chunks).toString('utf8')
  let data;try{data=JSON.parse(raw).data}catch{}
  if(!data||data.externalLocationId!==binding.external_location_id||!['AVAILABLE','UNAVAILABLE'].includes(data.status)||data.reservation!==false||typeof data.checkedAt!=='string'||!Number.isFinite(Date.parse(data.checkedAt)))return {...base,result:null,errorCode:'INVALID_RESPONSE',message:'Respuesta 1A inválida o sede distinta.'}
  return {...base,result:data.status,reservation:false,providerCheckedAt:new Date(data.checkedAt).toISOString(),errorCode:null,message:data.status==='AVAILABLE'?'Capacidad elegible, sin reserva.':'Consulta autorizada, sin capacidad elegible.'}
 }catch{return {httpStatus:null,result:null,errorCode:'CONNECTION_FAILED',message:'No se pudo comprobar TU VERSO (red, TLS, tiempo o respuesta).',checkedAt:new Date().toISOString(),simulation:!!simulation,bindingId:binding.id}}
 finally{clearTimeout(timer)}
}
