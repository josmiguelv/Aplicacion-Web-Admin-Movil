# Node 22 / pnpm 11: reproducible frontend build and API runtime.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
# Include the reviewed one-time PostgreSQL 17 initializer for the first deployment.
# No migration is invoked automatically by the application process.
COPY --from=build /app/scripts/bootstrap-empty-admin-db.mjs ./scripts/bootstrap-empty-admin-db.mjs
USER node
EXPOSE 4000
CMD ["node", "server/index.mjs"]
