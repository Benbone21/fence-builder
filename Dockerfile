FROM python:3.12-slim
WORKDIR /app
COPY server.py ./
COPY static ./static
ENV PORT=8787 FENCE_DATA=/data/fence-data.json PYTHONUNBUFFERED=1
VOLUME /data
EXPOSE 8787
CMD ["python", "server.py"]
