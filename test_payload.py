import requests

payload = {
    "cardRuntime": {
        "cardId": "test_card",
        "title": "Magentic Test",
        "runtimeType": "magentic_one",
        "prompt": "are you able to write a plan on how to use a knowledge graph",
        "runtimeOptions": {
            "maxTokens": 0,
            "provider": "openai",
            "modelId": "gpt-5.1-chat"
        },
        "magentic": {
            "callableHeads": [
                {
                    "cardId": "worker1",
                    "title": "worker1",
                    "runtimeType": "assistant_agent",
                    "runtimeBinding": {
                        "provider": "openai",
                        "modelId": "gpt-5.1-chat",
                        "maxTokens": 0
                    },
                    "role": "assistant"
                }
            ],
            "unsupportedCallableHeads": []
        },
        "participants": [
            {
                "cardId": "worker1",
                "title": "worker1",
                "runtimeType": "assistant_agent",
                "runtimeBinding": {
                    "provider": "openai",
                    "modelId": "gpt-5.1-chat",
                    "maxTokens": 0
                },
                "role": "assistant"
            }
        ]
    }
}

try:
    response = requests.post("http://localhost:8003/autogen/orchestrate", json=payload, timeout=10)
    print("Status Code:", response.status_code)
    print("Response JSON:", response.text)
except Exception as e:
    print("Error:", e)
