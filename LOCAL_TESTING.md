# Pruebas y desarrollo local — Administrador Web

**Política del repositorio:** no se utilizan GitHub Actions para compilar, probar ni desplegar este proyecto. La validación se realiza de forma local antes de publicar cambios.

## Validación local

1. Usar Node.js y pnpm según la configuración del proyecto.
2. Ejecutar `pnpm install --frozen-lockfile`.
3. Ejecutar `pnpm build` para comprobar el frontend.
4. Ejecutar las pruebas pertinentes del servidor con los comandos documentados en `package.json` y `server/package.json`.
5. Verificar el Administrador y sus API contra PostgreSQL local, sin acceder a bases de TU VERSO.
6. Publicar cambios solamente después de revisar los resultados.

Los archivos de `.github/workflows/` se retiraron de esta rama para impedir la ejecución automática por `push` o pull request. La configuración de otras ramas, incluida la rama principal, debe revisarse por separado si se desea aplicar la misma política en todo el repositorio.
