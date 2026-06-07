import json
from app.python_models.orchestration_contracts import ContextPack
from app.python_models.autogen_orchestrator import _context_payload_json

with open('mock.json', 'r') as f:
    data = json.load(f)

pack = ContextPack.model_validate(data)

print('PAYLOAD:')
print(_context_payload_json(pack))
