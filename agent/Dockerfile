FROM python:3.12-slim

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /app

# Install dependencies (cached layer)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Download turn-detector model files (cached layer, ~65 MB from HuggingFace)
COPY agent.py ./
RUN uv run python agent.py download-files

CMD ["uv", "run", "python", "agent.py", "start"]
