FROM debian:bookworm-slim AS whisper

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential ca-certificates cmake git \
  && git clone --branch v1.9.2 --depth 1 https://github.com/ggml-org/whisper.cpp.git /src \
  && cmake -S /src -B /src/build \
    -DBUILD_SHARED_LIBS=OFF \
    -DCMAKE_BUILD_TYPE=Release \
    -DGGML_NATIVE=OFF \
    -DWHISPER_BUILD_EXAMPLES=ON \
  && cmake --build /src/build --config Release --parallel 2

FROM node:22-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:/opt/youtube-uploader/bin:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    chromium \
    ffmpeg \
    fonts-liberation \
    git \
    python3 \
    python3-venv \
    tini \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

RUN apt-get update \
  && apt-get install -y --no-install-recommends bubblewrap ripgrep socat \
  && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /tmp/greenlight-wheel-downloader \
  && mkdir -p /usr/local/share/greenlight-python-wheels \
  && /tmp/greenlight-wheel-downloader/bin/pip download --no-cache-dir \
    --dest /usr/local/share/greenlight-python-wheels pydantic==2.12.5 \
  && rm -rf /tmp/greenlight-wheel-downloader

COPY --from=whisper /src/build/bin/whisper-cli /usr/local/bin/whisper-cli

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @greenlight/contracts build \
  && pnpm --filter @greenlight/mcp build \
  && pnpm --filter @greenlight/render build \
  && python3 -m venv /opt/youtube-uploader \
  && /opt/youtube-uploader/bin/pip install --no-cache-dir \
    git+https://github.com/aryan877/youtube-uploader.git@e2b6a38d6539e835e18aa419f90bd6881a869b23 \
  && apt-get purge -y --auto-remove build-essential \
  && rm -rf /var/lib/apt/lists/* /root/.cache

COPY deploy/pip.conf /etc/pip.conf

ENTRYPOINT ["tini", "--"]
CMD ["node", "apps/mcp/dist/server.js"]
