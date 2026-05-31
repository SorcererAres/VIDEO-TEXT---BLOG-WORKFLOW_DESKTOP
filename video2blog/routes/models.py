"""HTTP 路由层共享的 Pydantic 请求模型。"""

from __future__ import annotations

from pydantic import BaseModel, Field


class JobCreateRequest(BaseModel):
    source: str = Field(..., description="输入源文本路径，可为仓库相对路径或绝对路径")
    speaker: str = "梁老师"
    routing: str = "/lecture"
    mode: str = "full"
    max_retries: int = 1
    model: str | None = None
    api_base: str | None = None
    force: bool = False
    pause_on_outline: bool = True
    api_key: str | None = None
    profile_id: str | None = Field(
        default=None,
        description="使用哪个 LLM 配置档；省略则用默认档（defaultProfileId）",
    )
    rewrite_strategy: str = Field(
        default="single",
        description="single=一次性整篇（默认）；sectioned=full 模式按 outline 拆节滚动改写，长稿用",
    )


class ApproveOutlineRequest(BaseModel):
    outline_markdown: str = Field(..., description="修改后的 markdown 大纲内容")


class ApproveDraftRequest(BaseModel):
    accept: bool = Field(..., description="是否接受草稿以输出正式/DRAFT博文")
    draft_markdown: str | None = Field(
        default=None,
        description="可选：用户在前端微调后的草稿全文。仅在 accept=True 且非空时,覆盖写回 work/<stem>/draft_v<best>.md 然后再 resume。",
    )


class TestLLMRequest(BaseModel):
    api_key: str | None = None
    api_base: str | None = None
    model: str | None = None
    profile_id: str | None = None


class DetectSpeakerRequest(BaseModel):
    """POST /api/detect-speaker 入参：从源文识别演讲人主体。"""
    source: str
    profile_id: str | None = None
    use_llm: bool = False


class KnowledgeFileRequest(BaseModel):
    """PUT /knowledge-file 入参：写回某个合同/知识层文件。"""
    path: str
    content: str


class DispositionRequest(BaseModel):
    """POST /api/dispositions 入参：标记某篇成品的处置（用户实际是否采纳）。

    value ∈ used（直接用了）/ edited（改了改）/ rewrote（重写了）；null 清除标记。
    按成品 path 归档到 memory/dispositions.json，作为质量学习闭环的信号。"""
    path: str
    value: str | None = None


class LlmProfileRequest(BaseModel):
    """POST/PUT /api/llm-profiles 入参。非敏感字段落 config 文件；
    api_key 非空才写系统钥匙串，省略 / null 则保留原 key。"""
    name: str | None = None
    provider: str | None = None
    api_base: str | None = None
    model: str | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    thinking: str | None = None
    enabled: bool | None = None
    api_key: str | None = None
