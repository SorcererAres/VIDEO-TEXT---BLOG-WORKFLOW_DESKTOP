PYTHON := .venv/bin/python
PIP := .venv/bin/pip
FRONTEND_DIR := frontend

.PHONY: install test validate regression frontend-lint frontend-build server dev app app-build backend-bin

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

# Phase 3 sidecar 准备：把 FastAPI 后端冻结成 onedir 可执行。
# 暂不含 mlx-whisper（需 .metallib datas）；暂未签名（首次访问钥匙串会弹窗）。
backend-bin:
	bash scripts/build_backend_bin.sh
