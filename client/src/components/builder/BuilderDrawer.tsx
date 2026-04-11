import React from "react";

type BuilderDrawerColors = {
  panel: string;
  border: string;
  text: string;
  neutral: string;
};

export default function BuilderDrawer({
  title,
  onClose,
  children,
  colors,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  colors: BuilderDrawerColors;
}) {
  return (
    // clicking the dark background closes the drawer
    <div
      className="fixed inset-0"
      style={{ background: "#0008" }}
      onClick={onClose}
    >
      <div
        className="absolute top-0 left-0 h-full"
        style={{
          width: 300,
          background: colors.panel,
          borderRight: `1px solid ${colors.border}`,
        }}
        // stop clicks inside the panel from bubbling to the background
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4"
          style={{ height: 52, borderBottom: `1px solid ${colors.border}` }}
        >
          <div style={{ color: colors.text, fontWeight: 600 }}>{title}</div>
          <button
            onClick={onClose}
            className="px-2 py-1 rounded"
            style={{ border: `1px solid ${colors.border}`, color: colors.neutral }}
          >
            ✕
          </button>
        </div>
        <div className="p-4 text-sm" style={{ color: colors.text }}>
          {children}
        </div>
      </div>
    </div>
  );
}
