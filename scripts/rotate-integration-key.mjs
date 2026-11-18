import pg from 'pg'
import {pathToFileURL} from 'node:url'
import {masterKey,decryptCredential,encryptCredential} from '../server/integration-crypto.mjs'
export async function rotateIntegrationKey(client,previousKey,currentKey){
 if(previousKey.equals(currentKey))throw Error('Previous and current keys must differ')
 await client.query('BEGIN')
 try{
  const rows=await client.query('SELECT id,tenant_id,encrypted_credential FROM tenant_integrations WHERE encrypted_credential IS NOT NULL FOR UPDATE')
  for(const row of rows.rows){
   const envelope=encryptCredential(decryptCredential(row.encrypted_credential,row.tenant_id,row.id,previousKey),row.tenant_id,row.id,currentKey)
   await client.query('UPDATE tenant_integrations SET encrypted_credential=$2,updated_at=now() WHERE id=$1',[row.id,envelope])
   await client.query("INSERT INTO admin_audit(tenant_id,action,target_id) VALUES($1,'TUVERSO_MASTER_KEY_ROTATED',$2)",[row.tenant_id,row.id])
  }
  await client.query('COMMIT');return rows.rowCount
 }catch{await client.query('ROLLBACK');throw Error('Key rotation failed; transaction rolled back. Check private keys without logging them.')}
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const u=new URL(process.env.DATABASE_URL)
 if(u.hostname!=='127.0.0.1'||u.port!=='55432'||u.pathname!=='/integra_admin')throw Error('This command only permits the authorized local database')
 const previous=masterKey(process.env.INTEGRATION_PREVIOUS_MASTER_KEY),current=masterKey()
 const client=new pg.Client({connectionString:u.href});await client.connect()
 try{console.log('Credentials re-encrypted:',await rotateIntegrationKey(client,previous,current))}finally{await client.end()}
}
