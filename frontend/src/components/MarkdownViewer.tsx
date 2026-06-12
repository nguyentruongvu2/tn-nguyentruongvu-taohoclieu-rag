import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownViewerProps {
  content: string;
  className?: string;
  components?: any;
}

export default function MarkdownViewer({ content, className = "", components }: MarkdownViewerProps) {
  return (
    <div className={`prose markdown-preview max-w-none ${className}`}>
      <ReactMarkdown 
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (
            <p className="whitespace-pre-wrap break-words">{children}</p>
          ),
          li: ({ children }) => (
            <li className="break-words">{children}</li>
          ),
          ...components
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
