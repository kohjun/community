"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          // Text is persisted as Markdown; remote images are not automatically loaded.
          img: ({ alt }) => (
            <span className="markdown-image-label">[이미지: {alt || "첨부 이미지"}]</span>
          ),
          a: ({ children: text, href }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {text}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
