FROM node:24-alpine AS build
WORKDIR /workspace
RUN npm install --global pnpm@10.28.2
COPY . .
RUN pnpm install --frozen-lockfile \
    && pnpm --filter @boba/orders... build \
    && pnpm --filter @boba/orders deploy --prod /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /out .
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
