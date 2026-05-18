import React from "react";
import {
  getLastFrontendCrash,
  reportFrontendCrash,
  type FrontendCrashRecord,
} from "../../lib/frontendCrashDiagnostics";

type FrontendCrashBoundaryProps = {
  children: React.ReactNode;
  scopeLabel?: string;
};

type FrontendCrashBoundaryState = {
  error: Error | null;
  componentStack?: string;
  crashRecord: FrontendCrashRecord | null;
};

function firstStackLines(stack?: string, maxLines = 6): string {
  if (!stack) return "";
  return stack
    .split("\n")
    .slice(0, maxLines)
    .join("\n")
    .trim();
}

function buildCopyableCrashText(
  error: Error | null,
  crashRecord: FrontendCrashRecord | null,
  componentStack?: string,
): string {
  const lines = [
    "LiquidAIty caught a frontend crash",
    `message: ${error?.message || crashRecord?.message || "unknown error"}`,
    `route: ${crashRecord?.route || (typeof window !== "undefined" ? window.location.pathname : "")}`,
    `href: ${crashRecord?.href || (typeof window !== "undefined" ? window.location.href : "")}`,
    `projectId: ${crashRecord?.projectId ?? "n/a"}`,
    `activeDeckOrCanvasId: ${crashRecord?.activeDeckOrCanvasId ?? "n/a"}`,
  ];
  const stack = firstStackLines(error?.stack || crashRecord?.stack);
  if (stack) {
    lines.push("stack:");
    lines.push(stack);
  }
  if (componentStack) {
    lines.push("componentStack:");
    lines.push(componentStack.trim());
  }
  return lines.join("\n");
}

export default class FrontendCrashBoundary extends React.Component<
  FrontendCrashBoundaryProps,
  FrontendCrashBoundaryState
> {
  state: FrontendCrashBoundaryState = {
    error: null,
    componentStack: undefined,
    crashRecord: null,
  };

  static getDerivedStateFromError(error: Error): FrontendCrashBoundaryState {
    return {
      error,
      componentStack: undefined,
      crashRecord: getLastFrontendCrash(),
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const record = reportFrontendCrash({
      type: "react_error_boundary",
      message: error.message || "React render error",
      stack: error.stack,
      componentStack: info.componentStack || undefined,
    });
    this.setState({
      error,
      componentStack: info.componentStack || undefined,
      crashRecord: record,
    });
  }

  render() {
    const { error, componentStack, crashRecord } = this.state;
    if (!error) return this.props.children;

    const effectiveRecord = crashRecord || getLastFrontendCrash();
    const copyText = buildCopyableCrashText(error, effectiveRecord, componentStack);
    const scope = this.props.scopeLabel ? `${this.props.scopeLabel}: ` : "";

    return (
      <div
        data-testid="frontend-crash-panel"
        style={{
          minHeight: "100vh",
          width: "100%",
          padding: 16,
          background: "#0d1117",
          color: "#e6edf3",
          boxSizing: "border-box",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace",
        }}
      >
        <div
          style={{
            maxWidth: 980,
            margin: "0 auto",
            border: "1px solid #30363d",
            borderRadius: 10,
            background: "#161b22",
            padding: 14,
          }}
        >
          <h2 style={{ margin: "0 0 8px 0", fontSize: 18 }}>
            LiquidAIty caught a frontend crash
          </h2>
          <div style={{ marginBottom: 10, color: "#f85149", fontWeight: 700 }}>
            {scope}
            {error.message || "Unknown frontend error"}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.5 }}>
            <div>Route: {effectiveRecord?.route || "n/a"}</div>
            <div>Project ID: {effectiveRecord?.projectId || "n/a"}</div>
            <div>
              Active deck/canvas: {effectiveRecord?.activeDeckOrCanvasId || "n/a"}
            </div>
          </div>
          {firstStackLines(error.stack || effectiveRecord?.stack) ? (
            <pre
              style={{
                marginTop: 12,
                padding: 10,
                borderRadius: 8,
                background: "#0d1117",
                border: "1px solid #30363d",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: 12,
              }}
            >
              {firstStackLines(error.stack || effectiveRecord?.stack)}
            </pre>
          ) : null}
          {componentStack ? (
            <pre
              style={{
                marginTop: 8,
                padding: 10,
                borderRadius: 8,
                background: "#0d1117",
                border: "1px solid #30363d",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: 12,
              }}
            >
              {componentStack.trim()}
            </pre>
          ) : null}
          <div style={{ marginTop: 10, fontSize: 12 }}>
            Recovery: refresh once; if it still fails, copy the crash text below
            into Codex.
          </div>
          <textarea
            readOnly
            value={copyText}
            style={{
              marginTop: 8,
              width: "100%",
              minHeight: 150,
              resize: "vertical",
              borderRadius: 8,
              border: "1px solid #30363d",
              background: "#0d1117",
              color: "#e6edf3",
              padding: 10,
              boxSizing: "border-box",
              fontSize: 12,
            }}
          />
        </div>
      </div>
    );
  }
}
