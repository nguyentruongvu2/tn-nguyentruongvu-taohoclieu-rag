import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { EnhancedMarkdownRenderer } from "../components/EnhancedMarkdownRenderer";

describe("EnhancedMarkdownRenderer", () => {
  it("renders standard placeholder correctly", () => {
    const md = "![Test Image](<placeholder: Mo ta | prompt>)";
    render(<EnhancedMarkdownRenderer content={md} />);
    expect(screen.getByText("Khung hình minh họa gợi ý: Test Image")).toBeInTheDocument();
    expect(screen.getByText("Mô tả gợi ý: Mo ta")).toBeInTheDocument();
  });

  it("renders placeholder with -> and arrow characters correctly", () => {
    const md = "![Decision Tree](<placeholder: Sơ đồ luồng quyết định: A -> B | Detailed English description with an arrow -> here>)";
    render(<EnhancedMarkdownRenderer content={md} />);
    expect(screen.getByText("Khung hình minh họa gợi ý: Decision Tree")).toBeInTheDocument();
    expect(screen.getByText("Mô tả gợi ý: Sơ đồ luồng quyết định: A -> B")).toBeInTheDocument();
  });

  it("renders placeholder with parenthesis inside description", () => {
    const md = "![Normality Test](<placeholder: Kiểm định chuẩn (Shapiro-Wilk) -> T-test | English description with (some) parens>)";
    render(<EnhancedMarkdownRenderer content={md} />);
    expect(screen.getByText("Khung hình minh họa gợi ý: Normality Test")).toBeInTheDocument();
    expect(screen.getByText("Mô tả gợi ý: Kiểm định chuẩn (Shapiro-Wilk) -> T-test")).toBeInTheDocument();
  });
});
