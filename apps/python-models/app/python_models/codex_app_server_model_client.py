from __future__ import annotations

import asyncio
import json
import os
import re
import tempfile
from collections.abc import AsyncGenerator, Sequence
from pathlib import Path
from typing import Any

from autogen_core import CancellationToken
from autogen_core.models import (
    AssistantMessage,
    ChatCompletionClient,
    CreateResult,
    LLMMessage,
    ModelCapabilities,
    ModelFamily,
    ModelInfo,
    RequestUsage,
    SystemMessage,
    UserMessage,
)
from autogen_core.tools import Tool, ToolSchema
from pydantic import BaseModel


class CodexAppServerError(RuntimeError):
    """Stable, secret-safe failures for the Codex app-server model doorway."""


_APP_SERVER_CONFIG_ARGS = (
    "-c",
    'web_search="disabled"',
    "-c",
    "tools.web_search=false",
    "-c",
    "tools.view_image=false",
    "-c",
    "features.shell_tool=false",
    "-c",
    "features.remote_plugin=false",
    "-c",
    "agents.enabled=false",
    "-c",
    'history.persistence="none"',
)

_FORBIDDEN_CHILD_ENV_KEYS = {
    "AZURE_OPENAI_API_KEY",
    "CODEX_API_KEY",
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
}

_REQUIRED_MAG_ONE_MODEL = "gpt-5.6-sol"
_REQUIRED_CHATGPT_PLAN = "pro"


def _empty_usage() -> RequestUsage:
    return RequestUsage(prompt_tokens=0, completion_tokens=0)


def _add_usage(left: RequestUsage, right: RequestUsage) -> RequestUsage:
    return RequestUsage(
        prompt_tokens=left.prompt_tokens + right.prompt_tokens,
        completion_tokens=left.completion_tokens + right.completion_tokens,
    )


