import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { handleLocalTuversoBindings } from './local-tuverso-bindings.mjs'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const fail = (code, message) => Object.assign(new Error(message), { code })
const mkRequest = (method, payload) => ({ method, payload })

async function dispatch(user, tenantId, method, payload, id) {
  const req = mkRequest(method, payload)
  const res = {}
  const handled = await handleLocalTuversoBindings(
    req, res,
    new URL('http://localhost/api/admin/tenants/' + tenantId + '/tuverso-bindings' + (id ? '/' + id : '')),
    {
      pool, user,
      tenantOf: async (_actor, selectedTenant) => {
        if (selectedTenant !== tenantId) throw fail(403, 'Otra empresa')
      },
      body: async request => request.payload,
      json: (response, status, data) => { response.status = status; response.data = data },
      bad: fail,
    },
  )
  assert.equal(handled, true)
  return res
}

test('vínculos locales: autorización, empresa, edición, unicidad y baja lógica', async () => {
  assert.ok(process.env.DATABASE_URL, 'Usar PostgreSQL aislado en CI')
  try {
    await pool.query(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
    const a = (await pool.query("INSERT INTO tenants(name) VALUES('CI vinculaciones A') RETURNING id")).rows[0].id
    const b = (await pool.query("INSERT INTO tenants(name) VALUES('CI vinculaciones B') RETURNING id")).rows[0].id
    const userId = (await pool.query(
      "INSERT INTO admin_users(email,password_hash,role) VALUES('ci-bindings@example.invalid','ci-unusable','SUPER_ADMIN') RETURNING id"
    )).rows[0].id
    const storeA = (await pool.query(
      "INSERT INTO stores(tenant_id,name,address,code) VALUES($1,'Sede A','PRUEBA','ci-sede-a') RETURNING id", [a],
    )).rows[0].id
    const storeB = (await pool.query(
      "INSERT INTO stores(tenant_id,name,address,code) VALUES($1,'Sede B','PRUEBA','ci-sede-b') RETURNING id", [b],
    )).rows[0].id
    const superAdmin = { id: userId, role: 'SUPER_ADMIN', tenant_id: null }
    const normalAdmin = { id: userId, role: 'TENANT_ADMIN', tenant_id: a }
    const payload = {
      storeId: storeA, channelType: 'MOBILE_APP',
      instanceKey: 'ci-android', purpose: 'ORDER_REQUEST', queueId: randomUUID(),
    }

    await assert.rejects(dispatch(normalAdmin, a, 'GET'), error => error.code === 403)
    await assert.rejects(dispatch(superAdmin, a, 'POST', { ...payload, storeId: storeB }), error => error.code === 404)
    await assert.rejects(dispatch(superAdmin, a, 'POST', { ...payload, queueId: 'invalid' }), error => error.code === 400)

    const created = await dispatch(superAdmin, a, 'POST', payload)
    assert.equal(created.status, 201)
    assert.equal(created.data.syncStatus, 'LOCAL_DRAFT')
    const bindId = created.data.id

    await assert.rejects(dispatch(superAdmin, a, 'POST', payload), error => error.code === '23505')
    const aBindings = await dispatch(superAdmin, a, 'GET')
    assert.equal(aBindings.data.items.length, 1)
    assert.equal(aBindings.data.items[0].externalLocationId, 'ci-sede-a')
    assert.equal(aBindings.data.remoteSynchronized, false)
    const bBindings = await dispatch(superAdmin, b, 'GET')
    assert.equal(bBindings.data.items.length, 0)

    const newQueueId = randomUUID()
    const updated = await dispatch(superAdmin, a, 'PATCH', { ...payload, queueId: newQueueId }, bindId)
    assert.equal(updated.status, 200)
    const afterEdit = await dispatch(superAdmin, a, 'GET')
    assert.equal(afterEdit.data.items.length, 1)
    assert.equal(afterEdit.data.items[0].queueId, newQueueId)
    await assert.rejects(dispatch(superAdmin, a, 'PATCH', { ...payload, storeId: storeB }, bindId), error => error.code === 404)

    const removed = await dispatch(superAdmin, a, 'DELETE', undefined, bindId)
    assert.equal(removed.data.remoteSynchronized, false)
    assert.equal((await dispatch(superAdmin, a, 'GET')).data.items.length, 0)
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM stores WHERE tenant_id=$1', [a])).rows[0].count, 1)
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM admin_audit WHERE tenant_id=$1 AND action LIKE $2', [a, 'TUVERSO_LOCAL_BINDING_%'])).rows[0].count, 3)

    const recreated = await dispatch(superAdmin, a, 'POST', payload)
    assert.equal(recreated.status, 201, 'La baja lógica libera la asociación original')
  } finally {
    await pool.end()
  }
})
