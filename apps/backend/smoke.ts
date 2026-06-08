import fetch from 'node-fetch';

async function main() {
  const url = 'http://localhost:4000/api/projects/smoke_project/decks/smoke_deck/run';
  
  const payload = {
    input: "test",
    templates: [
      {
        id: "tmpl_test",
        name: "Test Template",
        tools: []
      }
    ],
    document: {
      id: "smoke_deck",
      name: "Smoke Deck",
      nodes: [
        {
          id: "card_1",
          kind: "agent",
          templateId: "tmpl_test",
          title: "Smoke Test Card",
          runtimeType: "magentic_one",
          prompt: "test prompt"
        }
      ],
      edges: []
    }
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    console.log('Status:', res.status);
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      console.log('Response Keys:', Object.keys(json));
      if (json.run) {
        console.log('Run Status:', json.run.status);
        console.log('Run keys:', Object.keys(json.run));
      }
      if (!res.ok) {
        console.log('Error Body:', json);
      }
    } catch {
      console.log('Raw text:', text);
    }
  } catch (err) {
    console.log('Fetch failed:', err.message);
  }
}

main().catch(console.error);
