# Video2Blog 本地工作台前端

这是 Video2Blog 桌面端原型的 React + Vite 前端，用来连接本地 FastAPI Engine 服务，提交转写稿改写任务、查看日志、审批大纲和草稿，并打开最终产物。

可在浏览器开发（`npm run dev`），也可装进 **Tauri 壳**（macOS 原生窗口 + vibrancy + 跟随系统外观）——见仓库根 README「桌面 App」一节，一键 `make app`（需 Rust 工具链）。`src-tauri/` 是壳工程。

## 开发启动

先在仓库根目录启动后端服务：

```bash
python3 scripts/run_engine_server.py
```

然后在 `frontend/` 目录启动前端：

```bash
npm run dev
```

前端默认连接：

```text
http://127.0.0.1:8765
```

## 常用命令

```bash
npm run dev
npm run build
npm run lint
npm run preview
```

`npm run build` 会先运行 TypeScript 构建，再由 Vite 输出生产资源。当前大 chunk 体积警告是已知后续优化项，本轮不做拆包处理。

## 运行要求

- 后端服务需要从仓库根目录运行，才能正确读取 `WORKFLOW.md`、`memory/`、`knowledge/`、`work/` 和 `output/`。
- 前端只负责本地 UI，不保存核心工作流状态；任务状态以 `work/<stem>/.state.json` 和后端内存 job 列表为准。
- LLM 配置是**多配置档管理器**（Settings 页：左列表增删/启用/设默认，右详情编辑）。每档的 API Key 存入 **macOS 系统钥匙串**（经后端 `keyring`，account=`profile:<id>`），不落盘也不进浏览器明文。建任务时可在「配置档」选择器里挑用哪档（默认「跟随默认 ★」）；任务提交只带 `profile_id`、不带 Key，由后端按「环境变量 > 该档钥匙串」解析。早期 localStorage 残留的明文 Key 会在 Settings 弹「导入并清除」提示。
