import pg from 'pg'
import {scryptSync,randomBytes} from 'node:crypto'
const {DATABASE_URL,BOOTSTRAP_ADMIN_EMAIL,BOOTSTRAP_ADMIN_PASSWORD}=process.env
if(!DATABASE_URL||!BOOTSTRAP_ADMIN_EMAIL||!BOOTSTRAP_ADMIN_PASSWORD||BOOTSTRAP_ADMIN_PASSWORD.length<14)throw Error('Set DATABASE_URL, BOOTSTRAP_ADMIN_EMAIL and strong 14+ character BOOTSTRAP_ADMIN_PASSWORD')
const pool=new pg.Pool({connectionString:DATABASE_URL})
const salt=randomBytes(16).toString('hex')
const hash=`scrypt:${salt}:${scryptSync(BOOTSTRAP_ADMIN_PASSWORD,salt,64).toString('hex')}`
const result=await pool.query(`INSERT INTO admin_users(email,password_hash,role) VALUES(lower($1),$2,'SUPER_ADMIN') ON CONFLICT(email) DO NOTHING RETURNING id`,[BOOTSTRAP_ADMIN_EMAIL,hash])
console.log(result.rowCount?'Super administrator created.':'Account already exists; no changes made.')
await pool.end()