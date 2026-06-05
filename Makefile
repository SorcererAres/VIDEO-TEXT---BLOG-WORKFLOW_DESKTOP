PYTHON := .venv/bin/python
FRONTEND_DIR := frontend

# Sidecar：PyInstaller onedir 产物 → stage 进 Tauri resources 目录
SIDECAR_SRC := .build-backend/dist/video2blog-server
SIDECAR_DST := frontend/src-tauri/backend/video2blog-server

.PHONY: install test validate regression lint format frontend-lint frontend-build server dev app app-build backend-bin stage-sidecar sign-app notarize-app package-dmg notarize-dmg dist

# 单一依赖来源 = pyproject.toml（pip install -e . 会注册包 + console script）。
# `.[dev]` 带上 ruff 等开发期工具链（不随运行时分发）。
# 一律走 `$(PYTHON) -m pip`，不用 `.venv/bin/pip`：后者在解释器/venv 错位时会装到别处（踩过坑）。
install:
	python3 -m venv .venv
	$(PYTHON) -m pip install -e ".[dev]"

test:
	$(PYTHON) -m unittest discover -s tests

# ── 静态检查 / 格式化（ruff，lint + format 二合一）──
# lint：只读检查（CI 用，不改文件）。format：就地统一格式（本地用）。
lint:
	$(PYTHON) -m ruff check
	$(PYTHON) -m ruff format --check

format:
	$(PYTHON) -m ruff check --fix
	$(PYTHON) -m ruff format

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

# 桌面 App（Tauri 壳 · dev）：直接 tauri dev。
# 后端由 Rust sidecar 在 setup 时自动拉起（dev 模式用 .venv + --auto-port），
# 不再需要脚本预启后端。浏览器降级开发仍可单独 `make server` + `npm run dev`。
app:
	bash scripts/run_app.sh

# 把冻结后端 stage 进 Tauri resources（app-build 依赖）。
# 总是先重打 backend-bin —— 否则旧产物会被 cp 进 .app，导致打包版跑过期后端代码
# （踩过：改了 server 代码但 .app 里仍是旧逻辑）。发版才 app-build，重打代价可接受。
stage-sidecar: backend-bin
	rm -rf "$(SIDECAR_DST)"
	mkdir -p frontend/src-tauri/backend
	cp -R "$(SIDECAR_SRC)" "$(SIDECAR_DST)"
	@echo "[stage-sidecar] 已 stage → $(SIDECAR_DST)"

# 构建可分发的 .app：先 stage 后端 sidecar 进 resources，再 tauri build。
# 出的 .app 内含冻结后端，双击即用，无需独立启动后端。
# 注意：仍未签名/公证——首次访问钥匙串会弹授权框（点「始终允许」）。签名见 scripts/sign_app.sh。
app-build: stage-sidecar
	cd $(FRONTEND_DIR) && PATH="$$HOME/.cargo/bin:$$PATH" npm run tauri build

# 把 FastAPI 后端冻结成 onedir 可执行（sidecar 弹药）。
# 暂不含 mlx-whisper（需 .metallib datas）；暂未签名。
backend-bin:
	bash scripts/build_backend_bin.sh

# ── 阶段 B：Developer ID 签名 + 公证（需 Apple 证书；见脚本头部注释）──
# 深签 .app（含 sidecar 内 dylib）。需 export SIGN_IDENTITY。
sign-app:
	bash scripts/sign_app.sh

# 提交公证 + staple 票据。需 NOTARY_PROFILE 或 APPLE_ID/TEAM_ID/APP_PASSWORD。
notarize-app:
	bash scripts/notarize_app.sh

# 从已签名/已公证 .app 重新生成 dmg，并签名 dmg 本身。
package-dmg:
	bash scripts/package_signed_dmg.sh

# 公证 + staple dmg 本身（取 bundle/dmg 下最新 dmg）。否则双击 dmg 仍被 Gatekeeper 拦。
notarize-dmg:
	bash scripts/notarize_app.sh "$$(ls -t frontend/src-tauri/target/release/bundle/dmg/*.dmg | head -1)"

# 一键出可分发成品：build → 签名 .app → 公证 .app → 打包签名 dmg → 公证 dmg。证书/账号配齐后即用。
dist: app-build sign-app notarize-app package-dmg notarize-dmg
	@echo "[dist] ✓ 已出签名+公证的 .app，以及签名+公证的 .dmg（双击 dmg / 拖出 .app 都过 Gatekeeper）。"
