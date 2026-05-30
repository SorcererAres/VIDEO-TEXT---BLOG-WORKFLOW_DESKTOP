"""服务首页（纯说明 HTML，给在浏览器直接访问 8765 的人看）。"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi import FastAPI
    from video2blog.server_core import EngineJobService


def register(app: "FastAPI", service: "EngineJobService", root: Path) -> None:
    from fastapi.responses import HTMLResponse

    @app.get("/", response_class=HTMLResponse)
    def home() -> str:
        return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Video2Blog Engine</title>
  <style>
    body {{
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #e8ecff;
      background: #111423;
    }}
    main {{
      max-width: 760px;
      margin: 64px auto;
      padding: 0 24px;
    }}
    h1 {{
      font-size: 32px;
      margin: 0 0 12px;
      font-weight: 700;
    }}
    p {{
      color: #b8c0df;
      line-height: 1.7;
    }}
    code {{
      background: #20263a;
      border: 1px solid #343c57;
      border-radius: 6px;
      padding: 2px 6px;
    }}
    a {{
      color: #8fb4ff;
      text-decoration: none;
    }}
    .links {{
      display: grid;
      gap: 12px;
      margin-top: 28px;
    }}
    .link {{
      border: 1px solid #343c57;
      border-radius: 8px;
      padding: 14px 16px;
      background: #171b2c;
    }}
  </style>
</head>
<body>
  <main>
    <h1>Video2Blog Engine</h1>
    <p>本地服务已启动。当前仓库根目录：<code>{root}</code></p>
    <div class="links">
      <a class="link" href="/health">GET /health - 健康检查</a>
      <a class="link" href="/docs">/docs - FastAPI 调试文档</a>
      <a class="link" href="/openapi.json">/openapi.json - 接口结构</a>
    </div>
  </main>
</body>
</html>"""
