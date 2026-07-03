FROM python:3.11-slim

WORKDIR /app

# Install system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl && \
    rm -rf /var/lib/apt/lists/*

# requirements.txt is inside realswing/
COPY realswing/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code (everything)
COPY realswing/ ./realswing/
COPY *.py ./

# Environment
ENV PYTHONUNBUFFERED=1
ENV DRY_RUN=true

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
    CMD curl -f http://localhost:10000/health || exit 1

EXPOSE 10000
CMD ["uvicorn", "realswing.orchestrator:app", "--host", "0.0.0.0", "--port", "10000"]
