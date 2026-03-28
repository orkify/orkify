# Build stage — compile TypeScript
FROM node:22-slim AS build
WORKDIR /opt/orkify
COPY package.json package-lock.json ./
COPY packages/ packages/
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# Runtime stage — Debian with systemd + Node.js + orkify
FROM node:22-slim

# Install systemd (node:22-slim is Debian bookworm)
RUN apt-get update && apt-get install -y --no-install-recommends \
    systemd systemd-sysv procps \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Create orkify user
RUN useradd -m -s /bin/bash orkify

# Install orkify
WORKDIR /opt/orkify
COPY --from=build /opt/orkify/package.json /opt/orkify/package-lock.json ./
COPY --from=build /opt/orkify/packages ./packages
RUN npm ci --ignore-scripts --omit=dev
COPY --from=build /opt/orkify/dist ./dist
COPY --from=build /opt/orkify/bin ./bin
RUN ln -s /opt/orkify/bin/orkify /usr/local/bin/orkify

# Install the systemd service unit
COPY boot/systemd/orkify@.service /etc/systemd/system/orkify@.service

# Test app with slow shutdown
COPY tests/systemd/app.js /home/orkify/app.js
RUN chown orkify:orkify /home/orkify/app.js

# Prepare: start app and save snapshot as orkify user so restore has something to work with.
# Also create the env file (empty — no telemetry in test).
RUN mkdir -p /etc/orkify && touch /etc/orkify/env

# Test script runs inside the container after systemd boots
COPY tests/systemd/repro.sh /usr/local/bin/repro.sh
RUN chmod +x /usr/local/bin/repro.sh

# systemd needs to be PID 1
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
