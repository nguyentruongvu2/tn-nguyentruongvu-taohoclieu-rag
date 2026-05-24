/**
 * API Type Definitions
 */

export interface AuthUser {
  user_id: number;
  username: string;
  email: string;
  role: "user" | "admin";
}

export interface AuthTokenResponse {
  success: boolean;
  message: string;
  data: {
    access_token: string;
    token_type: string;
    expires_in: number;
    user: AuthUser;
  };
}

export interface RegisterResponse {
  success: boolean;
  message: string;
  user: {
    id: number;
    email: string;
    role: string;
    status: string;
  };
}

export interface SecureDocument {
  id: string;
  user_id: number;
  original_filename: string;
  collection_name: string;
  chunks_count: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface SecureUploadResponse {
  success: boolean;
  document_id: string;
  file_name: string;
  collection: string;
  chunks_indexed: number;
  message: string;
}

export interface SecureGenerateResponse {
  success: boolean;
  document_id: string;
  mode: "toc" | "section" | "edit" | "teaching_doc";
  content: string;
  gemini_real_call: boolean;
  llm_model: string;
  evaluation?: {
    relevance: number;
    faithfulness: number;
    completeness: number;
    clarity: number;
    strengths: string;
    weaknesses: string;
    improvements: string;
  };
}

export interface ChatSource {
  chunk_id: string;
  source: string;
  title: string;
  page_number: number;
  h1?: string;
  h2?: string;
  h3?: string;
  score: number;
  snippet: string;
}

export interface SecureChatResponse {
  success: boolean;
  answer: string;
  sources: ChatSource[];
  conversation_id?: string;
  gemini_real_call: boolean;
  cohere_rerank_real_call: boolean;
  llm_model: string;
  rerank_model: string;
}

export interface ChatConversation {
  id: string;
  title: string;
  document_id?: string;
  created_at: string;
  updated_at: string;
  last_message?: string;
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface SecureDocumentChunk {
  chunk_id: string;
  snippet: string;
  h1?: string;
  h2?: string;
  h3?: string;
  page_number: number;
}

export interface SecureDocumentDetailResponse {
  success: boolean;
  document: {
    id: string;
    original_filename: string;
    collection_name: string;
    chunks_count: number;
    status: string;
    created_at: string;
    updated_at: string;
  };
  markdown: string;
  chunks: SecureDocumentChunk[];
}

export interface TeachingContextChunk {
  source: string;
  title: string;
  page_number: number;
  snippet: string;
  full_text?: string | null;
  clean_content?: string | null;
  relevance?: "Cao" | "Trung bình" | "Thấp" | string | null;
  file_name?: string | null;
  chapter?: string | null;
  section?: string | null;
  subsection?: string | null;
  page?: string | null;
  start_page?: number | null;
  end_page?: number | null;
}

export interface GenerateTeachingDocResponse {
  success: boolean;
  content_markdown: string;
  contexts: TeachingContextChunk[];
  evaluation: {
    relevance: number;
    faithfulness: number;
    completeness: number;
    clarity: number;
    strengths: string;
    weaknesses: string;
    improvements: string;
  };
  gemini_real_call: boolean;
  llm_model: string;
}

export interface ConvertResponse {
  success: boolean;
  markdown: string;
  file_name: string;
  document_id: string;
  preview_url?: string | null;
  file_size: number;
  extraction_method: string;
  cleaning_method?: string;
  noise_removed_ratio?: number;
  pages: number;
  conversion_time_ms: number;
  message: string;
}

export interface ConvertSessionResponse {
  success: boolean;
  document_id: string;
  markdown: string;
  file_name: string;
  cleaning_method: string;
  pages: number;
  preview_url?: string | null;
  message: string;
}

export interface ChunkStatistics {
  total_chunks: number;
  avg_chunk_size: number;
  total_characters: number;
  chunks_with_h1: number;
  chunks_with_h2: number;
  chunks_with_h3: number;
  processing_time: number;
}

export interface ProcessResponse {
  success: boolean;
  file_name: string;
  statistics: ChunkStatistics;
  message: string;
}

export interface PipelineResponse {
  success: boolean;
  file_name: string;
  cleaning_mode: "standard" | "advanced" | "divider";
  pages: number;
  markdown: string;
  chunks_indexed: number;
  collection: string;
  statistics: ChunkStatistics;
  conversion_time_ms: number;
  message: string;
}

export interface ChatResponse {
  success: boolean;
  answer: string;
  sources: ChatSource[];
  message: string;
}

export interface TocFromMarkdownResponse {
  success: boolean;
  toc_markdown: string;
  gemini_real_call: boolean;
  llm_model: string;
  message: string;
}

export interface SubsectionExtractResponse {
  success: boolean;
  subsection: string;
  content: string;
  gemini_real_call: boolean;
  llm_model: string;
  message: string;
}

export interface SectionEditResponse {
  success: boolean;
  section_title: string;
  updated_content: string;
  gemini_real_call: boolean;
  llm_model: string;
  message: string;
}

export interface ContextSelectionResponse {
  success: boolean;
  section_title: string;
  filtered_chunks: string[];
  gemini_real_call: boolean;
  llm_model: string;
  message: string;
}

export interface StudioSectionPayload {
  id: string;
  title: string;
  content: string | null;
  loading: boolean;
  loaded: boolean;
  locked: boolean;
}

export interface EditorSection {
  id: string;
  project_id: string;
  title: string;
  content_markdown: string;
  prompt: string;
  retrieved_chunks?: Array<{
    id: string;
    text: string;
    score: number;
    source?: string;
    title?: string;
    page_number?: number | null;
    start_page?: number | null;
    end_page?: number | null;
    metadata?: {
      doc_id?: string | null;
      file_name?: string | null;
      chapter?: string | null;
      section?: string | null;
      subsection?: string | null;
      chapter_title?: string | null;
      section_title?: string | null;
      subsection_title?: string | null;
      breadcrumb?: string | null;
      start_page?: number | null;
      end_page?: number | null;
    };
  }>;
  evaluation?: {
    scores: {
      accuracy: number;
      coverage: number;
      structure: number;
      clarity: number;
    };
    strengths: string[];
    weaknesses: string[];
    suggestions: string[];
  } | null;
  order_index: number;
  level?: number;
  updated_at: string;
}

export interface EditorProject {
  id: string;
  title: string;
  description: string;
  knowledge_base_ids: string[];
  level: string;
  format: string;
  teaching_tone?: string;
  created_at: string;
  updated_at: string;
  sections_count?: number;
}

export interface QuizItem {
  id: string;
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string;
  restudy_hint?: string;
  type: "knowledge" | "comprehension" | "application" | "analysis";
}

export interface GenerateQuizResponse {
  questions: QuizItem[];
  variation_seed: number;
}

export interface QuizAttemptResult {
  id: number;
  score: number;
  total: number;
  percentage: number;
  created_at: string;
}

export interface QuizStats {
  attempts: number;
  avg_percentage: number | null;
  best_percentage: number | null;
  last_attempt_at: string | null;
}

export interface SlideItem {
  title: string;
  bullet_points: string[];
  speaker_notes: string;
  visual_prompt?: string;
  talking_points?: string[];
  estimated_duration?: number;
}

export interface GenerateOutlineResponse {
  slides: SlideItem[];
  total: number;
}

export interface SlidesHealthResponse {
  pptx_available: boolean;
  pptx_error: string | null;
}

export interface AdminUser {
  id: number;
  username: string;
  email: string;
  role: string;
  status: string;
  is_active: number;
  created_at: string;
  last_login: string | null;
  request_count: number;
  llm_calls: number;
  token_usage: number;
  last_activity: string | null;
}

export interface AdminDocument {
  id: string;
  user_id: number;
  original_filename: string;
  collection_name: string;
  source_tag: string;
  chunks_count: number;
  status: string;
  created_at: string;
}

export interface AdminUsageEntry {
  user_id: number;
  username: string;
  role: string;
  request_count: number;
  llm_calls: number;
  token_usage: number;
  last_activity: string | null;
}

export interface AdminLogEntry {
  id: number;
  user_id: number | null;
  username: string | null;
  endpoint: string;
  method: string;
  status_code: number;
  llm_calls: number;
  ip_address: string | null;
  created_at: string;
}

export interface BatchSectionResult {
  section_id: string;
  title: string;
  content: string;
  status: "generated" | "empty";
  sentinel?: string;
}
