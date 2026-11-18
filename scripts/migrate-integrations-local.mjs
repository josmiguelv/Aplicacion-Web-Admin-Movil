import pg from 'pg'
import {readFile} from 'node:fs/promises'
const url=new URL(process.env.DATABASE_URL)
if(url.hostname!=='127.0.0.1'||url.port!=='55432'||url.pathname!=='/integra_admin')throw Error('Only the authorized local integra_admin database is permitted')
const client=new pg.Client({connectionString:url.href});await client.connect()
try{await client.query(await readFile(new URL('../server/migrations/003-tuverso-integrations.sql',import.meta.url),'utf8'));console.log('003: local integration migration applied; existing data preserved')}
finally{await client.end()}
