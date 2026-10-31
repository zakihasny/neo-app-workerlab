FROM node:22.23.3-alpine AS dependencies
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM node:22.23.3-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production APP_ROLE=web HOST=0.0.0.0 PORT=8080
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node migrations ./migrations
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 CMD ["node", "src/healthcheck.js"]
CMD ["node", "src/start.js"]
