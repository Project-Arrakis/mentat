FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Patch Alpine system packages (e.g. libcrypto3/libssl3) to their latest
# available versions at build time, independent of whatever the floating
# `node:22-alpine` tag happened to bundle when it was last pulled/cached.
# Fixes CVE-2026-14456 (OpenSSL denial-of-service via unbounded memory
# growth) found by trivy-image on sentinel#234 -- confirmed the same CVE
# also failed against main independent of that PR, so this fix targets
# main directly rather than being bundled into an unrelated change.
RUN apk update && apk upgrade --no-cache && rm -rf /var/cache/apk/*
RUN rm -rf \
    /opt/yarn* \
    /usr/local/bin/corepack \
    /usr/local/bin/npm \
    /usr/local/bin/npx \
    /usr/local/bin/yarn \
    /usr/local/bin/yarnpkg \
    /usr/local/lib/node_modules/corepack \
    /usr/local/lib/node_modules/npm
USER node
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node assets ./assets
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node scripts/healthcheck.js
CMD ["node", "src/index.js"]
