FROM nvcr.io/nvidia/deepstream-l4t:6.0.1-triton

# Ensure toolchain present (usually already installed in DeepStream images)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential pkg-config libglib2.0-dev python3-pip python3-dev \
    python3-gi gir1.2-gstreamer-1.0 libgirepository1.0-dev \
    gstreamer1.0-plugins-base gstreamer1.0-tools \
    libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev \
    cmake libtool autoconf automake m4 git \
  && rm -rf /var/lib/apt/lists/*

# DeepStream 6.0.1 on Jetson (L4T/JP4.6) uses CUDA 10.2
ENV CUDA_VER=10.2
ENV PLATFORM_TEGRA=1

# Build all DeepStream C/C++ sample apps so binaries are ready after boot
RUN for d in /opt/nvidia/deepstream/deepstream-6.0/sources/apps/sample_apps/deepstream-test*; do \
      echo "Building $d"; \
      make -C "$d"; \
    done

RUN python3 -m pip install --upgrade pip setuptools wheel || true
RUN mkdir -p /opt/nvidia/deepstream/deepstream-6.0/sources && \
    cd /opt/nvidia/deepstream/deepstream-6.0/sources && \
    (test -d deepstream_python_apps || git clone https://github.com/NVIDIA-AI-IOT/deepstream_python_apps.git) && \
    cd deepstream_python_apps && git submodule update --init || true
RUN mkdir -p /opt/nvidia/deepstream/deepstream-6.0/sources/deepstream_python_apps/bindings/build && \
    cd /opt/nvidia/deepstream/deepstream-6.0/sources/deepstream_python_apps/bindings/build && \
    cmake .. -DPYTHON_MAJOR_VERSION=3 -DPYTHON_MINOR_VERSION=$(python3 -c 'import sys; print(sys.version_info.minor)') -DPIP_PLATFORM=linux_aarch64 -DDS_PATH=/opt/nvidia/deepstream/deepstream-6.0/ && \
    make -j$(nproc)
RUN python3 -c "import glob,subprocess,sys; ws=glob.glob('/opt/nvidia/deepstream/deepstream-6.0/sources/deepstream_python_apps/bindings/build/pyds-*.whl'); sys.exit(0 if (len(ws)>0 and subprocess.call(['pip3','install','--no-cache-dir',ws[0]])==0) else 1)"
RUN pip3 install --no-cache-dir pyds_ext || true
RUN pip3 install --no-cache-dir cuda-python || true

ENV LD_LIBRARY_PATH=/usr/local/cuda-10.2/lib64:/usr/lib/aarch64-linux-gnu:/usr/lib/arm-linux-gnueabihf

# Keep container alive; external controller (web app) can exec and run samples
ENTRYPOINT ["bash","-lc","sleep infinity"]