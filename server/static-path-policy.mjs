import path from 'node:path'

// Containment using platform-aware semantics. Windows uses backslashes;
// Linux (e.g. Railway) uses forward slashes. Reject parents, siblings and volumes.
export function isStaticPathAllowed(root, candidate, pathImpl = path) {
 const rel = pathImpl.relative(root, candidate)
 return rel === '' || (rel !== '..' && !rel.startsWith('..' + pathImpl.sep) && !pathImpl.isAbsolute(rel))
}
