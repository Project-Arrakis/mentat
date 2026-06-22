FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
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
CMD ["node", "src/index.js"]
