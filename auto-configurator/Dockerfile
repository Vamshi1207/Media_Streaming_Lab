FROM python:3.11-slim

WORKDIR /app

RUN pip install requests

COPY setup.py .

CMD ["python", "setup.py"]
