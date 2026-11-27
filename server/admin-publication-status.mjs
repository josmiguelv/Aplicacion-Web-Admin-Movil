// Admin catalogue publication status, read-only and tenant-scoped.
export async function getCatalogPublicationStatus(pool,tenantId,appId){
 const result=await pool.query(`SELECT a.app_id,a.published_revision,
  p.published_at,p.revision,
  EXISTS(
   SELECT 1 FROM admin_audit log
    WHERE log.tenant_id=a.tenant_id
      AND log.action=ANY($3::text[])
      AND (p.published_at IS NULL OR log.created_at>p.published_at)
  ) AS pending
  FROM mobile_apps a
  LEFT JOIN published_catalogs p ON p.app_id=a.app_id AND p.tenant_id=a.tenant_id
  WHERE a.tenant_id=$1 AND a.app_id=$2`,[
   tenantId,appId,
   ['STORES_WRITE','PRODUCTS_WRITE','PROMOTIONS_WRITE','VACANCIES_WRITE',
    'PAYMENTS_WRITE','COMPLAINTS_WRITE','APPS_WRITE',
    'STORE_RESERVATION_SETTINGS_UPDATED','CHECKOUT_POLICY_UPDATED',
    'PAYMENT_IMAGES_UPDATED']
  ])
 const row=result.rows[0]
 if(!row)return {registered:false,hasPublished:false,pending:true,revision:0,publishedAt:null}
 return {
  registered:true,
  hasPublished:row.published_at!=null,
  pending:row.published_at==null||row.pending===true,
  revision:Number(row.revision??0),
  publishedAt:row.published_at??null
 }
}
