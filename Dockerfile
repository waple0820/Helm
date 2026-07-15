FROM docker.1ms.run/library/python:3.12-alpine

WORKDIR /app
COPY . .

ENV HELM_SHARE_HOST=0.0.0.0 \
    HELM_SHARE_PORT=8080 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

EXPOSE 8080
CMD ["python3", "helm_share_server.py"]
