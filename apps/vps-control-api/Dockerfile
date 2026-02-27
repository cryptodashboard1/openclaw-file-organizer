FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/vps-control-api/package.json apps/vps-control-api/package.json
COPY packages/common/package.json packages/common/package.json
COPY packages/contracts/package.json packages/contracts/package.json

RUN pnpm install --frozen-lockfile=false

COPY apps/vps-control-api apps/vps-control-api
COPY packages/common packages/common
COPY packages/contracts packages/contracts

RUN pnpm --filter @ao/vps-control-api build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4040

# Copy the full built workspace to preserve pnpm workspace symlinks for @ao/common and @ao/contracts.
COPY --from=build /app /app

EXPOSE 4040

CMD ["node", "apps/vps-control-api/dist/server.js"]
