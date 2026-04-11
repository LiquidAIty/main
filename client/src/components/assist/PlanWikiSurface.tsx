import type { ReactNode } from "react";

import type { StructuredAssistPlanSurface } from "../builder/assistPlanSurface";

type PlanWikiSurfaceProps = {
  structuredPlan: StructuredAssistPlanSurface;
  document: ReactNode | null;
  colors: {
    primary: string;
    bg: string;
    panel: string;
    border: string;
    text: string;
    neutral: string;
    warn: string;
  };
};

type PlanSectionModel = {
  key:
    | "whatMattersNow"
    | "research"
    | "assumptions"
    | "openQuestions"
    | "humanTasks"
    | "agentTasks"
    | "pathOptions"
    | "whatChanged"
    | "sources";
  title: string;
  items: string[];
  tone?: "neutral" | "accent" | "warn";
};

function renderItemList(
  sectionKey: string,
  items: string[],
  textColor: string,
  borderColor: string,
  background: string,
) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {items.map((item, index) => (
        <div
          key={`${sectionKey}-${index}`}
          data-plan-item={sectionKey}
          data-plan-item-index={index}
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: `1px solid ${borderColor}`,
            background,
            color: textColor,
            lineHeight: 1.6,
            overflowWrap: "anywhere",
            textWrap: "pretty",
          }}
        >
          {item}
        </div>
      ))}
    </div>
  );
}

function buildSectionModels(
  structuredPlan: StructuredAssistPlanSurface,
): PlanSectionModel[] {
  const sections: PlanSectionModel[] = [
    {
      key: "whatMattersNow",
      title: "What Matters Now",
      items: structuredPlan.whatMattersNow,
      tone: "accent",
    },
    {
      key: "research",
      title: "Research",
      items: structuredPlan.research,
    },
    {
      key: "assumptions",
      title: "Assumptions",
      items: structuredPlan.assumptions,
    },
    {
      key: "openQuestions",
      title: "Open Questions",
      items: structuredPlan.openQuestions,
      tone: "warn",
    },
    {
      key: "humanTasks",
      title: "Human Tasks",
      items: structuredPlan.humanTasks,
    },
    {
      key: "agentTasks",
      title: "Agent Tasks",
      items: structuredPlan.agentTasks,
      tone: "accent",
    },
    {
      key: "pathOptions",
      title: "Path Options",
      items: structuredPlan.pathOptions,
    },
    {
      key: "whatChanged",
      title: "What Changed",
      items: structuredPlan.whatChanged,
    },
    {
      key: "sources",
      title: "Sources",
      items: structuredPlan.sources,
    },
  ];
  return sections.filter((section) => section.items.length > 0);
}