class CodexAppServerChatCompletionClient(ChatCompletionClient):
    """AutoGen model client backed by one owned Codex app-server process.

    The client is deliberately narrower than Codex itself: it exposes text and
    structured model completion only. It does not expose Codex tools, MCP,
    plugins, filesystem access, web search, or environment capabilities.
    """

    def __init__(
        self,
        *,
        model: str,
        reasoning_effort: str | None = None,
        command: Sequence[str] | None = None,
        request_timeout_seconds: float = 120.0,
    ) -> None:
        normalized_model = str(model or "").strip()
        if not normalized_model:
            raise CodexAppServerError("codex_app_server_model_missing")
        self._model = normalized_model
        self._reasoning_effort = str(reasoning_effort or "").strip() or None
        self._command = tuple(command) if command is not None else None
        self._request_timeout_seconds = request_timeout_seconds
        self._process: asyncio.subprocess.Process | None = None
        self._reader_task: asyncio.Task[None] | None = None
        self._stderr_task: asyncio.Task[None] | None = None
        self._pending: dict[int, asyncio.Future[dict[str, Any]]] = {}
        self._notifications: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._next_request_id = 1
        self._start_lock = asyncio.Lock()
        self._create_lock = asyncio.Lock()
        self._write_lock = asyncio.Lock()
        self._actual = _empty_usage()
        self._total = _empty_usage()
        self._preflight: dict[str, str] | None = None
        self._active_thread_id: str | None = None
        self._active_turn_id: str | None = None
        self._closed = False
        runtime_root = self._repository_root() / "runtime" / "codex-models"
        runtime_root.mkdir(parents=True, exist_ok=True)
        self._temp_dir = tempfile.TemporaryDirectory(
            prefix="liquidaity-codex-model-",
            dir=runtime_root,
            ignore_cleanup_errors=True,
        )
        self._model_info: ModelInfo = {
            "vision": False,
            "function_calling": False,
            "json_output": True,
            "family": ModelFamily.GPT_5,
            "structured_output": True,
            "multiple_system_messages": True,
        }

    @staticmethod
    def _repository_root() -> Path:
        return Path(__file__).resolve().parents[4]

    def _resolve_executable(self) -> str:
        repository_root = self._repository_root().resolve()
        override = str(os.getenv("LIQUIDAITY_CODEX_BIN", "")).strip()
        if override:
            try:
                executable = Path(override).resolve(strict=True)
            except OSError as error:
                raise CodexAppServerError("codex_app_server_not_installed") from error
            if repository_root not in executable.parents:
                raise CodexAppServerError("codex_app_server_outside_repository")
            return str(executable)

        if os.name == "nt":
            native_candidates = sorted(
                repository_root.glob(
                    "node_modules/@openai/codex-win32-*/vendor/*/bin/codex.exe"
                )
            )
            if native_candidates:
                return str(native_candidates[0].resolve())
        else:
            shim = repository_root / "node_modules" / ".bin" / "codex"
            if shim.is_file():
                executable = shim.resolve()
                if repository_root in executable.parents:
                    return str(executable)

        if not override:
            raise CodexAppServerError(
                "codex_app_server_not_installed: install repository dependencies"
            )
        raise CodexAppServerError("codex_app_server_not_installed")

    async def _discover_mcp_disable_args(self, executable: str) -> tuple[str, ...]:
        """Ask the official CLI for enabled MCP names without reading Codex config."""
        try:
            inventory = await asyncio.create_subprocess_exec(
                executable,
                "mcp",
                "list",
                "--json",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=self._temp_dir.name,
                env=self._child_environment(),
            )
            stdout, _stderr = await asyncio.wait_for(
                inventory.communicate(), timeout=15.0
            )
        except (OSError, asyncio.TimeoutError) as error:
            raise CodexAppServerError("codex_mcp_inventory_failed") from error
        if inventory.returncode != 0:
            raise CodexAppServerError("codex_mcp_inventory_failed")
        try:
            records = json.loads(stdout.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise CodexAppServerError("codex_mcp_inventory_invalid") from error
        if not isinstance(records, list):
            raise CodexAppServerError("codex_mcp_inventory_invalid")
        arguments: list[str] = []
        for record in records:
            if not isinstance(record, dict) or record.get("enabled") is not True:
                continue
            name = str(record.get("name") or "")
            if not re.fullmatch(r"[A-Za-z0-9_-]+", name):
                raise CodexAppServerError("codex_mcp_server_name_unsupported")
            arguments.extend(("-c", f"mcp_servers.{name}.enabled=false"))
        return tuple(arguments)

    async def _resolve_command(self) -> tuple[str, ...]:
        if self._command:
            return self._command
        executable = self._resolve_executable()
        mcp_disable_args = await self._discover_mcp_disable_args(executable)
        return (
            executable,
            *mcp_disable_args,
            *_APP_SERVER_CONFIG_ARGS,
            "app-server",
        )

    @staticmethod
    def _child_environment() -> dict[str, str]:
        environment = dict(os.environ)
        for key in _FORBIDDEN_CHILD_ENV_KEYS:
            environment.pop(key, None)
        return environment

    async def _ensure_started(self) -> None:
        if self._closed:
            raise CodexAppServerError("codex_app_server_client_closed")
        if self._process is not None:
            if self._process.returncode is not None:
                raise CodexAppServerError("codex_app_server_process_exited")
            return
        async with self._start_lock:
            if self._process is not None:
                return
            command = await self._resolve_command()
            try:
                self._process = await asyncio.create_subprocess_exec(
                    *command,
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=self._temp_dir.name,
                    env=self._child_environment(),
                )
            except OSError as error:
                raise CodexAppServerError("codex_app_server_start_failed") from error
            self._reader_task = asyncio.create_task(self._read_stdout())
            self._stderr_task = asyncio.create_task(self._drain_stderr())
            await self._request(
                "initialize",
                {
                    "clientInfo": {
                        "name": "liquidaity_magentic_one",
                        "title": "LiquidAIty Magentic-One",
                        "version": "1",
                    },
                    "capabilities": {"experimentalApi": True},
                },
            )
            await self._notify("initialized", {})
            await self._run_preflight()

    async def _read_stdout(self) -> None:
        assert self._process is not None and self._process.stdout is not None
        try:
            while True:
                line = await self._process.stdout.readline()
                if not line:
                    break
                try:
                    message = json.loads(line.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError):
                    continue
                if not isinstance(message, dict):
                    continue
                request_id = message.get("id")
                if request_id is not None and "method" not in message:
                    future = self._pending.pop(request_id, None)
                    if future is not None and not future.done():
                        future.set_result(message)
                    continue
                if request_id is not None and isinstance(message.get("method"), str):
                    await self._send(
                        {
                            "id": request_id,
                            "error": {
                                "code": -32601,
                                "message": "LiquidAIty model transport does not expose server tools",
                            },
                        }
                    )
                    continue
                if isinstance(message.get("method"), str):
                    await self._notifications.put(message)
        finally:
            for future in list(self._pending.values()):
                if not future.done():
                    future.set_exception(
                        CodexAppServerError("codex_app_server_transport_closed")
                    )
            self._pending.clear()

    async def _drain_stderr(self) -> None:
        assert self._process is not None and self._process.stderr is not None
        while await self._process.stderr.readline():
            # Stderr can contain host/account diagnostics. Drain it to prevent
            # backpressure, but never retain or surface it.
            pass

    async def _send(self, message: dict[str, Any]) -> None:
        if self._process is None or self._process.stdin is None:
            raise CodexAppServerError("codex_app_server_transport_unavailable")
        payload = json.dumps(message, separators=(",", ":"), ensure_ascii=False)
        async with self._write_lock:
            self._process.stdin.write((payload + "\n").encode("utf-8"))
            try:
                await self._process.stdin.drain()
            except (BrokenPipeError, ConnectionResetError) as error:
                raise CodexAppServerError("codex_app_server_transport_closed") from error

    async def _notify(self, method: str, params: dict[str, Any]) -> None:
        await self._send({"method": method, "params": params})

    async def _request(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        if self._process is None or self._process.returncode is not None:
            raise CodexAppServerError("codex_app_server_transport_unavailable")
        request_id = self._next_request_id
        self._next_request_id += 1
        future: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        try:
            await self._send({"method": method, "id": request_id, "params": params})
            response = await asyncio.wait_for(future, timeout=self._request_timeout_seconds)
        except asyncio.TimeoutError as error:
            self._pending.pop(request_id, None)
            raise CodexAppServerError(f"codex_app_server_request_timeout:{method}") from error
        if "error" in response:
            raise CodexAppServerError(f"codex_app_server_request_failed:{method}")
        result = response.get("result")
        if not isinstance(result, dict):
            raise CodexAppServerError(f"codex_app_server_result_invalid:{method}")
        return result

    async def _run_preflight(self) -> None:
        # This process owns the normal Codex managed-account flow. Refresh
        # proactively so the first Magentic-One model turn cannot fall into the
        # external-client token callback, which this narrow model doorway does
        # not and must not implement by reading or copying raw account tokens.
        if self._model != _REQUIRED_MAG_ONE_MODEL:
            raise CodexAppServerError(
                f"codex_app_server_model_required:{_REQUIRED_MAG_ONE_MODEL}"
            )

        account_result = await self._request("account/read", {"refreshToken": True})
        account = account_result.get("account")
        if not isinstance(account, dict) or account.get("type") != "chatgpt":
            raise CodexAppServerError(
                "codex_chatgpt_auth_required: run codex login and choose ChatGPT"
            )
        plan_type = str(account.get("planType") or "unknown").strip().lower()
        if plan_type != _REQUIRED_CHATGPT_PLAN:
            raise CodexAppServerError(
                f"codex_chatgpt_plan_required:{_REQUIRED_CHATGPT_PLAN}"
            )

        cursor: str | None = None
        available_models: set[str] = set()
        while True:
            model_result = await self._request(
                "model/list",
                {"cursor": cursor, "includeHidden": True, "limit": 100},
            )
            for record in model_result.get("data", []):
                if isinstance(record, dict):
                    model_id = str(record.get("model") or record.get("id") or "").strip()
                    if model_id:
                        available_models.add(model_id)
            next_cursor = model_result.get("nextCursor")
            cursor = str(next_cursor) if next_cursor else None
            if not cursor:
                break
        if self._model not in available_models:
            raise CodexAppServerError(
                f"codex_app_server_model_unavailable:{self._model}"
            )

        self._preflight = {
            "authMode": "chatgpt",
            "planType": plan_type,
            "model": self._model,
        }

    async def preflight_metadata(self) -> dict[str, str]:
        await self._ensure_started()
        assert self._preflight is not None
        return dict(self._preflight)

    @staticmethod
    def _history_item(message: LLMMessage) -> dict[str, Any]:
        if isinstance(message, SystemMessage):
            return {
                "type": "message",
                "role": "developer",
                "content": [{"type": "input_text", "text": message.content}],
            }
        if isinstance(message, UserMessage):
            if not isinstance(message.content, str):
                raise CodexAppServerError("codex_app_server_multimodal_input_unsupported")
            return {
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": message.content}],
            }
        if isinstance(message, AssistantMessage):
            if not isinstance(message.content, str):
                raise CodexAppServerError("codex_app_server_function_history_unsupported")
            return {
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": message.content}],
            }
        raise CodexAppServerError(
            f"codex_app_server_message_type_unsupported:{type(message).__name__}"
        )

    @staticmethod
    def _strict_json_schema(value: Any) -> Any:
        if isinstance(value, list):
            return [
                CodexAppServerChatCompletionClient._strict_json_schema(item)
                for item in value
            ]
        if not isinstance(value, dict):
            return value
        strict = {
            key: CodexAppServerChatCompletionClient._strict_json_schema(item)
            for key, item in value.items()
        }
        if (
            strict.get("type") == "object"
            and "properties" in strict
            and "additionalProperties" not in strict
        ):
            strict["additionalProperties"] = False
        return strict

    @staticmethod
    def _output_schema(json_output: type[BaseModel] | bool | None) -> dict[str, Any] | None:
        if json_output is None or json_output is False:
            return None
        if json_output is True:
            return {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            }
        if isinstance(json_output, type) and issubclass(json_output, BaseModel):
            return CodexAppServerChatCompletionClient._strict_json_schema(
                json_output.model_json_schema()
            )
        raise CodexAppServerError("codex_app_server_output_schema_unsupported")

    async def _interrupt_turn(self, thread_id: str, turn_id: str) -> None:
        if not thread_id or not turn_id:
            return
        try:
            await self._request(
                "turn/interrupt",
                {"threadId": thread_id, "turnId": turn_id},
            )
        except CodexAppServerError:
            pass

    async def _interrupt_active_turn(self) -> None:
        thread_id = self._active_thread_id
        turn_id = self._active_turn_id
        if thread_id and turn_id:
            await self._interrupt_turn(thread_id, turn_id)

    async def _await_turn(
        self,
        *,
        thread_id: str,
        turn_id: str,
        cancellation_token: CancellationToken | None,
    ) -> tuple[dict[str, Any], RequestUsage]:
        usage = _empty_usage()
        loop = asyncio.get_running_loop()
        if cancellation_token is not None:
            cancellation_token.add_callback(
                lambda: loop.call_soon_threadsafe(
                    lambda: asyncio.create_task(
                        self._interrupt_turn(thread_id, turn_id)
                    )
                )
            )

        while True:
            try:
                notification = await asyncio.wait_for(
                    self._notifications.get(), timeout=self._request_timeout_seconds
                )
            except asyncio.TimeoutError as error:
                await self._interrupt_active_turn()
                raise CodexAppServerError("codex_app_server_turn_timeout") from error
            method = notification.get("method")
            params = notification.get("params")
            if not isinstance(params, dict) or params.get("threadId") != thread_id:
                continue
            if method == "thread/tokenUsage/updated" and params.get("turnId") == turn_id:
                token_usage = params.get("tokenUsage")
                last = token_usage.get("last") if isinstance(token_usage, dict) else None
                if isinstance(last, dict):
                    usage = RequestUsage(
                        prompt_tokens=max(0, int(last.get("inputTokens") or 0)),
                        completion_tokens=max(0, int(last.get("outputTokens") or 0)),
                    )
                continue
            if method != "turn/completed":
                continue
            turn = params.get("turn")
            if isinstance(turn, dict) and turn.get("id") == turn_id:
                return turn, usage

    @staticmethod
    def _final_agent_text(turn: dict[str, Any]) -> str:
        items = turn.get("items")
        if not isinstance(items, list):
            raise CodexAppServerError("codex_app_server_turn_items_invalid")
        forbidden_types = {
            "commandExecution",
            "dynamicToolCall",
            "fileChange",
            "mcpToolCall",
            "toolCall",
            "webSearch",
        }
        if any(isinstance(item, dict) and item.get("type") in forbidden_types for item in items):
            raise CodexAppServerError("codex_app_server_tool_activity_forbidden")
        texts = [
            str(item.get("text"))
            for item in items
            if isinstance(item, dict)
            and item.get("type") == "agentMessage"
            and isinstance(item.get("text"), str)
        ]
        if not texts:
            raise CodexAppServerError("codex_app_server_agent_message_missing")
        return texts[-1]

    async def create(
        self,
        messages: Sequence[LLMMessage],
        *,
        tools: Sequence[Tool | ToolSchema] = [],
        tool_choice: Tool | str = "auto",
        json_output: type[BaseModel] | bool | None = None,
        extra_create_args: dict[str, Any] = {},
        cancellation_token: CancellationToken | None = None,
    ) -> CreateResult:
        del tool_choice
        if tools:
            raise CodexAppServerError("codex_app_server_tools_unsupported")
        if extra_create_args:
            raise CodexAppServerError("codex_app_server_extra_create_args_unsupported")
        if not messages or not isinstance(messages[-1], UserMessage):
            raise CodexAppServerError("codex_app_server_final_user_message_required")
        final_user = messages[-1]
        if not isinstance(final_user.content, str):
            raise CodexAppServerError("codex_app_server_multimodal_input_unsupported")

        async with self._create_lock:
            await self._ensure_started()
            thread_result = await self._request(
                "thread/start",
                {
                    "model": self._model,
                    "modelProvider": "openai",
                    "allowProviderModelFallback": False,
                    "approvalPolicy": "never",
                    "sandbox": "read-only",
                    "cwd": str(Path(self._temp_dir.name).resolve()),
                    "runtimeWorkspaceRoots": [],
                    "environments": [],
                    "selectedCapabilityRoots": [],
                    "dynamicTools": [],
                    "ephemeral": True,
                    "personality": "none",
                    "baseInstructions": "",
                    "developerInstructions": "",
                    "serviceName": "liquidaity_magentic_one",
                    "config": {
                        "web_search": "disabled",
                        "tools": {"web_search": False, "view_image": False},
                        "features": {
                            "shell_tool": False,
                            "remote_plugin": False,
                        },
                        "agents": {"enabled": False},
                    },
                },
            )
            thread = thread_result.get("thread")
            thread_id = str(thread.get("id") or "") if isinstance(thread, dict) else ""
            if not thread_id:
                raise CodexAppServerError("codex_app_server_thread_id_missing")
            self._active_thread_id = thread_id

            history = [self._history_item(message) for message in messages[:-1]]
            if history:
                await self._request(
                    "thread/inject_items", {"threadId": thread_id, "items": history}
                )
            turn_params: dict[str, Any] = {
                "threadId": thread_id,
                "input": [{"type": "text", "text": final_user.content}],
                "approvalPolicy": "never",
                "environments": [],
                "runtimeWorkspaceRoots": [],
                "personality": "none",
            }
            if self._reasoning_effort is not None:
                turn_params["effort"] = self._reasoning_effort
            output_schema = self._output_schema(json_output)
            if output_schema is not None:
                turn_params["outputSchema"] = output_schema
            turn_result = await self._request("turn/start", turn_params)
            turn = turn_result.get("turn")
            turn_id = str(turn.get("id") or "") if isinstance(turn, dict) else ""
            if not turn_id:
                raise CodexAppServerError("codex_app_server_turn_id_missing")
            self._active_turn_id = turn_id
            try:
                completed_turn, usage = await self._await_turn(
                    thread_id=thread_id,
                    turn_id=turn_id,
                    cancellation_token=cancellation_token,
                )
            finally:
                self._active_turn_id = None
                self._active_thread_id = None

            status = completed_turn.get("status")
            if status == "interrupted":
                raise CodexAppServerError("codex_app_server_turn_interrupted")
            if status != "completed":
                raise CodexAppServerError("codex_app_server_turn_failed")
            content = self._final_agent_text(completed_turn)
            self._actual = _add_usage(self._actual, usage)
            self._total = _add_usage(self._total, usage)
            return CreateResult(
                finish_reason="stop",
                content=content,
                usage=usage,
                cached=False,
            )

    async def create_stream(
        self,
        messages: Sequence[LLMMessage],
        *,
        tools: Sequence[Tool | ToolSchema] = [],
        tool_choice: Tool | str = "auto",
        json_output: type[BaseModel] | bool | None = None,
        extra_create_args: dict[str, Any] = {},
        cancellation_token: CancellationToken | None = None,
    ) -> AsyncGenerator[str | CreateResult, None]:
        yield await self.create(
            messages,
            tools=tools,
            tool_choice=tool_choice,
            json_output=json_output,
            extra_create_args=extra_create_args,
            cancellation_token=cancellation_token,
        )

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        await self._interrupt_active_turn()
        process = self._process
        if process is not None:
            if process.stdin is not None:
                process.stdin.close()
            if process.returncode is None:
                try:
                    await asyncio.wait_for(process.wait(), timeout=3.0)
                except asyncio.TimeoutError:
                    process.terminate()
                    try:
                        await asyncio.wait_for(process.wait(), timeout=3.0)
                    except asyncio.TimeoutError:
                        process.kill()
                        await process.wait()
            else:
                await process.wait()
        for task in (self._reader_task, self._stderr_task):
            if task is not None and not task.done():
                task.cancel()
        await asyncio.gather(
            *(task for task in (self._reader_task, self._stderr_task) if task is not None),
            return_exceptions=True,
        )
        self._temp_dir.cleanup()

    def actual_usage(self) -> RequestUsage:
        return self._actual

    def total_usage(self) -> RequestUsage:
        return self._total

    def count_tokens(
        self,
        messages: Sequence[LLMMessage],
        *,
        tools: Sequence[Tool | ToolSchema] = [],
    ) -> int:
        del messages, tools
        raise CodexAppServerError("codex_app_server_token_count_unavailable")

    def remaining_tokens(
        self,
        messages: Sequence[LLMMessage],
        *,
        tools: Sequence[Tool | ToolSchema] = [],
    ) -> int:
        del messages, tools
        raise CodexAppServerError("codex_app_server_token_count_unavailable")

    @property
    def capabilities(self) -> ModelCapabilities:  # type: ignore[override]
        return self._model_info

    @property
    def model_info(self) -> ModelInfo:
        return self._model_info
