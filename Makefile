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

test:		## run all unit tests
	@echo "🧪 Running all tests..."
	@echo ""
	@node test/rule-engine-test.js
	@echo ""
	@node test/bookmark-menu-test.js
	@node test/options-state-machines-test.js
	@node test/background-issue-1-test.js
	@node test/repository-issue-2-test.js
	@node test/background-issue-4-test.js
	@node test/background-issue-7-test.js
	@node test/background-issue-8-test.js
	@node test/test-compression-large-ruleset.js

lint:		## validate extension code and manifest
	@echo "🔍 Linting extension..."
	@web-ext lint

run:		## run extension in Firefox for development
	@echo "🚀 Starting Firefox with extension..."
	@web-ext run

release:		## tag the manifest version and push it to start the AMO release workflow
	@test "$$(git branch --show-current)" = master || { echo "Run from master"; exit 1; }
	@test -z "$$(git status --porcelain --untracked-files=no)" || { echo "Commit changes first"; exit 1; }
	@git fetch --quiet --tags origin
	@test "$$(git rev-parse HEAD)" = "$$(git rev-parse origin/master)" || { echo "Push master and wait for CI first"; exit 1; }
	@version=$$(node -p "require('./manifest.json').version"); \
	! git rev-parse --quiet --verify "refs/tags/v$$version" >/dev/null || { echo "Tag v$$version exists; bump the version in manifest.json"; exit 1; }; \
	grep -q "^## \[$$version\]" CHANGELOG.md || { echo "Add a CHANGELOG.md entry for $$version"; exit 1; }; \
	ci=$$(gh run list --workflow CI --commit "$$(git rev-parse HEAD)" --json conclusion --jq '.[0].conclusion'); \
	test "$$ci" = success || { echo "CI for HEAD is '$${ci:-missing}', not success"; exit 1; }; \
	git tag -a "v$$version" -m "Release $$version" && \
	git push origin "v$$version"

clean:		## remove build artifacts
	@echo "🧹 Cleaning build artifacts..."
	@rm -rf web-ext-artifacts/

.PHONY: help build test lint run release clean
