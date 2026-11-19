// Los tokens de TU VERSO son opacos: su prefijo/version puede cambiar por el emisor.
// Se aceptan formatos actuales tvi_v1_, futuros tuverso_ o cualquier otro formato
// seguro. Nunca se reescribe una credencial válida, salvo espacios externos al copiar.
export function normalizeTuVersoCredential(value) {
 if (typeof value !== 'string') return null
 const token=value.trim()
 // Rechazar espacios internos, caracteres de control, encabezados y tokens de otro proveedor.
 if (token.length<32 || token.length>1024 || !/^[A-Za-z0-9._~+\/=\-]+$/.test(token) ||
     /^ib2g_sk_/i.test(token)) return null
 return token
}
