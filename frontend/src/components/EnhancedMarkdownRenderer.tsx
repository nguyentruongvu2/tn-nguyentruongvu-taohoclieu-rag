/**
 * EnhancedMarkdownRenderer
 *
 * Renders Markdown with support for:
 * 1. GitHub-style alert callouts  (> [!TIP], > [!NOTE], > [!WARNING], > [!IMPORTANT], > [!CAUTION])
 * 2. Custom emoji callouts        (> 💡 **Mẹo…**, > 📝 **Lưu ý…**, > 🤔 **Thảo luận…**, > 🏫 **Nhận xét…**)
 * 3. All existing citation link logic (passed via `components` prop override)
 */

import React, { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { toastService } from "../services/toastService";

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
// KaTeX and math global interface definitions
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    renderMathInElement?: any;
    _katexLoading?: boolean;
  }
}

// ---------------------------------------------------------------------------
// Robust Loaders for Scripts and Styles (with multiple CDNs for redundancy)
// ---------------------------------------------------------------------------

function loadScriptWithFallbacks(urls: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let index = 0;
    function tryNext() {
      if (index >= urls.length) {
        reject(new Error("All script CDNs failed to load"));
        return;
      }
      const script = document.createElement("script");
      script.src = urls[index];
      script.onload = () => resolve();
      script.onerror = () => {
        index++;
        tryNext();
      };
      document.head.appendChild(script);
    }
    tryNext();
  });
}

function loadStyleWithFallbacks(urls: string[], id: string): Promise<void> {
  return new Promise((resolve) => {
    if (document.getElementById(id)) {
      resolve();
      return;
    }
    let index = 0;
    function tryNext() {
      if (index >= urls.length) {
        // Resolve anyway so we don't completely break the UI if CSS fails
        resolve();
        return;
      }
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = urls[index];
      link.onload = () => resolve();
      link.onerror = () => {
        index++;
        tryNext();
      };
      document.head.appendChild(link);
    }
    tryNext();
  });
}

