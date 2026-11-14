FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && groupadd --system orvex \
    && useradd --system --gid orvex --create-home orvex

COPY --chown=orvex:orvex config.py messages.py personality.py ai.py backend.py bot.py ./

USER orvex

CMD ["python", "bot.py"]
