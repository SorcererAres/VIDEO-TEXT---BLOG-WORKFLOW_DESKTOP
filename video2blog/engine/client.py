"""LLM API client for the Video2Blog engine, tracking token counts, cost, and handling retries."""

from __future__ import annotations

import concurrent.futures
import json
import os
import time
import urllib.error
import urllib.request
from typing import Any

try:
    import tiktoken
except ImportError:
    tiktoken = None


def estimate_tokens(text: str, model: str = "gpt-4o") -> int:
    """Estimates the token count of a given string. Reuses tiktoken if available."""
    if tiktoken:
        try:
            encoding = tiktoken.encoding_for_model(model)
            return len(encoding.encode(text))
        except Exception:
            try:
                # Fallback to cl100k_base which is standard for GPT-4 / Claude / DeepSeek
                encoding = tiktoken.get_encoding("cl100k_base")
                return len(encoding.encode(text))
            except Exception:
                pass
    # Rough fallback: English words + Chinese characters. Approx 1 token per 1.3 characters on average.
    return int(len(text) * 0.8) + 1


class LLMClient:
    """Client for making direct, OpenAI-compatible chat completion requests with cost and token safeguards."""

    def __init__(
        self,
        api_key: str | None = None,
        api_base: str | None = None,
        model: str | None = None,
        max_budget_tokens: int = 500_000,
        temperature: float = 0.0,
        per_request_timeout: int | None = None,
        max_total_seconds: int | None = None,
    ) -> None:
        self.api_key = api_key or os.environ.get("VIDEO2BLOG_API_KEY", "").strip()
        self.api_base = (
            api_base or os.environ.get("VIDEO2BLOG_API_BASE", "https://api.openai.com/v1").strip()
        )
        self.model = model or os.environ.get("VIDEO2BLOG_MODEL", "gpt-4o").strip()
        self.max_budget_tokens = max_budget_tokens
        self.temperature = temperature

        # 单次 urlopen 的"两次读之间"超时(秒);chunked dribble 攻击会绕过这个,所以下面还要叠 wall-clock
        self.per_request_timeout = per_request_timeout or int(
            os.environ.get("VIDEO2BLOG_PER_REQUEST_TIMEOUT", "90")
        )
        # 整次 call_api(含所有重试)的硬上限墙钟时间;超了就强制 raise,杜绝今天撞了 3 次的"卡死"模式
        self.max_total_seconds = max_total_seconds or int(
            os.environ.get("VIDEO2BLOG_LLM_TOTAL_DEADLINE", "300")
        )

        self.total_input_tokens = 0
        self.total_output_tokens = 0

        # Cost rates per 1M tokens (Defaults are roughly DeepSeek-V3 prices, very cost-effective)
        # DeepSeek-V3: Input $0.14 / Output $0.28
        # Claude-3.5-Sonnet: Input $3.00 / Output $15.00
        # GPT-4o: Input $2.50 / Output $10.00
        # If model is claude, use Claude rates; else if openai, use openai rates; default to deepseek rates.
        self.input_cost_rate = 0.14
        self.output_cost_rate = 0.28
        self._init_cost_rates()

    def _init_cost_rates(self) -> None:
        model_lower = self.model.lower()
        if "claude" in model_lower:
            self.input_cost_rate = 3.00
            self.output_cost_rate = 15.00
        elif "gpt-4o" in model_lower:
            self.input_cost_rate = 2.50
            self.output_cost_rate = 10.00
        elif "gpt-3.5" in model_lower:
            self.input_cost_rate = 0.50
            self.output_cost_rate = 1.50
        # Otherwise keep the default cheap rate (e.g. DeepSeek-V3 / DeepSeek-R1 / local LLMs)

    @property
    def total_cost(self) -> float:
        """Returns the total estimated cost in USD."""
        input_cost = (self.total_input_tokens / 1_000_000.0) * self.input_cost_rate
        output_cost = (self.total_output_tokens / 1_000_000.0) * self.output_cost_rate
        return input_cost + output_cost

    def check_budget(self, input_text: str) -> None:
        """Raises a ValueError if the estimated request would exceed the token budget."""
        est_req = estimate_tokens(input_text, self.model)
        if self.total_input_tokens + self.total_output_tokens + est_req > self.max_budget_tokens:
            raise ValueError(
                f"已超出单次任务 Token 预算硬上限 ({self.max_budget_tokens} tokens)。"
                f"当前已消耗: {self.total_input_tokens + self.total_output_tokens} tokens。"
            )

    def call_api(
        self,
        system_prompt: str,
        user_prompt: str,
        json_mode: bool = False,
        max_retries: int = 5,
        backoff_factor: float = 2.0,
    ) -> str:
        """Calls the OpenAI-compatible completions API with robust retries and exponential backoff."""
        if not self.api_key:
            raise ValueError(
                "还没配置 LLM API Key —— 请在「设置」里添加模型配置档、填好 Key"
                "（或设环境变量 VIDEO2BLOG_API_KEY）。"
            )

        full_prompt_est = system_prompt + "\n" + user_prompt
        self.check_budget(full_prompt_est)

        url = f"{self.api_base.rstrip('/')}/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

        data: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": self.temperature,
        }
        if json_mode:
            data["response_format"] = {"type": "json_object"}

        payload = json.dumps(data).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")

        # 单次 urlopen 的包装:把它丢进一个独立线程,用 future.result(timeout=...) 强制 wall-clock。
        # 关键点:即便 LLM 那头慢吞吞 dribble 字节绕过 urllib timeout,我们也能从外部把这次尝试放弃,
        # 让重试逻辑继续推进,而不是傻等 30 分钟。
        def _do_one_urlopen() -> tuple[int, str]:
            """Returns (http_status_or_0_for_success, body)."""
            try:
                with urllib.request.urlopen(req, timeout=self.per_request_timeout) as response:
                    return (0, response.read().decode("utf-8"))
            except urllib.error.HTTPError as err:
                return (err.code, err.read().decode("utf-8", errors="replace"))

        start = time.monotonic()
        retry_count = 0
        delay = 1.0

        # 单 worker 线程池;退出时不等(wait=False),让卡住的 urlopen 线程留作守护性僵尸,
        # 进程退出时一并清理。整次 call_api 不会因为一个挂死的请求被永久封锁。
        executor = concurrent.futures.ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="v2b-llm"
        )
        try:
            while True:
                elapsed = time.monotonic() - start
                remaining = self.max_total_seconds - elapsed
                if remaining <= 0:
                    raise TimeoutError(
                        f"LLM call_api 超过总耗时硬上限 {self.max_total_seconds}s,放弃 "
                        f"(已 {elapsed:.0f}s,重试 {retry_count} 次)"
                    )

                # 单次 attempt 的最大等待 = min(单请求超时, 剩余总预算)
                # 不留缓冲:max_total_seconds 是硬死线,attempt 超时直接进重试或抛
                attempt_budget = min(self.per_request_timeout, remaining)

                future = executor.submit(_do_one_urlopen)
                try:
                    status, body = future.result(timeout=attempt_budget)
                except concurrent.futures.TimeoutError as err:
                    # 这次 urlopen 卡住了(可能 chunked dribble、网络抽风、服务端无响应)
                    # 不能真正杀线程(Python 限制),但我们可以放弃等待并尝试重试。
                    if retry_count < max_retries and remaining - delay > 5:
                        retry_count += 1
                        time.sleep(delay)
                        delay *= backoff_factor
                        continue
                    raise TimeoutError(
                        f"LLM 单次请求等待 {attempt_budget:.0f}s 仍未返回(或重试预算耗尽),放弃 "
                        f"[总耗时 {time.monotonic() - start:.0f}s / 上限 {self.max_total_seconds}s]"
                    ) from err
                except (urllib.error.URLError, TimeoutError) as err:
                    if retry_count < max_retries and remaining - delay > 5:
                        retry_count += 1
                        time.sleep(delay)
                        delay *= backoff_factor
                        continue
                    raise RuntimeError(f"LLM API 连接超时或失败: {err}") from err
                except Exception as err:
                    raise RuntimeError(f"LLM API 内部请求错误: {err}") from err

                # ─── 拿到了响应 ───
                if status == 0:
                    # 成功路径
                    resp_json = json.loads(body)
                    usage = resp_json.get("usage", {})
                    in_tokens = usage.get("prompt_tokens", 0) or estimate_tokens(
                        full_prompt_est, self.model
                    )
                    choices = resp_json.get("choices", [])
                    if not choices:
                        raise ValueError(f"API 返回 Choices 为空: {body}")
                    content = choices[0].get("message", {}).get("content", "")
                    out_tokens = usage.get("completion_tokens", 0) or estimate_tokens(
                        content, self.model
                    )
                    self.total_input_tokens += in_tokens
                    self.total_output_tokens += out_tokens
                    return content

                # HTTP 错误路径
                if (
                    status in (429, 500, 502, 503, 504)
                    and retry_count < max_retries
                    and remaining - delay > 5
                ):
                    retry_count += 1
                    time.sleep(delay)
                    delay *= backoff_factor
                    continue
                raise RuntimeError(f"LLM API 请求失败: HTTP {status}\n接口返回内容: {body}")
        finally:
            # 卡住的 urlopen 线程留着背景跑,不阻塞 call_api 返回
            executor.shutdown(wait=False, cancel_futures=True)
