PYTHON := .venv/bin/python
PIP := .venv/bin/pip
FRONTEND_DIR := frontend

.PHONY: install test validate regression frontend-lint frontend-build server dev app app-build

install:
	python3 -m venv .venv
	$(PIP) install -r requirements.txt

test:
	$(PYTHON) -m unittest discover -s tests

validate:
	$(PYTHON) scripts/validate_workflow.py

regression:
	$(PYTHON) scripts/regression.py

frontend-lint:
	npm --prefix $(FRONTEND_DIR) run lint

frontend-build:
	npm --prefix $(FRONTEND_DIR) run build

server:
	$(PYTHON) scripts/run_engine_server.py

dev:
	$(PYTHON) scripts/run_engine_server.py

# 桌面 App（Tauri 壳）：起后端 + tauri dev（需 Rust 工具链，详见 README）
app:
	bash scripts/run_app.sh

# 构建可分发的 .app（注意：当前未打包 Python 后端 sidecar，运行仍需独立后端）
app-build:
	cd $(FRONTEND_DIR) && PATH="$$HOME/.cargo/bin:$$PATH" npm run tauri build
