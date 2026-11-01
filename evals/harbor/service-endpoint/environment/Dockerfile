FROM node:24.13.0-bookworm-slim@sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f

ENV COPILOT_AUTO_UPDATE=false

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash ca-certificates curl git procps \
    && rm -rf /var/lib/apt/lists/* \
    && npm install --global pnpm@10.28.2 \
    && useradd --create-home --shell /bin/bash agent
WORKDIR /workspace
COPY repo/ /workspace/
RUN git init --quiet --initial-branch=main \
    && git add . \
    && git -c user.name='Fictional eval fixture' -c user.email='fixture@example.invalid' \
       commit --quiet -m 'Reviewed source fixture' \
    && pnpm install --frozen-lockfile \
    && pnpm --filter './packages/*' build \
    && chown -R agent:agent /workspace
