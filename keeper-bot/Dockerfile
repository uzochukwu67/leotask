# Keeper Bot Dockerfile for Koyeb deployment
# ==========================================
# Includes snarkos CLI for executing Aleo transitions

FROM ubuntu:22.04

# Avoid interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    unzip \
    ca-certificates \
    gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Download and install snarkos binary (v4.5.2 - latest)
ENV SNARKOS_VERSION="4.5.2"
RUN wget -q -O /tmp/snarkos.zip https://github.com/AleoHQ/snarkos/releases/download/v${SNARKOS_VERSION}/aleo-v${SNARKOS_VERSION}-x86_64-unknown-linux-gnu.zip && \
    unzip -o /tmp/snarkos.zip -d /tmp/ && \
    mv /tmp/snarkos /usr/local/bin/ && \
    chmod +x /usr/local/bin/snarkos && \
    ln -sf /usr/local/bin/snarkos /usr/local/bin/aleo && \
    rm /tmp/snarkos.zip

# Verify installation
RUN /usr/local/bin/snarkos --version

# Set working directory
WORKDIR /app

# Install Node.js dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application files
COPY . .

# Create non-root user for security
RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home nodejs && \
    chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose the API port
EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8000/health || exit 1

# Set snarkos path (aleo CLI)
ENV SNARKOS_PATH=/usr/local/bin/aleo

# Start the keeper bot
CMD ["node", "keeper-multitoken.mjs"]
