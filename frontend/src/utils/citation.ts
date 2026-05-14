export interface CitationMetadata {
  file_name?: string | null;
  chapter?: string | null;
  section?: string | null;
  subsection?: string | null;
  chapter_title?: string | null;
  section_title?: string | null;
  subsection_title?: string | null;
  start_page?: number | null;
  end_page?: number | null;
}

export interface CitationChunkLike {
  id: string;
  source?: string;
  title?: string;
  pageNumber?: number | null;
  startPage?: number | null;
  endPage?: number | null;
  metadata?: {
    fileName?: string;
    chapter?: string;
    section?: string;
    subsection?: string;
    chapterTitle?: string;
    sectionTitle?: string;
    subsectionTitle?: string;
    startPage?: number | null;
    endPage?: number | null;
  };
}

export interface CitationGroup {
  id: string;
  lineText: string;
  chunkIds: string[];
}

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

const HEADING_SQL_NOISE_RE =
  /\b(select|from|where|distinct|join|insert|update|delete|group\s+by|order\s+by)\b/i;

function sanitizeStructureLabel(
  value: unknown,
  kind: "chapter" | "section" | "subsection",
): string {
  let text = normalizeText(value);
  if (!text) {
    return "";
  }

  text = text
    .replace(/^[+\-*•]+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return "";
  }

  const noiseMatch = text.match(HEADING_SQL_NOISE_RE);
  if (noiseMatch?.index && noiseMatch.index > 0) {
    text = text
      .slice(0, noiseMatch.index)
      .replace(/[\s\-,:;]+$/, "")
      .trim();
  }
  if (!text) {
    return "";
  }

  if (kind === "chapter") {
    if (/^(nếu|khi|ta|dùng|sử dụng)\b/i.test(text)) {
      return "";
    }
    if (/^[^\p{L}\p{N}]+/u.test(text)) {
      return "";
    }
    if (text.length > 90) {
      return "";
    }
    return text;
  }

  const numberedMatch = text.match(/^(\d+(?:\.\d+){1,4})\s*[:\-.)]?\s*(.*)$/);
  if (numberedMatch) {
    const code = numberedMatch[1];
    let title = normalizeText(numberedMatch[2]);
    if (title) {
      title = title.split(/\s{2,}|[;|]/, 1)[0].trim();
      if (title.length > 80) {
        title = title.split(/[.!?,]/, 1)[0].trim();
      }
    }
    return title ? `${code}. ${title}` : code;
  }

  if (text.length > 100) {
    return "";
  }
  return text;
}

function toPositivePage(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : null;
}

function buildChapterLabel(metadata: CitationMetadata): string {
  // Prefer semantic title (e.g., "Chương 2: ..."), then fallback to numeric chapter value.
  const chapterTitle = sanitizeStructureLabel(
    metadata.chapter_title,
    "chapter",
  );
  if (chapterTitle) {
    return chapterTitle;
  }

  const chapter = sanitizeStructureLabel(metadata.chapter, "chapter");
  if (!chapter) {
    return "";
  }

  if (/^\d+$/.test(chapter)) {
    return `Chương ${chapter}`;
  }

  if (/^(chương|chuong|chapter)\s+/i.test(chapter)) {
    return chapter;
  }

  return `Chương ${chapter}`;
}

function uniqueNonEmptyParts(parts: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawPart of parts) {
    const part = normalizeText(rawPart);
    if (!part) {
      continue;
    }
    const key = part.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(part);
  }

  return result;
}

function buildPageLabel(metadata: CitationMetadata): string {
  // Normalize page range so UI always shows a clean single page or range.
  const startPage = toPositivePage(metadata.start_page);
  const endPage = toPositivePage(metadata.end_page);
  const fromPage = startPage ?? endPage;
  const toPage = endPage ?? startPage;

  if (!fromPage) {
    return "";
  }

  if (!toPage || fromPage === toPage) {
    return `Trang ${fromPage}`;
  }

  return `Trang ${fromPage}–${toPage}`;
}

export function formatCitation(metadata: CitationMetadata): string {
  // Build the user-facing citation without exposing raw internal breadcrumb format.
  const fileName = normalizeText(metadata.file_name) || "Không rõ nguồn";
  const chapterLabel = buildChapterLabel(metadata);
  const sectionLabel =
    sanitizeStructureLabel(metadata.section_title, "section") ||
    sanitizeStructureLabel(metadata.section, "section");
  const subsectionLabel =
    sanitizeStructureLabel(metadata.subsection_title, "subsection") ||
    sanitizeStructureLabel(metadata.subsection, "subsection");

  const structureParts = uniqueNonEmptyParts([
    chapterLabel,
    sectionLabel,
    subsectionLabel,
  ]);
  const structureText = structureParts.join(", ");
  const pageLabel = buildPageLabel(metadata);

  const baseText = structureText
    ? `📚 Nguồn: ${fileName} – ${structureText}`
    : `📚 Nguồn: ${fileName}`;

  return pageLabel ? `${baseText} (${pageLabel})` : baseText;
}

