import pg from 'pg'
import {hashPassword} from './auth.mjs'
const {DATABASE_URL,BOOTSTRAP_EMAIL,BOOTSTRAP_PASSWORD}=process.env
if(!DATABASE_URL||!BOOTSTRAP_EMAIL||!BOOTSTRAP_PASSWORD)throw Error('DATABASE_URL/BOOTSTRAP_EMAIL/BOOTSTRAP_PASSWORD required')
const pool=new pg.Pool({connectionString:DATABASE_URL})
try{
 const count=await pool.query('SELECT count(*)::int AS n FROM admin_users')
 if(count.rows[0].n!==0)throw Error('BOOTSTRAP_DENIED: administrator already exists')
 await pool.query('INSERT INTO admin_users(email,password_hash,is_super) VALUES(lower($1),$2,true)',[
  BOOTSTRAP_EMAIL.trim(),await hashPassword(BOOTSTRAP_PASSWORD)
 ])
 console.log('Superadministrator provisioned once; remove bootstrap environment variables.')
}finally{await pool.end()}
