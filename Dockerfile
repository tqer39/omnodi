# syntax=docker/dockerfile:1
FROM node:24.22.0-bookworm-slim@sha256:91acba91b842bec0bf7ea6f5e09c644c7ccad72c4996ed9616d861d1c7cd60d4 AS build
WORKDIR /app
COPY --chmod=0644 package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN node scripts/build.mjs

FROM node:24.22.0-bookworm-slim@sha256:91acba91b842bec0bf7ea6f5e09c644c7ccad72c4996ed9616d861d1c7cd60d4 AS runtime
ENV NODE_ENV=production
LABEL org.opencontainers.image.source="https://github.com/tqer39/omnodi"
WORKDIR /app
COPY --chmod=0644 package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/examples ./examples
COPY --from=build --chown=node:node /app/src/assets/SIMPLE-ICONS-LICENSE.txt ./licenses/SIMPLE-ICONS-LICENSE.txt
COPY --from=build --chown=node:node /app/src/assets/flags/LICENSE.txt ./licenses/flag-icons-LICENSE.txt
COPY --from=build --chown=node:node /app/src/assets/manifest.json ./licenses/icons-manifest.json
COPY --from=build --chown=node:node /app/src/assets/flags/manifest.json ./licenses/flags-manifest.json
COPY --from=build --chown=node:node /app/docs/assets.md ./licenses/assets.md
COPY --from=build --chown=node:node /app/LICENSE ./LICENSE
COPY --from=build --chown=node:node /app/THIRD_PARTY_NOTICES.md ./THIRD_PARTY_NOTICES.md
USER node
EXPOSE 5180
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5180/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["preview", "examples/aws.infra", "--host", "0.0.0.0", "--port", "5180"]
