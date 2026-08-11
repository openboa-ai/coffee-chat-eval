FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436

RUN apt-get update && \
    apt-get install -y --no-install-recommends bash ca-certificates git ripgrep && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY case.json /app/ifeval-case.json
