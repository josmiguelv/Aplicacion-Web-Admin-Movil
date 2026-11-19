// Carga el .env privado solo en instalaciones locales. Los valores definidos
// por el proceso (por ejemplo .local/services.ps1) conservan prioridad.
import {existsSync} from 'node:fs'
import {loadEnvFile} from 'node:process'
import {fileURLToPath} from 'node:url'

export const defaultLocalEnvPath=fileURLToPath(new URL('../.env',import.meta.url))

export function loadLocalEnv({file=defaultLocalEnvPath,environment=process.env.NODE_ENV}={}){
 if(environment==='production')return {loaded:false,reason:'production'}
 if(!existsSync(file))return {loaded:false,reason:'missing'}
 loadEnvFile(file)
 return {loaded:true,reason:'local'}
}
