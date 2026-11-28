// Security headers are applied once to all HTTP responses before route dispatch.
// Only enable CSP/HSTS in production; the Vite development server is unchanged.
// Google Fonts are used by existing CSS. Inline React styles are preserved.
export function securityHeaders({production=false}={}){
 return {
  'X-Content-Type-Options':'nosniff',
  'X-Frame-Options':'DENY',
  'Referrer-Policy':'no-referrer',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy':'same-origin',
  ...(production?{
   'Strict-Transport-Security':'max-age=31536000',
   'Content-Security-Policy':[
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https: wss:"
   ].join('; ')
  }:{})
 }
}
export function applySecurityHeaders(res,options){
 for(const [key,value] of Object.entries(securityHeaders(options)))res.setHeader(key,value)
}
