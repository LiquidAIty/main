// Episode 1 conductor — appends ONE labeled stand-in message to the ep1 conversation
// through the REAL conversation store, and prints the input-context + output sizes for
// the telemetry ledger. Reusable per chat rung via env: EP1_ROLE, EP1_CONTENT,
// EP1_RUNG, EP1_INPUT_CHARS (size of context handed to this position), EP1_PARENT.
import '../config/env';
import { appendMessage, getConversationMessages } from '../conversations/store';

const ADMIN = '20ac92da-01fd-4cf6-97cc-0672421e751a';
const CONV = process.env.EP1_CONV || 'ep1-graph-output-guarantee';

async function main() {
  const role = (process.env.EP1_ROLE || 'user') as 'user' | 'assistant';
  const content = process.env.EP1_CONTENT || '';
  const rung = process.env.EP1_RUNG || '?';
  const inputChars = Number(process.env.EP1_INPUT_CHARS || 0);
  const parent = process.env.EP1_PARENT || null;
  const before = (await getConversationMessages(ADMIN, CONV)).length;
  const msg = await appendMessage({
    projectId: ADMIN,
    conversationId: CONV,
    role,
    content,
    parentMessageId: parent,
    visibleActivities: [
      { kind: 'standin', label: `ep1 rung ${rung} (${role})`, status: 'complete', detail: `production_path=standin_boundary; input_ctx=${inputChars} chars; output=${content.length} chars` },
    ],
  });
  console.log(JSON.stringify({ rung, role, messageId: msg.messageId, input_ctx_chars: inputChars, output_chars: content.length, conv: CONV, total_after: before + 1 }));
}
main().then(() => process.exit(0)).catch((e) => { console.error('EP1_FAILED', e?.stack || e); process.exit(1); });