// Bonus: Group citations by file + chapter and merge page ranges.
export function mergeCitationsByFileAndChapter(
  items: CitationMetadata[],
): string[] {
  const groups = new Map<
    string,
    {
      file_name: string;
      chapter?: string | null;
      chapter_title?: string | null;
      start_page?: number | null;
      end_page?: number | null;
    }
  >();

  for (const item of items) {
    const fileName = normalizeText(item.file_name) || "Không rõ nguồn";
    const chapter = normalizeText(item.chapter) || null;
    const chapterTitle = normalizeText(item.chapter_title) || null;
    const key = `${fileName}||${chapterTitle || chapter || ""}`;

    const startPage = toPositivePage(item.start_page);
    const endPage = toPositivePage(item.end_page);
    const fromPage = startPage ?? endPage;
    const toPage = endPage ?? startPage;

    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        file_name: fileName,
        chapter,
        chapter_title: chapterTitle,
        start_page: fromPage,
        end_page: toPage,
      });
      continue;
    }

    const existingStart = toPositivePage(existing.start_page);
    const existingEnd = toPositivePage(existing.end_page);

    const mergedStart =
      existingStart && fromPage
        ? Math.min(existingStart, fromPage)
        : (existingStart ?? fromPage);
    const mergedEnd =
      existingEnd && toPage
        ? Math.max(existingEnd, toPage)
        : (existingEnd ?? toPage);

    existing.start_page = mergedStart;
    existing.end_page = mergedEnd;
  }

  return Array.from(groups.values()).map((group) =>
    formatCitation({
      file_name: group.file_name,
      chapter: group.chapter,
      chapter_title: group.chapter_title,
      start_page: group.start_page,
      end_page: group.end_page,
    }),
  );
}

function toGroupId(seed: string, index: number): string {
  const compact = seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${compact || "source"}-${index}`;
}

function stripCitationPrefix(text: string): string {
  return String(text || "")
    .replace(/^📚\s*Nguồn:\s*/i, "")
    .trim();
}

export function parseCitationSourceId(href: string | null | undefined): string {
  const value = String(href || "").trim();
  if (!value.toLowerCase().startsWith("#source:")) {
    return "";
  }
  return decodeURIComponent(value.slice("#source:".length));
}

export function groupChunksBySourceForCitation(
  chunks: CitationChunkLike[],
): CitationGroup[] {
  const groups = new Map<
    string,
    {
      order: number;
      chunkIds: string[];
      metadata: CitationMetadata;
    }
  >();

  (chunks || []).forEach((chunk, index) => {
    const metadata = chunk.metadata || {};
    const fileName =
      normalizeText(metadata.fileName) ||
      normalizeText(chunk.source) ||
      normalizeText(chunk.title);

    if (!fileName) {
      return;
    }

    const citationMeta: CitationMetadata = {
      file_name: fileName,
      chapter_title: normalizeText(metadata.chapterTitle) || undefined,
      section_title: normalizeText(metadata.sectionTitle) || undefined,
      subsection_title: normalizeText(metadata.subsectionTitle) || undefined,
      chapter: normalizeText(metadata.chapter) || undefined,
      section: normalizeText(metadata.section) || undefined,
      subsection: normalizeText(metadata.subsection) || undefined,
      start_page:
        toPositivePage(chunk.startPage) ??
        toPositivePage(metadata.startPage) ??
        toPositivePage(chunk.pageNumber),
      end_page:
        toPositivePage(chunk.endPage) ??
        toPositivePage(metadata.endPage) ??
        toPositivePage(chunk.pageNumber),
    };

    const key = [
      fileName.toLowerCase(),
      normalizeText(
        citationMeta.chapter_title || citationMeta.chapter,
      ).toLowerCase(),
      normalizeText(
        citationMeta.section_title || citationMeta.section,
      ).toLowerCase(),
      normalizeText(
        citationMeta.subsection_title || citationMeta.subsection,
      ).toLowerCase(),
    ].join("||");

    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        order: index,
        chunkIds: chunk.id ? [String(chunk.id)] : [],
        metadata: citationMeta,
      });
      return;
    }

    if (chunk.id) {
      existing.chunkIds.push(String(chunk.id));
    }

    const currentStart = toPositivePage(existing.metadata.start_page);
    const currentEnd = toPositivePage(existing.metadata.end_page);
    const nextStart = toPositivePage(citationMeta.start_page);
    const nextEnd = toPositivePage(citationMeta.end_page);

    existing.metadata.start_page =
      currentStart && nextStart
        ? Math.min(currentStart, nextStart)
        : (currentStart ?? nextStart);
    existing.metadata.end_page =
      currentEnd && nextEnd
        ? Math.max(currentEnd, nextEnd)
        : (currentEnd ?? nextEnd);
  });

  return Array.from(groups.entries())
    .sort((a, b) => a[1].order - b[1].order)
    .map(([key, value], idx) => ({
      id: toGroupId(key, idx + 1),
      lineText: stripCitationPrefix(formatCitation(value.metadata)),
      chunkIds: Array.from(new Set(value.chunkIds.filter(Boolean))),
    }))
    .filter((group) => Boolean(group.lineText));
}
