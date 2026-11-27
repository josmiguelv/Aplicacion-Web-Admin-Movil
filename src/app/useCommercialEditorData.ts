import {useEffect,useState,type Dispatch,type SetStateAction} from 'react'

export type ProductRow = {id:string;name:string;description:string;category:string;price_pen:number;image_url:string|null;active:boolean}
export type VacancyRow = {id:string;title:string;summary:string;description:string;requirements:string;employment_type:string;location_label:string;store_ids:string[];image_url:string|null;whatsapp_phone:string;active:boolean}

type View = 'products'|'promotions'|'vacancies'|string
type Params = {tenantId:string;enabled:boolean;view:View;reload:number;setError:Dispatch<SetStateAction<string>>}
async function readList<T>(tenantId:string,resource:'products'|'vacancies'){
 const response=await fetch(`/api/admin/tenants/${tenantId}/${resource}`,{credentials:'include',cache:'no-store'})
 const data=await response.json().catch(()=>({error:'Respuesta inválida'}))
 if(!response.ok)throw Error(data.error||`HTTP ${response.status}`)
 return data as {items:T[]}
}

export function useCommercialEditorData({tenantId,enabled,view,reload,setError}:Params){
 const [productResult,setProductResult]=useState<{tenantId:string;items:ProductRow[]}>({tenantId:'',items:[]})
 const [vacancyResult,setVacancyResult]=useState<{tenantId:string;items:VacancyRow[]}>({tenantId:'',items:[]})
 useEffect(()=>{
  if(!enabled||!tenantId||!['products','promotions','vacancies'].includes(view))return
  let active=true
  if(view==='vacancies'){
   void readList<VacancyRow>(tenantId,'vacancies')
    .then(result=>{if(active)setVacancyResult({tenantId,items:result.items})})
    .catch(error=>{if(active)setError('No se pudieron cargar las vacantes: '+(error instanceof Error?error.message:'Error desconocido'))})
  }else{
   void readList<ProductRow>(tenantId,'products')
    .then(result=>{if(active)setProductResult({tenantId,items:result.items})})
    .catch(error=>{if(active)setError('No se pudieron cargar los productos: '+(error instanceof Error?error.message:'Error desconocido'))})
  }
  return ()=>{active=false}
 },[tenantId,enabled,view,reload,setError])
 return {
  products:productResult.tenantId===tenantId?productResult.items:[],
  vacancies:vacancyResult.tenantId===tenantId?vacancyResult.items:[]
 }
}
