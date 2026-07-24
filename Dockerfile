# Sandbox for running untrusted model-generated code.
# Executes the OpenRouter (cloud) runner inside a throwaway, unprivileged
# container with NO access to your host filesystem or credentials.
# (Local MLX runs can't be containerized on Apple Silicon — they need Metal;
#  use a VM for those.)
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /bench
COPY package.json ./
RUN npm install -D vitest

# fixtures, specs, tests, and the harness
COPY . .

# run as a non-root, unprivileged user
RUN useradd --create-home runner && chown -R runner /bench
USER runner

# the OpenRouter key is supplied at `docker run` time via -e, never baked in
ENTRYPOINT ["python3", "iterate.py"]
CMD ["--help"]
