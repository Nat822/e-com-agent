## BitGN Ecom Agent — Makefile
## Usage: make <target>

MODEL ?= gpt-oss-120b
CONCURRENCY ?= 5
BENCH ?= bitgn/ecom1-dev
SUBMIT ?= false

.PHONY: install build sandbox run run-prod clean help

help:
	@echo "Targets:"
	@echo "  install    — install Node + Python deps"
	@echo "  build      — build Docker sandbox image"
	@echo "  sandbox    — run against local dev tasks (no API key needed)"
	@echo "  run        — run against BitGN bench (needs BITGN_API_KEY)"
	@echo "  run-prod   — run against prod bench"
	@echo "  clean      — clean build artifacts"

install:
	npm install
	pip install python-dateutil pyyaml requests --break-system-packages

build:
	docker build -t ecom-agent-sandbox .
	@echo "Sandbox image built: ecom-agent-sandbox"

sandbox: build
	@echo "Running sandbox (local dev tasks)..."
	BITGN_BENCH=local MODEL=$(MODEL) npx tsx runs/run.ts \
		--bench=local \
		--concurrency=1

run: build
	@echo "Running against bench=$(BENCH) concurrency=$(CONCURRENCY)..."
	npx tsx runs/run.ts \
		--bench=$(BENCH) \
		--concurrency=$(CONCURRENCY) \
		--submit=$(SUBMIT)

run-prod: build
	@echo "Running PRODUCTION bench..."
	MODEL=$(MODEL) npx tsx runs/run.ts \
		--bench=bitgn/ecom1-prod \
		--concurrency=20 \
		--submit=true

# Run a single task for local debugging
debug-task:
	@echo "Debugging task $(TASK_ID)..."
	npx tsx runs/run.ts --bench=$(BENCH) --concurrency=1

clean:
	rm -rf runs/*/
	find . -name "*.js" -not -path "*/node_modules/*" -delete
