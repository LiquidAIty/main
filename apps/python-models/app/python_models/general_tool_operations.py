"""Basic general-purpose Python tool handlers and definitions."""

from __future__ import annotations

import ast
import math
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
_MAX_EXPRESSION_LENGTH = 512
_MAX_EXPRESSION_NODES = 128
_MAX_EXPRESSION_DEPTH = 16
_MAX_ABS_EXPONENT = 1000


def _finite_result(value: Any) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("calculator_result_nonfinite")
    return number


def _eval_arithmetic(node: ast.AST, depth: int = 0) -> float:
    if depth > _MAX_EXPRESSION_DEPTH:
        raise ValueError("calculator_expression_too_deep")
    if isinstance(node, ast.Expression):
        return _eval_arithmetic(node.body, depth + 1)
    if (
        isinstance(node, ast.Constant)
        and isinstance(node.value, (int, float))
        and not isinstance(node.value, bool)
    ):
        return _finite_result(node.value)
    if isinstance(node, ast.BinOp) and type(node.op) in _SAFE_BIN_OPS:
        left = _eval_arithmetic(node.left, depth + 1)
        right = _eval_arithmetic(node.right, depth + 1)
        if isinstance(node.op, ast.Pow) and abs(right) > _MAX_ABS_EXPONENT:
            raise ValueError("calculator_exponent_too_large")
        return _finite_result(_SAFE_BIN_OPS[type(node.op)](left, right))
    if isinstance(node, ast.UnaryOp) and type(node.op) in _SAFE_UNARY_OPS:
        return _finite_result(
            _SAFE_UNARY_OPS[type(node.op)](
                _eval_arithmetic(node.operand, depth + 1)
            )
        )
    raise ValueError(f"calculator_unsupported_expression: {ast.dump(node)}")


def tool_current_datetime() -> str:
    """Return the current UTC date and time in ISO-8601 format."""

    return datetime.now(timezone.utc).isoformat()


def tool_calculator(expression: str) -> str:
    """Evaluate a basic arithmetic expression."""

    if not isinstance(expression, str) or not expression.strip():
        raise ValueError("calculator_expression_required")
    if len(expression) > _MAX_EXPRESSION_LENGTH:
        raise ValueError("calculator_expression_too_long")
    try:
        parsed = ast.parse(expression, mode="eval")
    except (SyntaxError, ValueError, RecursionError) as error:
        raise ValueError("calculator_expression_invalid") from error
    if sum(1 for _node in ast.walk(parsed)) > _MAX_EXPRESSION_NODES:
        raise ValueError("calculator_expression_too_complex")
    try:
        return str(_eval_arithmetic(parsed))
    except (OverflowError, RecursionError, ZeroDivisionError) as error:
        raise ValueError("calculator_expression_invalid") from error


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
                "properties": {"expression": {
                    "type": "string", "minLength": 1,
                    "maxLength": _MAX_EXPRESSION_LENGTH,
                }},
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
