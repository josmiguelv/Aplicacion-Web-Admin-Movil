// Solo configura borradores locales. No crea, edita ni revoca vínculos en TU VERSO.
const validUuid = value => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const validInstance = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,179}$/.test(value)
const validPurpose = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(value)
const allowedChannels = ['MOBILE_APP', 'WEB']

function validatedPayload(data, bad) {
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      Object.keys(data).some(key => !['storeId', 'purpose', 'channelType', 'instanceKey', 'queueId'].includes(key))) {
    throw bad(400, 'Datos de vínculo inválidos')
  }
  if (!validUuid(data.storeId) || !validUuid(data.queueId) ||
      !validInstance(data.instanceKey) || !validPurpose(data.purpose) ||
      !allowedChannels.includes(data.channelType)) {
    throw bad(400, 'Completa sede, canal, instancia, propósito y UUID de cola con valores válidos')
  }
  return {
    storeId: data.storeId,
    purpose: data.purpose,
    channelType: data.channelType,
    instanceKey: data.instanceKey,
    queueId: data.queueId,
  }
}

const listed = `SELECT b.id, b.store_id AS "storeId", s.name AS "storeName",
  s.code AS "externalLocationId", b.channel_type AS "channelType",
  b.instance_key AS "instanceKey", b.purpose, b.remote_queue_id AS "queueId",
  b.created_at AS "createdAt", b.updated_at AS "updatedAt",
  'LOCAL_DRAFT'::text AS "syncStatus"
  FROM local_tuverso_queue_bindings b
  JOIN stores s ON s.id=b.store_id AND s.tenant_id=b.tenant_id
  WHERE b.tenant_id=$1 AND b.removed_at IS NULL`

export async function handleLocalTuversoBindings(req, res, url, { pool, user, tenantOf, body, json, bad }) {
  const found = url.pathname.match(/^\/api\/admin\/tenants\/([0-9a-f-]+)\/tuverso-bindings(?:\/([0-9a-f-]+))?$/i)
  if (!found) return false

  // El selector de empresa en React nunca concede permisos: validar en servidor.
  if (user.role !== 'SUPER_ADMIN') throw bad(403, 'Solo el Super Administrador puede gestionar vínculos')
  const [, tenantId, bindingId] = found
  await tenantOf(user, tenantId)
  if (bindingId && !validUuid(bindingId)) throw bad(400, 'Vínculo inválido')

  if (req.method === 'GET' && !bindingId) {
    const result = await pool.query(listed + ' ORDER BY b.created_at DESC, b.id', [tenantId])
    json(res, 200, { items: result.rows, remoteSynchronized: false })
    return true
  }

  if (req.method === 'POST' && !bindingId || req.method === 'PATCH' && bindingId) {
    const data = validatedPayload(await body(req), bad)
    const tx = await pool.connect()
    try {
      await tx.query('BEGIN')
      const store = await tx.query('SELECT id FROM stores WHERE tenant_id=$1 AND id=$2', [tenantId, data.storeId])
      if (!store.rowCount) throw bad(404, 'La sede no pertenece a esta empresa')

      let saved
      if (req.method === 'POST') {
        saved = await tx.query(`INSERT INTO local_tuverso_queue_bindings
          (tenant_id, store_id, channel_type, instance_key, purpose, remote_queue_id, created_by, updated_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,
        [tenantId, data.storeId, data.channelType, data.instanceKey, data.purpose, data.queueId, user.id])
      } else {
        saved = await tx.query(`UPDATE local_tuverso_queue_bindings
          SET store_id=$3,channel_type=$4,instance_key=$5,purpose=$6,remote_queue_id=$7,
              updated_by=$8,updated_at=now()
          WHERE tenant_id=$1 AND id=$2 AND removed_at IS NULL RETURNING id`,
        [tenantId, bindingId, data.storeId, data.channelType, data.instanceKey, data.purpose, data.queueId, user.id])
      }
      if (!saved.rowCount) throw bad(404, 'No se encontró un vínculo local vigente')
      const id = saved.rows[0].id
      await tx.query('INSERT INTO admin_audit(tenant_id,actor_user_id,action,target_id) VALUES($1,$2,$3,$4)',
        [tenantId, user.id, req.method === 'POST' ? 'TUVERSO_LOCAL_BINDING_CREATED' : 'TUVERSO_LOCAL_BINDING_UPDATED', id])
      await tx.query('COMMIT')
      json(res, req.method === 'POST' ? 201 : 200, { id, syncStatus: 'LOCAL_DRAFT' })
      return true
    } catch (error) {
      await tx.query('ROLLBACK')
      throw error
    } finally {
      tx.release()
    }
  }

  if (req.method === 'DELETE' && bindingId) {
    const tx = await pool.connect()
    try {
      await tx.query('BEGIN')
      const deleted = await tx.query(`UPDATE local_tuverso_queue_bindings
        SET removed_at=now(),updated_by=$3,updated_at=now()
        WHERE tenant_id=$1 AND id=$2 AND removed_at IS NULL RETURNING id`,
      [tenantId, bindingId, user.id])
      if (!deleted.rowCount) throw bad(404, 'Vínculo local no encontrado')
      await tx.query('INSERT INTO admin_audit(tenant_id,actor_user_id,action,target_id) VALUES($1,$2,$3,$4)',
        [tenantId, user.id, 'TUVERSO_LOCAL_BINDING_REMOVED', bindingId])
      await tx.query('COMMIT')
      json(res, 200, { removed: true, remoteSynchronized: false })
      return true
    } catch (error) {
      await tx.query('ROLLBACK')
      throw error
    } finally {
      tx.release()
    }
  }

  throw bad(405, 'Método no permitido')
}
