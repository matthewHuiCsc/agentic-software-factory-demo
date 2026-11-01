FROM node:24-alpine AS tests
WORKDIR /workspace
RUN npm install --global pnpm@10.28.2
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter './packages/*' build
RUN chown -R node:node /workspace
USER node
CMD ["pnpm", "test:integration"]
