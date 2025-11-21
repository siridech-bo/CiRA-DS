FROM nvcr.io/nvidia/deepstream-l4t:6.0.1-samples

WORKDIR /app

# Install minimal tools and attempt Node 16 installation (compatible with glibc 2.27)
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl xz-utils; \
    update-ca-certificates || true; \
    if ! command -v node >/dev/null 2>&1; then \
      curl -fsSL https://deb.nodesource.com/setup_16.x | bash - || true; \
      apt-get install -y --no-install-recommends nodejs || true; \
    fi; \
    if ! command -v node >/dev/null 2>&1; then \
      ARCH="linux-arm64"; VER="v16.20.2"; \
      curl -fsSL https://nodejs.org/dist/${VER}/node-${VER}-${ARCH}.tar.xz -o /tmp/node.tar.xz; \
      tar -xJf /tmp/node.tar.xz -C /usr/local/; \
      ln -sf /usr/local/node-${VER}-${ARCH}/bin/node /usr/local/bin/node; \
      ln -sf /usr/local/node-${VER}-${ARCH}/bin/npm /usr/local/bin/npm; \
      ln -sf /usr/local/node-${VER}-${ARCH}/bin/npx /usr/local/bin/npx; \
      rm -f /tmp/node.tar.xz; \
    fi; \
    node -v && npm -v

# Copy application
COPY jetson-web /app

# Install app dependencies (offline-friendly if node_modules is present)
RUN set -eux; \
    if [ -d "/app/node_modules" ]; then echo "Using pre-existing node_modules"; else npm install --no-audit --no-fund || true; fi

ENV PORT=80
CMD ["node","server.js"]