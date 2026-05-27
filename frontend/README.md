# Video2Blog 本地工作台前端

这是 Video2Blog 桌面端原型的 React + Vite 前端，用来连接本地 FastAPI Engine 服务，提交转写稿改写任务、查看日志、审批大纲和草稿，并打开最终产物。

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
- API key、模型和 API base 可在前端 Settings 中填写，任务提交时会传给本地后端使用。
