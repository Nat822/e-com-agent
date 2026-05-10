FROM python:3.12-slim

# No network access inside sandbox during code execution (security)
# Workspace calls go through the host via mounted socket

WORKDIR /agent

# Install Python deps — pre-loaded in every execute_code call
RUN pip install --no-cache-dir \
    python-dateutil \
    pyyaml \
    requests \
    grpcio \
    grpcio-tools \
    protobuf

# Create directories used by the runner
RUN mkdir -p /scratchpads /agent/runs

# Copy the workspace Python client
COPY workspace/ /agent/workspace/

# The container stays alive — the TS runner execs individual scripts
CMD ["tail", "-f", "/dev/null"]
