# DECOUPLE — 任务与作品集解耦方案

> 状态：proposal · 范围：后端 `video2blog/routes/` + 前端 `frontend/src/`
> 关联：`WORKFLOW.md`（落盘约定）、`DESIGN.md`（UI 方向）

## 1. 诊断

不是"任务和作品集耦合"，而是**它们是同一个对象**。

`EngineJob` 同时演两个角色：

- 运行中的 pipeline run（live / queued / paused / running）
- 已落盘的成品（`kind === "historical"`，从 `output/Posts/**/*.md` 扫描重建）

后果是删除路径被牵连：

| 删除入口 | 实际触碰 |
|---|---|
| `DELETE /jobs/history` | `output/Posts/` + `output/Reviews/` + `work/<stem>/` + `memory/HISTORY.md` + `memory/fingerprints.jsonl` |
| `DELETE /posts` | 只移 post 文件 → trash，**留下孤立 historicalJob**，前端用 `setHistoricalJobs(prev => prev.filter(...))` 手动补偿 |

`HistoricalDeleteDialog` 的 5 复选框就是这种"对象混用"的 UI 投影 —— 用户感知在"删任务"，实际是在跨域同时删任务中间产物、成品文章、评分、指纹。

### 现状证据

- `frontend/src/App.tsx:143-145`：`jobs / historicalJobs / trashPosts` 三套数据源，App 层无 union
- `frontend/src/App.tsx:516`：`jobs.find(...) ?? historicalJobs.find(...)` —— 同一 `selectedJobId` 跨集合
- `frontend/src/App.tsx:1218-1228`：handleDeletePost 后手工 filter `historicalJobs`
- `video2blog/routes/jobs.py:250-353`：`DELETE /jobs/history` 一次扫 5 处副作用
- `frontend/src/components/HistoricalDeleteDialog.tsx:26-32`：`HistoricalDeleteSelection` = posts + reviews + work + history_index + fingerprints

## 2. 业界对照

| 系统 | 任务（短生命） | 产物（长生命） | 解耦手段 |
|------|----|----|----|
| GitHub Actions / GitLab CI | `workflow_run` | `artifact`（独立 ID、独立保留期、独立 DELETE） | run 删了 artifact 也能留；artifact 通过 `run_id` 软引用 |
| Airflow / Prefect | `DagRun` / `FlowRun` | `Dataset` / `Asset` | run 与 dataset 完全分表；dataset 触发 run，而非 run 持有 dataset |
| Ghost / WordPress / Sanity | 后台 import jobs | `Post` 一等公民 | 任务只产事件，post 只读 frontmatter+metadata |
| DAM 系统（Eagle / Pixave） | 导入 / 转码 job | Asset + 标签 / 打分 | job 完成即销毁，asset 进入 library 后只走 library CRUD |

**共同点**：run/job 是临时编排对象，asset/post 是一等持久对象，二者之间只有一个**软引用**（`source_run_id`），不共享删除路径。

## 3. 推荐方案

三句话核心：

1. **拆领域**：`Task`（执行）⟂ `Post`（作品）⟂ `Trash`（回收）。三个 Repository、三个 API 前缀、三个前端 store。`EngineJob` 不再混演。
2. **删除语义重写**：默认**非级联**。删 Task 只清 `work/<stem>/`；删 Post 只移成品 → trash；指纹/HISTORY 归 Post 域。想一次清光走显式 `purge`（高危操作、独立 UI）。
3. **软引用，不共享对象**：Post 存 `source_stem`（可空）；Task 存 `output_post_path`（可空）。前端要并表显示时在 UI 层 join，不在 model 层混。

### 3.1 领域模型

```python
# video2blog/domain/task.py
@dataclass
class Task:
    id: str                       # uuid 或 stem-hash
    stem: str
    status: TaskStatus            # queued/running/paused/succeeded/failed/cancelled
    request: TaskRequest
    work_dir: Path                # work/<stem>/
    output_post_path: Path | None # 软引用，succeeded 才填
    created_at, updated_at, finished_at

# video2blog/domain/post.py
@dataclass
class Post:
    path: Path                    # output/Posts/<YYYY>/...md（主键）
    title: str
    year: int
    source_stem: str | None       # 软引用，可孤立
    pass_score: float | None      # 来自 review，存 frontmatter 即可
    disposition: ...              # used/edited/rewrote
    created_at: datetime          # 文件 mtime 或 frontmatter date
```

**关键**：Post 主键是 `path`，不是 Task ID。"孤立 Post"（task 已删但成品还在）和"孤立 Task"（成品被移走但 task 元数据还在）都是合法状态，前端不再补偿。

### 3.2 API 表面

