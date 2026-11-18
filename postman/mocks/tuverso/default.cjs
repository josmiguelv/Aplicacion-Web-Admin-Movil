// Local simulation only. No real tokens; no token/header/body logging.
const {createServer}=require('node:http');
let scenario='AVAILABLE',calls=[];
createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost');
 const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
 if(u.pathname==='/__control'&&req.method==='POST'){
  let raw='';if(req.body===undefined)for await(const chunk of req){raw+=chunk;if(raw.length>1024)return json(413,{error:'too_large'})}
  try{scenario=(req.body===undefined?JSON.parse(raw):typeof req.body==='string'?JSON.parse(req.body):req.body).scenario;return json(200,{ok:true})}catch{return json(400,{error:'invalid_json'})}
 }
 if(u.pathname==='/__stats')return json(200,{calls});
 if(u.pathname!=='/api/v1/queues/availability'||req.method!=='GET')return json(501,{error:'not_modelled'});
 const keys=[...u.searchParams.keys()].sort();
 const correct=keys.length===2&&keys[0]==='externalLocationId'&&keys[1]==='purpose'&&!!u.searchParams.get('externalLocationId')&&/^[A-Z][A-Z0-9_]*$/.test(u.searchParams.get('purpose'))&&!req.headers.origin&&!req.headers.cookie&&/^Bearer tvi_v1_/.test(req.headers.authorization||'');
 calls.push({method:req.method,path:u.pathname,queryKeys:keys,correct,scenario});
 if(!correct)return json(400,{error:'contract_violation'});
 if(Number.isInteger(scenario))return json(scenario,{error:'simulated_upstream_error'});
 if(scenario==='REDIRECT'){res.writeHead(302,{Location:'https://example.invalid/never-follow'});return res.end()}
 if(scenario==='SLOW')return setTimeout(()=>json(200,{data:{}}),7000);
 if(scenario==='MALFORMED')return json(200,{data:{status:'AVAILABLE'}});
 return json(200,{data:{externalLocationId:scenario==='WRONG_LOCATION'?'other-location':u.searchParams.get('externalLocationId'),status:scenario==='UNAVAILABLE'?'UNAVAILABLE':'AVAILABLE',reservation:false,checkedAt:new Date().toISOString(),ignoredPrivateField:'must-not-be-forwarded'}});
}).listen(Number(process.env.PORT||4410),'127.0.0.1');
