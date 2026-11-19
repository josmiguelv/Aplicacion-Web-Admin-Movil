// Exact origin allowlist for development HTTPS tunnels only.
// Production accepts only ADMIN_ORIGIN and never trusts a forwarded Host.
export function isAllowedAdminOrigin(origin, {
 adminOrigin,
 extraOrigins = [],
 production = false,
} = {}) {
 if (!origin) return !production
 if (typeof origin !== 'string' || origin === 'null') return false
 if (adminOrigin && origin === adminOrigin) return true
 if (production) return false
 return extraOrigins.some(value => typeof value === 'string' &&
  /^https:\/\/[^/?#]+$/.test(value) && value === origin)
}
