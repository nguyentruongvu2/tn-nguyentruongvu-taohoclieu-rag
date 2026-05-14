/**
 * EnhancedMarkdownRenderer
 *
 * Renders Markdown with support for:
 * 1. GitHub-style alert callouts  (> [!TIP], > [!NOTE], > [!WARNING], > [!IMPORTANT], > [!CAUTION])
 * 2. Mermaid.js diagrams          (```mermaid ... ```)
 * 3. Custom emoji callouts        (> 💡 **Mẹo…**, > 📝 **Lưu ý…**, > 🤔 **Thảo luận…**, > 🏫 **Nhận xét…**)
 * 4. All existing citation link logic (passed via `components` prop override)
 */

import React, { useEffect, useRef, useId } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnhancedMarkdownRendererProps {
  /** Raw Markdown string to render */
  content: string;
  /** Override/extend default component renderers (e.g. for citation links) */
  components?: Components;
  /** Extra CSS class names for the wrapper div */
  className?: string;
}

// ---------------------------------------------------------------------------
// Callout configuration
// ---------------------------------------------------------------------------

type CalloutType = "tip" | "note" | "warning" | "important" | "caution" | "discussion" | "teaching";

interface CalloutConfig {
  label: string;
  icon: string;
  /** Tailwind-compatible inline styles */
  borderColor: string;
  bgColor: string;
  labelColor: string;
  iconBg: string;
}

const CALLOUT_CONFIGS: Record<CalloutType, CalloutConfig> = {
  tip: {
    label: "Mẹo",
    icon: "💡",
    borderColor: "#10b981",
    bgColor: "#f0fdf4",
    labelColor: "#065f46",
    iconBg: "#d1fae5",
  },
  note: {
    label: "Lưu ý",
    icon: "📝",
    borderColor: "#3b82f6",
    bgColor: "#eff6ff",
    labelColor: "#1e40af",
    iconBg: "#dbeafe",
  },
  warning: {
    label: "Cảnh báo",
    icon: "⚠️",
    borderColor: "#f59e0b",
    bgColor: "#fffbeb",
    labelColor: "#92400e",
    iconBg: "#fef3c7",
  },
  important: {
    label: "Quan trọng",
    icon: "❗",
    borderColor: "#8b5cf6",
    bgColor: "#faf5ff",
    labelColor: "#4c1d95",
    iconBg: "#ede9fe",
  },
  caution: {
    label: "Chú ý",
    icon: "🔴",
    borderColor: "#ef4444",
    bgColor: "#fef2f2",
    labelColor: "#7f1d1d",
    iconBg: "#fee2e2",
  },
  discussion: {
    label: "Thảo luận",
    icon: "🤔",
    borderColor: "#06b6d4",
    bgColor: "#ecfeff",
    labelColor: "#164e63",
    iconBg: "#cffafe",
  },
  teaching: {
    label: "Nhận xét sư phạm",
    icon: "🏫",
    borderColor: "#f97316",
    bgColor: "#fff7ed",
    labelColor: "#7c2d12",
    iconBg: "#fed7aa",
  },
};

// ---------------------------------------------------------------------------
// Helper: detect callout type from blockquote text
// ---------------------------------------------------------------------------

function detectCalloutType(text: string): CalloutType | null {
  const lower = text.trimStart();

  // GitHub-style: > [!TIP], > [!NOTE], etc.
  const ghMatch = lower.match(/^\[!(TIP|NOTE|WARNING|IMPORTANT|CAUTION)\]/i);
  if (ghMatch) return ghMatch[1].toLowerCase() as CalloutType;

  // Emoji-style used in our prompts
  if (lower.startsWith("💡")) return "tip";
  if (lower.startsWith("📝")) return "note";
  if (lower.startsWith("⚠️")) return "warning";
  if (lower.startsWith("🤔")) return "discussion";
  if (lower.startsWith("🏫")) return "teaching";

  return null;
}

// ---------------------------------------------------------------------------
// Callout block component
// ---------------------------------------------------------------------------

function CalloutBlock({
  type,
  children,
}: {
  type: CalloutType;
  children: React.ReactNode;
}) {
  const cfg = CALLOUT_CONFIGS[type];
  return (
    <div
      style={{
        borderLeft: `4px solid ${cfg.borderColor}`,
        backgroundColor: cfg.bgColor,
        borderRadius: "0 8px 8px 0",
        padding: "12px 16px",
        margin: "16px 0",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          backgroundColor: cfg.iconBg,
          borderRadius: "6px",
          padding: "2px 8px",
          marginBottom: "8px",
          fontSize: "12px",
          fontWeight: 700,
          color: cfg.labelColor,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
        }}
      >
        <span>{cfg.icon}</span>
        <span>{cfg.label}</span>
      </div>
      <div style={{ color: cfg.labelColor, fontSize: "14px", lineHeight: 1.6 }}>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mermaid diagram component (lazy loads mermaid via CDN)
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mermaid?: any;
    _mermaidLoading?: boolean;
    _mermaidReady?: boolean;
  }
}

