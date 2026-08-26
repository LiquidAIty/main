from __future__ import annotations

from .schemas import AUTOGEN_TASK
from .tools import autogen_task


def register(ctx) -> None:
    def handler(args, **kwargs):
        return autogen_task(ctx, args, **kwargs)

    ctx.register_tool(
        name="autogen_task",
        toolset="liquidaity-autogen",
        schema=AUTOGEN_TASK,
        handler=handler,
    )