function loadKaTeX(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.renderMathInElement) {
      resolve();
      return;
    }

    const cssCDNs = [
      "https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css",
      "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.8/katex.min.css",
      "https://unpkg.com/katex@0.16.8/dist/katex.min.css"
    ];

    const jsCDNs = [
      "https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.8/katex.min.js",
      "https://unpkg.com/katex@0.16.8/dist/katex.min.js"
    ];

    const autoRenderCDNs = [
      "https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/contrib/auto-render.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.8/contrib/auto-render.min.js",
      "https://unpkg.com/katex@0.16.8/dist/contrib/auto-render.min.js"
    ];

    if (window._katexLoading) {
      const interval = setInterval(() => {
        if (window.renderMathInElement) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
      return;
    }
    window._katexLoading = true;

    loadStyleWithFallbacks(cssCDNs, "katex-css")
      .then(() => loadScriptWithFallbacks(jsCDNs))
      .then(() => loadScriptWithFallbacks(autoRenderCDNs))
      .then(() => {
        window.renderMathInElement = (window as any).renderMathInElement;
        resolve();
      })
      .catch((err) => {
        window._katexLoading = false;
        reject(err);
      });
  });
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function EnhancedMarkdownRenderer({
  content,
  components = {},
  className = "",
}: EnhancedMarkdownRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Preprocess content to wrap placeholder URLs containing spaces in angle brackets < > so remark-parse compiles them as images
  const processedContent = React.useMemo(() => {
    if (!content) return "";
    return content.replace(
      /!\[([^\]]*)\]\(\s*(placeholder:[^)]*(?:\([^)]*\)[^)]*)*)\s*\)/g,
      (_, alt, path) => `![${alt}](<${path.trim()}>)`
    );
  }, [content]);

  // 1. Load KaTeX and render math when content changes
  useEffect(() => {
    loadKaTeX()
      .then(() => {
        if (containerRef.current && window.renderMathInElement) {
          window.renderMathInElement(containerRef.current, {
            delimiters: [
              { left: "$$", right: "$$", display: true },
              { left: "$", right: "$", display: false },
              { left: "\\(", right: "\\)", display: false },
              { left: "\\[", right: "\\]", display: true },
            ],
            throwOnError: false,
          });
        }
      })
      .catch((err) => {
        console.error("Failed to render math with KaTeX:", err);
      });
  }, [processedContent]);

  // 2. Re-apply math rendering on every component render/update to prevent React's virtual DOM reconciliation from resetting it to raw text
  useEffect(() => {
    if (containerRef.current && window.renderMathInElement) {
      window.renderMathInElement(containerRef.current, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\(", right: "\\)", display: false },
          { left: "\\[", right: "\\]", display: true },
        ],
        throwOnError: false,
      });
    }
  });

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

    // ── Code block → styled code ──────────────────────────────────────────
    code: ({ className: cls, children, ...props }) => {
      const isInline = !cls;
      const lang = (cls || "").replace("language-", "");



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
    li: ({ children }) => {
      const unwrappedChildren = React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          // If it's a paragraph or another block element, extract its children
          if (child.type === "p" || child.type === "div" || child.type === "span") {
            return child.props.children;
          }
        }
        return child;
      });
      return <li className="break-words">{unwrappedChildren}</li>;
    },

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

    // ── Image or Placeholder ──────────────────────────────────────────────
    img: ({ src, alt }) => {
      const isPlaceholder = src?.startsWith("placeholder:");
      if (src && isPlaceholder) {
        const description = src.substring("placeholder:".length).trim();
        const decodedDescription = description.replace(/%7C/g, "|");
        const parts = decodedDescription.split("|");
        const rawVi = parts[0] || "";
        const rawEn = parts[1] || rawVi;

        const cleanVi = (() => {
          try {
            return decodeURIComponent(rawVi).replace(/_/g, " ");
          } catch {
            return rawVi.replace(/_/g, " ");
          }
        })();

        const cleanEn = (() => {
          try {
            return decodeURIComponent(rawEn).replace(/_/g, " ");
          } catch {
            return rawEn.replace(/_/g, " ");
          }
        })();

        return (
          <div
            style={{
              border: "2px dashed #0891b2",
              background: "linear-gradient(135deg, #ecfeff 0%, #cffafe 100%)",
              borderRadius: "12px",
              padding: "20px",
              margin: "20px 0",
              textAlign: "center",
              boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)",
            }}
          >
            <div style={{ fontSize: "28px", marginBottom: "8px" }}>📊</div>
            <h4
              style={{
                fontSize: "14px",
                fontWeight: 700,
                color: "#164e63",
                margin: "0 0 6px 0",
              }}
            >
              Khung hình minh họa gợi ý: {alt}
            </h4>
            <p
              style={{
                fontSize: "12px",
                color: "#0891b2",
                margin: "0 0 16px 0",
                lineHeight: "1.5",
                fontStyle: "italic",
                wordBreak: "break-word",
              }}
            >
              Mô tả gợi ý: {cleanVi}
            </p>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: "10px",
              }}
            >
              <button
                type="button"
                style={{
                  background: "#0891b2",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  padding: "6px 12px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "background 0.2s",
                }}
                onClick={() => {
                  const promptForAi = `Vẽ ảnh minh họa cho bài giảng: ${alt}. Mô tả chi tiết: ${cleanEn}`;
                  navigator.clipboard.writeText(promptForAi);
                  toastService.success("Đã copy prompt vẽ ảnh AI vào bộ nhớ tạm!");
                }}
              >
                🎨 Copy Prompt AI
              </button>
              <button
                type="button"
                style={{
                  background: "#fff",
                  color: "#0891b2",
                  border: "1px solid #0891b2",
                  borderRadius: "6px",
                  padding: "6px 12px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
                onClick={() => {
                  const url = prompt("Nhập URL hình ảnh đã tạo để thay thế cho placeholder này:");
                  if (url && url.trim()) {
                    window.dispatchEvent(
                      new CustomEvent("replace-placeholder", {
                        detail: { placeholderSrc: src, newSrc: url },
                      })
                    );
                  }
                }}
              >
                📤 Chèn URL ảnh
              </button>
            </div>
          </div>
        );
      }
      return (
        <img
          src={src}
          alt={alt}
          style={{
            maxWidth: "80%",
            maxHeight: "320px",
            objectFit: "contain",
            borderRadius: "8px",
            margin: "16px auto",
            display: "block",
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          }}
        />
      );
    },

    // Merge caller-provided overrides (e.g. citation links)
    ...components,
  };

  return (
    <div ref={containerRef} className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={defaultComponents}
        urlTransform={(uri) => uri}
      >
        {processedContent}
      </ReactMarkdown>
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
