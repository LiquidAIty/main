AUTOGEN_TASK = {
    "name": "autogen_task",
    "description": (
        "Delegate work to LiquidAIty's AutoGen subsystem. "
        "Use mode='single' to run one existing saved AutoGen specialist Card. "
        "Use mode='magentic_one' when a coordinated AutoGen Mag One team is useful. "
        "This does not replace native Hermes delegate_task; use normal Hermes delegation "
        "for Hermes-native subagents."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "mode": {
                "type": "string",
                "enum": ["single", "magentic_one"],
                "description": (
                    "'single' runs one saved AutoGen Card. "
                    "'magentic_one' runs the connected Mag One team."
                ),
            },
            "goal": {
                "type": "string",
                "description": (
                    "Specific work for the AutoGen agent or team to perform."
                ),
            },
            "targetCardId": {
                "type": "string",
                "description": (
                    "Required only for mode='single'. "
                    "Exact saved LiquidAIty Card ID to run."
                ),
            },
            "dataAnchors": {
                "type": "array",
                "description": (
                    "Optional explicit bounded native graph references to pass through "
                    "the existing LiquidAIty Card/Mag One execution path."
                ),
                "items": {
                    "type": "object",
                    "properties": {
                        "authority": {
                            "type": "string",
                            "enum": ["ThinkGraph", "KnowGraph", "CodeGraph"],
                        },
                        "nativeId": {"type": "string"},
                        "reason": {"type": "string"},
                        "priority": {"type": "integer"},
                        "boundedExpansion": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 3,
                        },
                        "resultLimit": {
                            "type": "integer",
                            "minimum": 1,
                            "maximum": 24,
                        },
                        "required": {"type": "boolean"},
                    },
                    "required": [
                        "authority",
                        "nativeId",
                        "reason",
                    ],
                },
            },
        },
        "required": ["mode", "goal"],
    },
}
