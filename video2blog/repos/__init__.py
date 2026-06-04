"""仓储层：把"扫磁盘 / 解析 frontmatter / 跨目录联动删"等领域逻辑从 routes 下沉。

路由只负责 HTTP 形态（参数、状态码、序列化），数据/文件操作集中在这里。
- post_repo：output/Posts/ 作品域（扫描 + 关联 review + 跨目录清扫）
- task_repo：work/<stem>/ + 内存队列（薄壳，转发 EngineJobService）

Round 1 阶段不引入新 dataclass，函数返回的 dict 形态与原 routes/jobs.py 完全一致，
确保旧端点 zero-behavior-change。Round 2/3 再演进。
"""
