default: build

help:		## list out commands with descriptions
	@sed -ne '/@sed/!s/## //p' $(MAKEFILE_LIST)

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