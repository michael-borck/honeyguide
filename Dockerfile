# Honeyguide self-host image: server + built web UI in one container (ADR-0008).
FROM node:26-alpine AS build
WORKDIR /app
# The desktop workspace pulls in Electron; its binary is useless in a
# server image, so skip the download.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY . .
RUN npm ci \
  && npm run build -w @michaelborck/honeyguide-core -w @michaelborck/honeyguide-server \
  && npm run build -w @michaelborck/honeyguide-web

FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/package-lock.json ./
COPY --from=build --chown=node:node /app/packages/core/package.json packages/core/
COPY --from=build --chown=node:node /app/packages/core/dist packages/core/dist
COPY --from=build --chown=node:node /app/packages/server/package.json packages/server/
COPY --from=build --chown=node:node /app/packages/server/dist packages/server/dist
COPY --from=build --chown=node:node /app/packages/web/dist packages/server/public
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
# Run as the unprivileged `node` user shipped with the base image.
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["node", "packages/server/dist/index.js"]