```
# 任务域（运行时编排）
GET    /api/tasks                    live + queued + 最近 finished（不读 Posts 目录）
GET    /api/tasks/{id}
POST   /api/tasks                    创建
DELETE /api/tasks/{id}               清 work/<stem>/ + 6s undo（保留现有逻辑）
POST   /api/tasks/{id}/restore       撤销

# 作品域（内容仓储）
GET    /api/posts                    扫 output/Posts/，独立索引
GET    /api/posts/{path}             细节 + dispositions + pass_score
PATCH  /api/posts/{path}             改 frontmatter / 打 disposition
DELETE /api/posts/{path}             移 trash，仅此一项

# 回收站（已经是单独域，保持）
GET    /api/trash/posts
POST   /api/trash/posts/{id}/restore
DELETE /api/trash/posts/{id}         purge

# 危险操作（独立、显式）
POST   /api/maintenance/purge        body: { stem, drop: [work, post, review, fingerprint, history] }
                                     替代当前 DELETE /jobs/history 的"5 选清扫"
```

废 `/jobs/history`，把它今天承担的两件事拆开：

- "任务历史列表" → `GET /api/tasks?include=finished`（继续靠扫 work/ 重建）
- "我看作品集" → `GET /api/posts`，与 task 完全分离

### 3.3 前端

- `useTasks()` / `usePosts()` / `useTrash()` 三个 hook，App.tsx 不再持有三套交错状态
- `jobs.tsx` → `TasksList.tsx`，只渲染 `Task[]`
- `places.tsx` 只接 `Post[]`，不再消费 `EngineJob`
- `HistoricalDeleteDialog` 拆成：
  - `DeleteTaskDialog`（清 work/，单选）
  - `DeletePostDialog`（移 trash，单选）
  - 原来那个 5 复选框对话框留下来变成"维护 → Purge by stem"，藏在设置里

## 4. 落地路径

5-10h/周节奏，3 轮搞完。每轮可独立合并、可独立回滚。

### Round 1 · 后端结构（~3-4h）

只动 Python，0 行业务变化。

- 新建 `video2blog/repos/task_repo.py`、`post_repo.py`，把当前散在 `routes/jobs.py:25-200` 的"扫 Posts/Reviews/HISTORY 重建对象"逻辑搬进去
- 新建 `routes/tasks.py`、`routes/posts.py`，老 `/jobs/*` 保留并内部 forward 到新端点（deprecation 期）
- API 行为不变，前端零改动

### Round 2 · 前端拆 store（~3h）

只动 TypeScript。

- `useTasks` / `usePosts` 分家；`App.tsx` 顶层 state 从三个减到三个独立 hook
- `jobs.tsx` / `places.tsx` 切换数据源到新 hook
- 删除入口仍是旧路径

### Round 3 · 删除语义重写（~2h）

最小但最值钱的一步。

- `DELETE /api/posts/{path}` 不再影响 task；`DELETE /api/tasks/{id}` 不再碰 Posts/
- `handleDeletePost` 去掉 `setHistoricalJobs(prev => prev.filter(...))` 补偿
- `HistoricalDeleteDialog` 改名 `PurgeDialog`，从默认入口移到"设置 → 维护"
- 老 `/jobs/history` 在这一步真删

## 5. 不做的事

避免过度设计，本次明确不做：

- **不上 SQLite**。文件系统扫描 + 内存缓存对单用户桌面应用够用；等列表 > 500 条卡了再说
- **不引入 domain event bus / CQRS**。三个 Repository + 显式调用足矣，事件总线对这个规模是负担
- **不做 Pydantic v2 / schema 大重构**。本轮搬家不装修

## 6. Trade-offs

- **过渡期代价**：Round 1+2 期间老 `/jobs/history` 是 alias，看 routes 时多一层间接。可接受。
- **数据一致性放宽**：拆开后"孤立 Post" / "孤立 Task" 是合法状态 —— 它们本来就是不同生命周期的对象。前端遇到 `source_stem` 找不到 task 时优雅降级即可。
- **维护性净收益**：删除逻辑从 `jobs.py:273-353` 的 80 行交织副作用，变成两个域各 ~20 行；`HistoricalDeleteDialog` 那种"5 选清扫"的认知负担消失。

## 7. 验收

每轮结束的可见信号：

- Round 1：`grep "kind.*historical" video2blog/` 命中减少到只剩 routes/jobs.py 的 alias 路径；新 routes/tasks.py、routes/posts.py 单测各自跑通
- Round 2：`grep historicalJobs frontend/src/` 命中数从当前的多点散布收敛到 ≤ 2 处（兼容老 prop）
- Round 3：`HistoricalDeleteDialog` 不再出现在 jobs / places 默认入口；`DELETE /jobs/history` 从 routes 里消失；`handleDeletePost` 不再手动 filter historicalJobs
