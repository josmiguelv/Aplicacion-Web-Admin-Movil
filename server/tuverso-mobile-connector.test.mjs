import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {test} from 'node:test'
import {createMobileInteraction,readMobileInteraction,pollMobileInteractionEvents,
 sendMobileInteractionMessage,mobileInteractionMode} from './tuverso-mobile-connector.mjs'
const token='tuverso_'+'a'.repeat(64)
const binding={external_location_id:'sede-b3-001',purpose:'ORDER_REQUEST'}
const input={customerExternalId:'cliente-externo-123',externalReference:'pedido-externo-789',
 summary:'Consulta de pedido sin datos de pago',idempotencyKey:randomUUID()}
const xid=randomUUID()
const remote={interactionId:xid,externalReference:input.externalReference,
 externalLocationId:binding.external_location_id,purpose:binding.purpose,
 status:'PENDING',estimatedMinutes:null,decisionReason:null}
const ok=(data,status=201)=>new Response(JSON.stringify({data}),{
 status,headers:{'Content-Type':'application/json'}})
const withFetch=async(fn,cb)=>{
 const original=globalThis.fetch
 globalThis.fetch=fn
 try{return await cb()}finally{globalThis.fetch=original}
}
test('feature flag disables all external request calls without touching network',async()=>{
 const old=process.env.TUVERSO_LIVE_REQUESTS_ENABLED
 delete process.env.TUVERSO_LIVE_REQUESTS_ENABLED
 try{
  assert.equal(mobileInteractionMode(),'DISABLED')
  await withFetch(()=>{throw Error('MUST NOT CALL')},async()=>{
   const result=await createMobileInteraction(token,binding,input)
   assert.equal(result.ok,false);assert.equal(result.errorCode,'REQUESTS_DISABLED')
  })
 }finally{if(old===undefined)delete process.env.TUVERSO_LIVE_REQUESTS_ENABLED;else process.env.TUVERSO_LIVE_REQUESTS_ENABLED=old}
})
test('S2S create sends exact authorized location, scoped bearer and stable idempotency; never returns bearer',async()=>{
 const oldFlag=process.env.TUVERSO_LIVE_REQUESTS_ENABLED,oldMode=process.env.NODE_ENV
 const oldTarget=process.env.TUVERSO_INTERACTIONS_TEST_URL
 process.env.NODE_ENV='test'
 process.env.TUVERSO_LIVE_REQUESTS_ENABLED='true'
 process.env.TUVERSO_INTERACTIONS_TEST_URL='http://127.0.0.1/tuverso'
 try{
  let called=0
  const fetcher=async(url,options)=>{
   called++
   assert.equal(String(url),'http://127.0.0.1/tuverso/api/v1/interactions')
   assert.equal(options.method,'POST')
   assert.equal(options.redirect,'error')
   assert.equal(options.headers.Authorization,'Bearer '+token)
   assert.equal(options.headers['Idempotency-Key'],input.idempotencyKey)
   assert.equal(options.headers.Cookie,undefined)
   assert.equal(options.headers.Origin,undefined)
   assert.deepEqual(JSON.parse(options.body),{
    externalLocationId:binding.external_location_id,purpose:'ORDER_REQUEST',
    customerExternalId:input.customerExternalId,externalReference:input.externalReference,
    summary:input.summary,
   })
   return ok(remote)
  }
  await withFetch(fetcher,async()=>{
   const result=await createMobileInteraction(token,binding,input)
   assert.equal(result.ok,true)
   assert.equal(result.httpStatus,201)
   assert.deepEqual(result.data,remote)
   assert.equal(JSON.stringify(result).includes(token),false)
  })
  assert.equal(called,1)
  await withFetch(()=>ok({malicious:true}),async()=>{
   const result=await createMobileInteraction(token,binding,input)
   assert.equal(result.errorCode,'INVALID_RESPONSE')
  })
  await withFetch(()=>new Response('Bearer '+token,{status:401}),async()=>{
   const result=await createMobileInteraction(token,binding,input)
   assert.equal(result.httpStatus,401);assert.equal(result.errorCode,'UPSTREAM_401')
   assert.equal(JSON.stringify(result).includes(token),false)
  })
  await withFetch(()=>new Response('x'.repeat(17000),{status:201}),async()=>{
   const result=await createMobileInteraction(token,binding,input)
   assert.equal(result.errorCode,'CONNECTION_FAILED')
  })
 }finally{
  if(oldFlag===undefined)delete process.env.TUVERSO_LIVE_REQUESTS_ENABLED;else process.env.TUVERSO_LIVE_REQUESTS_ENABLED=oldFlag
  if(oldMode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=oldMode
  if(oldTarget===undefined)delete process.env.TUVERSO_INTERACTIONS_TEST_URL;else process.env.TUVERSO_INTERACTIONS_TEST_URL=oldTarget
 }
})
test('unapproved data, other-provider credentials and invalid ids fail before any call',async()=>{
 for(const changes of [
  {idempotencyKey:'not-a-uuid'},{summary:''},{customerExternalId:'bad\nline'},
  {externalReference:'x'.repeat(181)},{tenantId:'attacker'},
 ])await assert.rejects(()=>createMobileInteraction(token,binding,{...input,...changes}))
 await assert.rejects(()=>createMobileInteraction(token,{...binding,purpose:'INVALID PURPOSE'},input))
 await assert.rejects(()=>readMobileInteraction(token,'../etc/passwd'))
 await assert.rejects(()=>pollMobileInteractionEvents(token,{after:'invalid'}))
 await assert.rejects(()=>sendMobileInteractionMessage(token,xid,{idempotencyKey:randomUUID(),text:''}))
})
test('polling and replies are private, fixed-route and validate response shape',async()=>{
 const old=process.env.TUVERSO_LIVE_REQUESTS_ENABLED
 process.env.TUVERSO_LIVE_REQUESTS_ENABLED='true'
 try{
  await withFetch(async(url,options)=>{
   assert.equal(String(url),'https://api.tuverso.integra-b2g.com/api/v1/interactions/events?limit=25')
   assert.equal(options.method,'GET')
   return ok({events:[{id:randomUUID(),interactionId:xid,kind:'REQUEST_ACCEPTED',createdAt:new Date().toISOString()}],
    nextCursor:null,hasMore:false},200)
  },async()=>{assert.equal((await pollMobileInteractionEvents(token,{limit:25})).data.events.length,1)})
  await withFetch(async(url,opts)=>{
   assert.equal(String(url),'https://api.tuverso.integra-b2g.com/api/v1/conversations/'+xid+'/messages')
   assert.equal(opts.method,'POST');return ok({created:true,messageId:randomUUID()})
  },async()=>{assert.equal((await sendMobileInteractionMessage(token,xid,{idempotencyKey:randomUUID(),text:'Hola'})).ok,true)})
 }finally{if(old===undefined)delete process.env.TUVERSO_LIVE_REQUESTS_ENABLED;else process.env.TUVERSO_LIVE_REQUESTS_ENABLED=old}
})

test('Pollos B3 multiline order detail preserves line breaks without allowing unsafe controls',async()=>{
 const previous={
  mode:process.env.NODE_ENV,
  enabled:process.env.TUVERSO_LIVE_REQUESTS_ENABLED,
  target:process.env.TUVERSO_INTERACTIONS_TEST_URL
 };
 process.env.NODE_ENV='test';
 process.env.TUVERSO_LIVE_REQUESTS_ENABLED='true';
 process.env.TUVERSO_INTERACTIONS_TEST_URL='http://127.0.0.1/tuverso';
 const detail=[
  'POLLOS B3 - SOLICITUD DE VALIDACION',
  'Sede consultada: Nogales',
  'PRODUCTOS: Un producto del catálogo',
  'Subtotal productos: S/ 13.00',
  'Verificar productos y responder SOLO: aceptado o rechazado.'
 ].join('\n');
 try{
  let calls=0;
  await withFetch(async(url,options)=>{
   calls++;
   assert.equal(String(url),'http://127.0.0.1/tuverso/api/v1/conversations/'+xid+'/messages');
   assert.equal(options.method,'POST');
   assert.equal(options.headers.Authorization,'Bearer '+token);
   assert.equal(JSON.parse(options.body).text,detail);
   assert.equal(options.headers['Idempotency-Key'].length,36);
   return ok({created:true,messageId:randomUUID()},201);
  },async()=>{
   const key=randomUUID();
   const result=await sendMobileInteractionMessage(token,xid,{idempotencyKey:key,text:detail});
   assert.equal(result.ok,true);
   assert.equal(result.httpStatus,201);
   assert.ok(result.data.messageId);
  });
  assert.equal(calls,1);
  for(const text of ['Uno\rDos','Uno\tDos','Uno\0Dos','']) {
   await assert.rejects(()=>sendMobileInteractionMessage(token,xid,{idempotencyKey:randomUUID(),text}));
  }
 }finally{
  for(const [key,name] of [['mode','NODE_ENV'],['enabled','TUVERSO_LIVE_REQUESTS_ENABLED'],
   ['target','TUVERSO_INTERACTIONS_TEST_URL']]){
   if(previous[key]===undefined)delete process.env[name];
   else process.env[name]=previous[key];
  }
 }
});
