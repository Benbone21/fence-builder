# Fence Builder as a shared server with accounts (FENCE_MODE=multi).
# Step by step: README.md, "Run it as a shared server (Ubuntu and Docker)".
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    PORT=8787 HOST=0.0.0.0 FENCE_MODE=multi FENCE_DATA=/data/fence-data.json

# the server runs as its own user (10001), never as root
RUN groupadd --system --gid 10001 fence \
 && useradd --system --uid 10001 --gid fence --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin fence \
 && mkdir -p /data && chown fence:fence /data && chmod 700 /data

WORKDIR /app
COPY server.py offline.py auth.py VERSION update.json ./
COPY static ./static

USER fence
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/health' % os.environ.get('PORT', '8787'), timeout=4)"]
CMD ["python", "server.py"]