export default function PlanWikiSurface({
  structuredPlan,
  document,
  colors,
}: PlanWikiSurfaceProps) {
  const sectionModels = buildSectionModels(structuredPlan);
  const summaryChips = [
    structuredPlan.openQuestions.length > 0
      ? `${structuredPlan.openQuestions.length} open question${
          structuredPlan.openQuestions.length === 1 ? "" : "s"
        }`
      : "",
    structuredPlan.sources.length > 0
      ? `${structuredPlan.sources.length} source${structuredPlan.sources.length === 1 ? "" : "s"}`
      : "",
    structuredPlan.whatChanged.length > 0
      ? `${structuredPlan.whatChanged.length} recent change${
          structuredPlan.whatChanged.length === 1 ? "" : "s"
        }`
      : "",
  ].filter(Boolean);

  const hasOverview =
    Boolean(structuredPlan.goal) ||
    structuredPlan.nextMove.length > 0 ||
    summaryChips.length > 0;
  const hasDocument =
    structuredPlan.hasExplicitPlanDocument || structuredPlan.explicitPlanText.trim().length > 0;
  const hasAnyContent = hasOverview || sectionModels.length > 0 || hasDocument;

  if (!hasAnyContent) {
    return (
      <section
        data-plan-surface="wiki"
        style={{
          display: "grid",
          gap: 14,
        }}
      >
        <article
          id="plan-section-empty"
          data-plan-section="empty"
          style={{
            border: `1px solid ${colors.border}`,
            borderRadius: 16,
            padding: "18px 20px",
            background:
              "linear-gradient(180deg, rgba(79,162,173,0.08) 0%, rgba(31,31,31,0.96) 100%)",
            color: colors.neutral,
            lineHeight: 1.65,
          }}
        >
          No plan notes yet.
        </article>
      </section>
    );
  }

  return (
    <section
      data-plan-surface="wiki"
      style={{
        display: "grid",
        gap: 16,
      }}
    >
      {hasOverview ? (
        <article
          id="plan-section-overview"
          data-plan-section="overview"
          style={{
            border: `1px solid rgba(79,162,173,0.24)`,
            borderRadius: 18,
            padding: "18px 20px",
            background:
              "linear-gradient(180deg, rgba(79,162,173,0.12) 0%, rgba(31,31,31,0.98) 100%)",
            boxShadow: "0 18px 40px rgba(0,0,0,0.18)",
          }}
        >
          <div
            style={{
              color: colors.primary,
              fontSize: 11,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              fontWeight: 700,
              marginBottom: 10,
            }}
          >
            Working Plan
          </div>
          {structuredPlan.goal ? (
            <div
              id="plan-section-goal"
              data-plan-section="goal"
              style={{
                color: colors.text,
                fontSize: 22,
                lineHeight: 1.2,
                fontWeight: 700,
                textWrap: "balance",
              }}
            >
              {structuredPlan.goal}
            </div>
          ) : null}
          {summaryChips.length > 0 ? (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginTop: structuredPlan.goal ? 14 : 0,
              }}
            >
              {summaryChips.map((chip) => (
                <div
                  key={chip}
                  style={{
                    border: `1px solid rgba(79,162,173,0.2)`,
                    borderRadius: 999,
                    padding: "6px 10px",
                    color: colors.neutral,
                    background: "rgba(255,255,255,0.03)",
                    fontSize: 12,
                    lineHeight: 1.2,
                  }}
                >
                  {chip}
                </div>
              ))}
            </div>
          ) : null}
          {structuredPlan.nextMove.length > 0 ? (
            <div
              id="plan-section-nextMove"
              data-plan-section="nextMove"
              style={{
                marginTop: 16,
                display: "grid",
                gap: 8,
              }}
            >
              <div
                style={{
                  color: colors.neutral,
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  fontWeight: 700,
                }}
              >
                Next Move
              </div>
              <div
                style={{
                  display: "grid",
                  gap: 8,
                }}
              >
                {structuredPlan.nextMove.map((item, index) => (
                  <div
                    key={`next-move-${index}`}
                    data-plan-item="nextMove"
                    data-plan-item-index={index}
                    style={{
                      color: colors.text,
                      lineHeight: 1.6,
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: `1px solid rgba(79,162,173,0.16)`,
                      background: "rgba(255,255,255,0.03)",
                      overflowWrap: "anywhere",
                      textWrap: "pretty",
                    }}
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </article>
      ) : null}

      {sectionModels.length > 0 ? (
        <div
          style={{
            display: "grid",
            gap: 14,
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          }}
        >
          {sectionModels.map((section) => {
            const accentBorder =
              section.tone === "accent"
                ? "rgba(79,162,173,0.2)"
                : section.tone === "warn"
                  ? "rgba(217,132,88,0.22)"
                  : "rgba(255,255,255,0.08)";
            const accentColor =
              section.tone === "accent"
                ? colors.primary
                : section.tone === "warn"
                  ? colors.warn
                  : colors.neutral;
            return (
              <article
                key={section.key}
                id={`plan-section-${section.key}`}
                data-plan-section={section.key}
                style={{
                  border: `1px solid ${accentBorder}`,
                  borderRadius: 16,
                  padding: "16px 16px 14px",
                  background: colors.bg,
                }}
              >
                <div
                  style={{
                    color: accentColor,
                    fontSize: 12,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    fontWeight: 700,
                    marginBottom: 12,
                  }}
                >
                  {section.title}
                </div>
                {renderItemList(
                  section.key,
                  section.items,
                  colors.text,
                  accentBorder,
                  "rgba(255,255,255,0.03)",
                )}
              </article>
            );
          })}
        </div>
      ) : null}

      {hasDocument ? (
        <article
          id="plan-section-notes"
          data-plan-section="notes"
          style={{
            border: `1px solid ${colors.border}`,
            borderRadius: 18,
            padding: "18px 20px",
            background: colors.bg,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 14,
            }}
          >
            <div>
              <div
                style={{
                  color: colors.text,
                  fontSize: 18,
                  lineHeight: 1.2,
                  fontWeight: 700,
                }}
              >
                Plan Notes
              </div>
              <div
                style={{
                  color: colors.neutral,
                  fontSize: 13,
                  lineHeight: 1.5,
                  marginTop: 4,
                }}
              >
                Readable narrative surface now, with stable section anchors for future graph-linked
                exploration.
              </div>
            </div>
          </div>
          {document}
        </article>
      ) : null}
    </section>
  );
}
