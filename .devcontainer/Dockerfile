FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    pkg-config \
    libssl-dev \
    protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

# Install Task (task runner)
RUN sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -d -b /usr/local/bin

# Install NATS CLI
RUN curl -fsSL https://github.com/nats-io/natscli/releases/latest/download/nats-0.1.6-linux-amd64.zip \
    -o /tmp/nats-cli.zip && \
    unzip /tmp/nats-cli.zip -d /tmp/nats-cli && \
    mv /tmp/nats-cli/nats /usr/local/bin/nats && \
    chmod +x /usr/local/bin/nats && \
    rm -rf /tmp/nats-cli*

# Install FlatBuffers compiler
RUN curl -fsSL https://github.com/google/flatbuffers/releases/latest/download/Linux.flatc.binary.clang++-15.zip \
    -o /tmp/flatc.zip && \
    unzip /tmp/flatc.zip -d /tmp/flatc && \
    mv /tmp/flatc/flatc /usr/local/bin/flatc && \
    chmod +x /usr/local/bin/flatc && \
    rm -rf /tmp/flatc*

# Rust components are installed via devcontainer features
# Node + pnpm are installed via devcontainer features
