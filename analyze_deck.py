import json

with open('deck_dump.json', 'r') as f:
    data = json.load(f)

# data is dict of deckId -> deck
deck_id = list(data.keys())[0]
deck = data[deck_id]

print(f"Deck ID: {deck_id}")
print(f"Node count: {len(deck['nodes'])}")
print(f"Edge count: {len(deck['edges'])}")
print("\n--- NODES ---")

nodes_dict = {n['id']: n for n in deck['nodes']}

for node in deck['nodes']:
    runtimeType = node.get('runtimeType', 'assistant_agent')
    prompt = node.get('prompt', '')
    runtimeOptions = node.get('runtimeOptions', {})
    has_prompt = "yes" if prompt.strip() else "no"
    has_model = "yes" if (runtimeOptions and runtimeOptions.get('modelKey')) else "no"
    
    can_be_autogen = "yes" if runtimeType in ["assistant_agent", "local_coder"] else "no"
    
    print(f"ID: {node['id']}")
    print(f"Title: {node.get('title', '')}")
    print(f"Kind: {node.get('kind', '')}")
    print(f"RuntimeType: {runtimeType}")
    print(f"Prompt present: {has_prompt}")
    print(f"Model config present: {has_model}")
    print(f"Can be AutoGen participant: {can_be_autogen}")
    print("-")

print("\n--- EDGES ---")
for edge in deck['edges']:
    source_node = nodes_dict.get(edge['source'], {}).get('title', 'Unknown')
    target_node = nodes_dict.get(edge['target'], {}).get('title', 'Unknown')
    edgeType = edge.get('edgeType', 'flow')
    
    runtime_uses = "no"
    meaning = ""
    if edgeType == 'magentic_option':
        # runtime uses it if source is magentic_one
        source_runtime = nodes_dict.get(edge['source'], {}).get('runtimeType', '')
        target_runtime = nodes_dict.get(edge['target'], {}).get('runtimeType', '')
        if source_runtime == 'magentic_one' and target_runtime in ['assistant_agent', 'local_coder']:
            runtime_uses = "yes"
            meaning = "Includes target as an AutoGen worker participant in Magentic-One."
        else:
            runtime_uses = "no (source must be Magentic-One and target must be assistant/coder for runtime to resolve it)"
    else:
        runtime_uses = "no (only magentic_option from Magentic-One is resolved for participants)"
        
    print(f"ID: {edge['id']}")
    print(f"Source: {edge['source']} ({source_node})")
    print(f"Target: {edge['target']} ({target_node})")
    print(f"Source Handle: {edge.get('sourceHandle')}")
    print(f"Target Handle: {edge.get('targetHandle')}")
    print(f"Edge Type: {edgeType}")
    print(f"Runtime Uses Edge: {runtime_uses}")
    if meaning:
        print(f"Meaning: {meaning}")
    print("-")
