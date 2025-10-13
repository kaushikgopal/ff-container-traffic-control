default: build

ensure-deps:
	@if ! command -v rg >/dev/null 2>&1; then \
		echo "Installing ripgrep..."; \
		brew install ripgrep; \
	fi

help: ensure-deps		## list out commands with descriptions
	@rg '^([a-zA-Z0-9_-]+):.*?## (.*)$$' Makefile --no-line-number --no-filename --color=never --replace '$$1|$$2' | \
	awk -F'|' '{ \
		if (NR % 2 == 1) \
			printf "%-30s %s\n", $$1":", $$2; \
		else \
			printf "\033[2m%-30s %s\033[0m\n", $$1":", $$2; \
	}'

build:		## build Firefox extension package
	@echo "🔨 Building Firefox extension..."
	@web-ext build --overwrite-dest

test:		## run unit tests for rule engine
	@echo "🧪 Running rule engine tests..."
	@node test/rule-engine-test.js

lint:		## validate extension code and manifest
	@echo "🔍 Linting extension..."
	@web-ext lint

run:		## run extension in Firefox for development
	@echo "🚀 Starting Firefox with extension..."
	@web-ext run

clean:		## remove build artifacts
	@echo "🧹 Cleaning build artifacts..."
	@rm -rf web-ext-artifacts/

.PHONY: help build test lint run clean
