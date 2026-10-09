"""Basic general-purpose Python tool handlers and definitions."""

from __future__ import annotations

import ast
import operator
from datetime import datetime, timezone
from typing import Any, Callable

from app.python_models.operation_definition import OperationDefinition

_SAFE_BIN_OPS: dict[type[ast.AST], Callable[[Any, Any], Any]] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_SAFE_UNARY_OPS: dict[type[ast.AST], Callable[[Any], Any]] = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
}


def _eval_arithmetic(node: ast.AST) -> float:
    if isinstance(node, ast.Expression):
        return _eval_arithmetic(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    if isinstance(node, ast.BinOp) and type(node.op) in _SAFE_BIN_OPS:
        return _SAFE_BIN_OPS[type(node.op)](
            _eval_arithmetic(node.left), _eval_arithmetic(node.right)
        )
    if isinstance(node, ast.UnaryOp) and type(node.op) in _SAFE_UNARY_OPS:
        return _SAFE_UNARY_OPS[type(node.op)](_eval_arithmetic(node.operand))
    raise ValueError(f"calculator_unsupported_expression: {ast.dump(node)}")


def tool_current_datetime() -> str:
    """Return the current UTC date and time in ISO-8601 format."""

    return datetime.now(timezone.utc).isoformat()


def tool_calculator(expression: str) -> str:
    """Evaluate a basic arithmetic expression."""

    return str(_eval_arithmetic(ast.parse(expression, mode="eval")))


def _annotations(
    *, read_only: bool, destructive: bool, idempotent: bool, open_world: bool,
) -> dict[str, bool]:
    return {
        "readOnlyHint": read_only,
        "destructiveHint": destructive,
        "idempotentHint": idempotent,
        "openWorldHint": open_world,
    }
def general_tool_operation_definitions() -> list[OperationDefinition]:
    internal = frozenset({"internal-plugin"})
    read_closed = _annotations(
        read_only=True, destructive=False, idempotent=True, open_world=False,
    )
    return [
        OperationDefinition(
            canonical_id="current_datetime",
            title="Current date and time",
            description="Return the current UTC date and time in ISO-8601 format.",
            parameters_schema={
                "type": "object", "properties": {}, "required": [],
                "additionalProperties": False,
            },
            output_schema={"type": "string", "description": "ISO-8601 UTC datetime"},
            handler=tool_current_datetime,
            available=True,
            publishers=internal,
            access="read",
            namespace="python",
            external_source_id="python_runtime",
            annotations=read_closed,
        ),
        OperationDefinition(
            canonical_id="calculator",
            title="Calculator",
            description="Evaluate a basic arithmetic expression and return the numeric result.",
            parameters_schema={
                "type": "object",
                "properties": {"expression": {"type": "string"}},
                "required": ["expression"],
                "additionalProperties": False,
            },
            output_schema={"type": "string", "description": "numeric result as a string"},
            handler=tool_calculator,
            available=True,
            publishers=internal,
            access="read",
            namespace="python",
            external_source_id="python_runtime",
            annotations=read_closed,
        ),
    ]
