# Build from repository-root context; the controlled Graphiti package is local.
FROM python:3.11-slim-trixie
WORKDIR /opt/liquidaity
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY GraphitiLatest/ GraphitiLatest/
COPY services/knowgraph/requirements.txt services/knowgraph/requirements.txt
RUN python -m pip install --no-cache-dir -r services/knowgraph/requirements.txt \
 && python -m pip check
COPY services/knowgraph/*.py services/knowgraph/
RUN useradd --uid 10000 --create-home --home-dir /opt/data service \
 && mkdir -p services/knowgraph/uploads \
 && chown service:service services/knowgraph/uploads
USER service
CMD ["python", "-X", "utf8", "-m", "uvicorn", "app:app", "--app-dir", "/opt/liquidaity/services/knowgraph", "--host", "127.0.0.1", "--port", "8001"]
