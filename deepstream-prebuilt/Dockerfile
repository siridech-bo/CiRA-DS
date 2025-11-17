FROM nvcr.io/nvidia/deepstream-l4t:6.0.1-triton

# Ensure toolchain present (usually already installed in DeepStream images)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential pkg-config \
  && rm -rf /var/lib/apt/lists/*

# Build all DeepStream C/C++ sample apps so binaries are ready after boot
RUN for d in /opt/nvidia/deepstream/deepstream-6.0/sources/apps/sample_apps/deepstream-test*; do \
      echo "Building $d"; \
      make -C "$d"; \
    done

# Keep container alive; external controller (web app) can exec and run samples
ENTRYPOINT ["bash","-lc","sleep infinity"]