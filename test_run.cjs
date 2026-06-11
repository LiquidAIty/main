
const d = require("./deck.json");
const templates = d.deck.promptTemplates ? d.deck.promptTemplates.map(t => ({...t, id: t.id.replace("prompt_", "template_")})) : [];

d.deck.edges.forEach(e => {
  if (e.edgeType === "magentic_option" && e.target === "card_magentic") {
    const oldSource = e.source;
    e.source = "card_magentic";
    e.target = oldSource;
  }
});

async function runTask(input) {
  const body = {
    deckId: "deck_builder",
    document: d.deck,
    templates: templates,
    input: input
  };
  const r = await fetch("http://localhost:4000/api/projects/20ac92da-01fd-4cf6-97cc-0672421e751a/decks/deck_builder/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  console.log("Status:", r.status);
  const reader = r.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let done = false;
  let finalData = "";
  while (!done) {
    const { value, done: doneReading } = await reader.read();
    done = doneReading;
    if (value) {
      finalData += decoder.decode(value, { stream: true });
    }
  }
  const chunks = finalData.split("\n").filter(Boolean);
  const lastChunk = JSON.parse(chunks[chunks.length - 1]);
  if (lastChunk.run) {
    console.log("Input:", input);
    console.log("Run Status:", lastChunk.run.status);
    console.log("Run Error:", lastChunk.run.error);
    if (lastChunk.run.status === "error") {
      console.log("UI WILL SHOW => Magentic-One run failed:", lastChunk.run.error);
    } else {
      console.log("UI WILL SHOW => Magentic-One run completed. Result:", lastChunk.run.finalOutput);
    }
    const magenticCard = lastChunk.run.cardResults && lastChunk.run.cardResults["card_magentic"];
    console.log("Trace returned:", magenticCard && magenticCard.magenticTrace ? "Yes" : "No");
    if (magenticCard && magenticCard.raw) {
      console.log("Raw LLM output:", JSON.stringify(magenticCard.raw, null, 2));
    }
    console.log("-----------------------------------------");
  } else {
    console.log("Raw Response Error:", lastChunk);
  }
}

async function main() {
  await runTask("I am looking to do some research on optical computing");
  await runTask("Run a Magentic-One proof test. Report resolved participants, whether Python AutoGen was called, whether MagenticOneGroupChat was used, and show trace fields returned. If missing, say exactly what is missing.");
}
main().catch(console.error);

