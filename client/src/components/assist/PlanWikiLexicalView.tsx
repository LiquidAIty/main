import React, { useMemo } from "react";
import { LinkNode } from "@lexical/link";
import { $createListItemNode, $createListNode, ListItemNode, ListNode } from "@lexical/list";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { $createHeadingNode, HeadingNode, QuoteNode } from "@lexical/rich-text";
import { $createParagraphNode, $createTextNode, $getRoot } from "lexical";

type PlanWikiLexicalViewProps = {
  source: unknown;
  fallbackText: string;
  textColor: string;
  mutedColor: string;
  emptyText?: string;
};

type NormalizedPlanWikiDocument = {
  serializedEditorState: string | null;
  plainText: string;
  signature: string;
};

function safeText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const json = JSON.stringify(value);
    if (typeof json === "string") return json;
  } catch {
    // fall through
  }
  return String(value);
}

function isLexicalSerializedState(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const root = (value as any).root;
  return Boolean(root && typeof root === "object" && root.type === "root" && Array.isArray(root.children));
}

function parseLexicalSerializedState(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      return isLexicalSerializedState(parsed) ? JSON.stringify(parsed) : null;
    } catch {
      return null;
    }
  }
  if (isLexicalSerializedState(value)) {
    return JSON.stringify(value);
  }
  return null;
}

function pickPlanWikiEditorState(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const planObj = input as any;
  return (
    parseLexicalSerializedState(planObj.editorState) ??
    parseLexicalSerializedState(planObj.editor_state) ??
    parseLexicalSerializedState(planObj.lexical) ??
    parseLexicalSerializedState(planObj.lexicalState) ??
    parseLexicalSerializedState(planObj.lexical_state) ??
    parseLexicalSerializedState(planObj.planWikiState) ??
    parseLexicalSerializedState(planObj.plan_wiki_state) ??
    parseLexicalSerializedState(planObj.documentState) ??
    parseLexicalSerializedState(planObj.document_state) ??
    parseLexicalSerializedState(planObj.document)
  );
}

function pickPlanWikiText(input: unknown, fallbackText: string): string {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const planObj = input as any;
    const candidate = safeText(
      planObj.anchor ??
        planObj.anchorText ??
        planObj.anchor_text ??
        planObj.planWiki ??
        planObj.plan_wiki ??
        planObj.memo ??
        planObj.article ??
        planObj.summary ??
        planObj.body ??
        planObj.text,
    ).trim();
    if (candidate) return candidate;
  }
  if (typeof input === "string") {
    const candidate = input.trim();
    if (candidate) return candidate;
  }
  return fallbackText.trim();
}

function hashSignature(input: string): string {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) | 0;
  }
  return `${input.length}:${hash}`;
}

function normalizePlanWikiDocument(
  input: unknown,
  fallbackText: string,
  emptyText: string,
): NormalizedPlanWikiDocument {
  const serializedEditorState = pickPlanWikiEditorState(input);
  const plainText = pickPlanWikiText(input, fallbackText) || emptyText;
  const signature = serializedEditorState
    ? `json:${hashSignature(serializedEditorState)}`
    : `text:${hashSignature(plainText)}`;
  return { serializedEditorState, plainText, signature };
}

function appendParagraph(text: string): void {
  const paragraph = $createParagraphNode();
  paragraph.append($createTextNode(text));
  $getRoot().append(paragraph);
}

function appendBulletList(lines: string[]): void {
  const list = $createListNode("bullet");
  lines.forEach((line) => {
    const item = $createListItemNode();
    item.append($createTextNode(line.replace(/^[-*]\s+/, "").trim()));
    list.append(item);
  });
  $getRoot().append(list);
}

function buildPlainTextEditorState(text: string): () => void {
  return () => {
    const root = $getRoot();
    root.clear();

    const normalized = text.replace(/\r\n/g, "\n").trim();
    if (!normalized) {
      appendParagraph("");
      return;
    }

    const blocks = normalized
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean);

    blocks.forEach((block) => {
      const lines = block
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length === 0) return;

      const headingMatch = lines[0].match(/^(#{1,3})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const heading = $createHeadingNode(level === 1 ? "h1" : level === 2 ? "h2" : "h3");
        heading.append($createTextNode(headingMatch[2].trim()));
        root.append(heading);
        const remainingLines = lines.slice(1);
        if (remainingLines.length === 0) return;
        if (remainingLines.every((line) => /^[-*]\s+/.test(line))) {
          appendBulletList(remainingLines);
        } else {
          appendParagraph(remainingLines.join(" "));
        }
        return;
      }

      if (lines.every((line) => /^[-*]\s+/.test(line))) {
        appendBulletList(lines);
        return;
      }

      appendParagraph(lines.join(" "));
    });
  };
}

export default function PlanWikiLexicalView({
  source,
  fallbackText,
  textColor,
  mutedColor,
  emptyText = "No plan text yet.",
}: PlanWikiLexicalViewProps) {
  const document = useMemo(
    () => normalizePlanWikiDocument(source, fallbackText, emptyText),
    [source, fallbackText, emptyText],
  );

  const initialConfig = useMemo(
    () => ({
      namespace: "AssistPlanWiki",
      editable: false,
      theme: {},
      onError(error: Error) {
        console.error("[PlanWikiLexical]", error);
      },
      nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode],
      editorState: document.serializedEditorState ?? buildPlainTextEditorState(document.plainText),
    }),
    [document],
  );

  return (
    <LexicalComposer key={document.signature} initialConfig={initialConfig}>
      <RichTextPlugin
        contentEditable={
          <ContentEditable
            aria-label="Assist PlanWiki document"
            style={{
              color: textColor,
              lineHeight: 1.65,
              fontSize: 14,
              outline: "none",
              minHeight: 120,
            }}
          />
        }
        placeholder={
          <div style={{ color: mutedColor, fontSize: 14 }}>
            {emptyText}
          </div>
        }
        ErrorBoundary={LexicalErrorBoundary}
      />
    </LexicalComposer>
  );
}
