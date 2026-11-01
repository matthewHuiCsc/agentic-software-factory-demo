FROM node:24-alpine AS build
WORKDIR /workspace
RUN npm install --global pnpm@10.28.2
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @boba/store-ops build

FROM nginxinc/nginx-unprivileged:stable-alpine AS runtime
COPY --from=build --chown=101:101 /workspace/apps/store-ops/dist /usr/share/nginx/html
COPY --chown=101:101 apps/store-ops/nginx.conf /etc/nginx/conf.d/default.conf
USER 101
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