function loadMermaidCDN(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window._mermaidReady) { resolve(); return; }
    if (window._mermaidLoading) {
      const interval = setInterval(() => {
        if (window._mermaidReady) { clearInterval(interval); resolve(); }
      }, 100);
      return;
    }
    window._mermaidLoading = true;
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js";
    script.onload = () => {
      window.mermaid?.initialize({ startOnLoad: false, theme: "neutral" });
      window._mermaidReady = true;
      window._mermaidLoading = false;
      resolve();
    };
    script.onerror = () => reject(new Error("Failed to load Mermaid CDN"));
    document.head.appendChild(script);
  });
}

function MermaidDiagram({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const uid = useId().replace(/:/g, "mermaid");

  useEffect(() => {
    let cancelled = false;
    loadMermaidCDN()
      .then(() => {
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = "";
        return window.mermaid?.render(`mermaid-${uid}`, code).then(
          ({ svg }: { svg: string }) => {
            if (!cancelled && ref.current) ref.current.innerHTML = svg;
          }
        );
      })
      .catch(() => {
        if (!cancelled && ref.current)
          ref.current.innerHTML = `<pre style="font-size:12px;color:#666">${code}</pre>`;
      });
    return () => { cancelled = true; };
  }, [code, uid]);

  return (
    <div
      style={{
        background: "#f8fafc",
        border: "1px solid #e2e8f0",
        borderRadius: "8px",
        padding: "16px",
        margin: "16px 0",
        overflowX: "auto",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: "11px",
          color: "#94a3b8",
          marginBottom: "8px",
          textAlign: "left",
          fontWeight: 600,
          letterSpacing: "0.05em",
        }}
      >
        📊 SƠ ĐỒ
      </div>
      <div ref={ref}>
        <div style={{ color: "#94a3b8", fontSize: "13px" }}>Đang tải sơ đồ…</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function EnhancedMarkdownRenderer({
  content,
  components = {},
  className = "",
}: EnhancedMarkdownRendererProps) {
  const defaultComponents: Components = {
    // ── Blockquote → Callout ──────────────────────────────────────────────
    blockquote: ({ children }) => {
      // Extract flat text to detect callout type
      const flatText = extractText(children);
      const type = detectCalloutType(flatText);

      if (type) {
        return <CalloutBlock type={type}>{children}</CalloutBlock>;
      }
      // Default blockquote style
      return (
        <blockquote
          style={{
            borderLeft: "3px solid #cbd5e1",
            paddingLeft: "12px",
            color: "#64748b",
            margin: "12px 0",
            fontStyle: "italic",
          }}
        >
          {children}
        </blockquote>
      );
    },

    // ── Code block → Mermaid or styled code ──────────────────────────────
    code: ({ className: cls, children, ...props }) => {
      const isInline = !cls;
      const lang = (cls || "").replace("language-", "");
      const codeStr = String(children).replace(/\n$/, "");

      if (lang === "mermaid") {
        return <MermaidDiagram code={codeStr} />;
      }

      if (isInline) {
        return (
          <code
            style={{
              backgroundColor: "#f1f5f9",
              color: "#0f172a",
              borderRadius: "4px",
              padding: "1px 5px",
              fontSize: "0.875em",
              fontFamily: "ui-monospace, monospace",
            }}
            {...props}
          >
            {children}
          </code>
        );
      }

      return (
        <pre
          style={{
            backgroundColor: "#0f172a",
            color: "#e2e8f0",
            borderRadius: "8px",
            padding: "16px",
            overflowX: "auto",
            fontSize: "13px",
            lineHeight: 1.6,
            margin: "16px 0",
          }}
        >
          {lang && (
            <div
              style={{
                color: "#64748b",
                fontSize: "11px",
                marginBottom: "8px",
                fontWeight: 600,
                letterSpacing: "0.05em",
              }}
            >
              {lang.toUpperCase()}
            </div>
          )}
          <code style={{ fontFamily: "ui-monospace, monospace" }}>{children}</code>
        </pre>
      );
    },

    // ── Paragraph ────────────────────────────────────────────────────────
    p: ({ children }) => (
      <p className="whitespace-pre-wrap break-words" style={{ marginBottom: "12px" }}>
        {children}
      </p>
    ),

    // ── List items ───────────────────────────────────────────────────────
    li: ({ children }) => (
      <li className="whitespace-pre-wrap break-words">{children}</li>
    ),

    // ── Headings ─────────────────────────────────────────────────────────
    h2: ({ children }) => (
      <h2
        style={{
          fontSize: "18px",
          fontWeight: 700,
          color: "#1e293b",
          borderBottom: "2px solid #e2e8f0",
          paddingBottom: "6px",
          marginBottom: "12px",
          marginTop: "24px",
        }}
      >
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3
        style={{
          fontSize: "15px",
          fontWeight: 700,
          color: "#334155",
          marginBottom: "8px",
          marginTop: "20px",
        }}
      >
        {children}
      </h3>
    ),

    // ── Horizontal rule ───────────────────────────────────────────────────
    hr: () => (
      <hr style={{ border: "none", borderTop: "1px solid #e2e8f0", margin: "20px 0" }} />
    ),

    // Merge caller-provided overrides (e.g. citation links)
    ...components,
  };

  return (
    <div className={className}>
      <ReactMarkdown components={defaultComponents}>{content}</ReactMarkdown>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utility: flatten React children to plain text (for callout detection)
// ---------------------------------------------------------------------------

function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (React.isValidElement(node)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return extractText((node.props as any).children);
  }
  return "";
}
