/**
 * API service module
 * Handles all HTTP communication with the FastAPI backend
 *
 * Two-stage document processing:
 * Stage 1: /convert - File → Markdown conversion
 * Stage 2: /process - Markdown → Chunking & Processing
 */

import axios, {
  AxiosInstance,
  AxiosError,
  AxiosHeaders,
  AxiosProgressEvent,
} from "axios";
import { DocumentUploadResponse } from "../types";
import { toastService } from "./toastService";

// Get API base URL from environment or use default
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

const AUTH_TOKEN_STORAGE_KEY = "rag.auth.access_token";
const AUTH_USER_STORAGE_KEY = "rag.auth.user";
const DASHBOARD_STORAGE_PREFIX = "rag_dashboard_state";
const GENERATE_STORAGE_PREFIX = "rag_generate_form_state";

const LEGACY_UI_STORAGE_KEYS = [
  `${DASHBOARD_STORAGE_PREFIX}_activeTab`,
  `${DASHBOARD_STORAGE_PREFIX}_chatHistory`,
  `${DASHBOARD_STORAGE_PREFIX}_conversationId`,
  `${GENERATE_STORAGE_PREFIX}_docs`,
  `${GENERATE_STORAGE_PREFIX}_prompt`,
  `${GENERATE_STORAGE_PREFIX}_level`,
  `${GENERATE_STORAGE_PREFIX}_format`,
  `${GENERATE_STORAGE_PREFIX}_length`,
  `${GENERATE_STORAGE_PREFIX}_result`,
];

/**
 * Create and configure axios instance
 */
const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 300000, // 5 minutes for large file uploads
});

export interface AuthUser {
  user_id: number;
  username: string;
  email: string;
  role: "user" | "admin";
}

interface AuthTokenResponse {
  success: boolean;
  message: string;
  data: {
    access_token: string;
    token_type: string;
    expires_in: number;
    user: AuthUser;
  };
}

interface RegisterResponse {
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

const canUseStorage = () => typeof window !== "undefined";

const clearLegacyUiStorage = () => {
  if (!canUseStorage()) return;
  for (const key of LEGACY_UI_STORAGE_KEYS) {
    window.localStorage.removeItem(key);
  }
};

const clearUiStorageByPrefix = (prefix: string) => {
  if (!canUseStorage()) return;
  const keysToDelete: string[] = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (key && key.startsWith(prefix)) {
      keysToDelete.push(key);
    }
  }
  for (const key of keysToDelete) {
    window.localStorage.removeItem(key);
  }
};

export const clearAllScopedUiStorage = () => {
  clearUiStorageByPrefix(`${DASHBOARD_STORAGE_PREFIX}_`);
  clearUiStorageByPrefix(`${GENERATE_STORAGE_PREFIX}_`);
  clearLegacyUiStorage();
};

export const getStoredAccessToken = (): string | null => {
  if (!canUseStorage()) return null;
  return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || 
         window.sessionStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
};

export const hasStoredAuthSession = (): boolean => {
  return Boolean(getStoredAccessToken() && getStoredAuthUser());
};

export const getStoredAuthUser = (): AuthUser | null => {
  if (!canUseStorage()) return null;
  const raw = window.localStorage.getItem(AUTH_USER_STORAGE_KEY) || 
              window.sessionStorage.getItem(AUTH_USER_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
};

const storeAuth = (token: string, user: AuthUser, persist: boolean = true) => {
  if (!canUseStorage()) return;
  const previousUser = getStoredAuthUser();
  if (previousUser && Number(previousUser.user_id) !== Number(user.user_id)) {
    clearAllScopedUiStorage();
  }
  clearLegacyUiStorage();
  
  // Clear both first to be safe
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(AUTH_USER_STORAGE_KEY);
  window.sessionStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  window.sessionStorage.removeItem(AUTH_USER_STORAGE_KEY);

  const storage = persist ? window.localStorage : window.sessionStorage;
  storage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  storage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user));
};

export const clearStoredAuth = () => {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(AUTH_USER_STORAGE_KEY);
  window.sessionStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  window.sessionStorage.removeItem(AUTH_USER_STORAGE_KEY);
  clearLegacyUiStorage();
};

apiClient.interceptors.request.use((config) => {
  const token = getStoredAccessToken();
  if (!token) return config;

  const url = config.url || "";
  const skipAuth =
    url.startsWith("/auth/login") || url.startsWith("/auth/register");
  if (skipAuth) return config;

  if (!config.headers) {
    config.headers = new AxiosHeaders();
  }

  if (config.headers instanceof AxiosHeaders) {
    if (!config.headers.get("Authorization")) {
      config.headers.set("Authorization", `Bearer ${token}`);
    }
  } else {
    const headers = config.headers as Record<string, string>;
    if (!headers.Authorization) {
      headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

/**
 * Handle API errors with user-friendly messages
 */
const handleError = (error: AxiosError): string => {
  if (error.response) {
    // Server responded with error status
    const data = error.response.data as any;
    console.error("API Error Response:", data);

    if (error.response.status === 401) {
      const url = error.config?.url || "";
      const isAuthEndpoint = url.includes("/auth/login") || url.includes("/auth/register");
      
      // If it's a login attempt, prioritize the server message (e.g. "Wrong password")
      // over the generic "Session expired" message.
      if (isAuthEndpoint && data?.message) {
        return data.message;
      }
      return "Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.";
    }

    if (data && data.detail) {
      // Handle both string and array detail responses
      if (typeof data.detail === "string") {
        return data.detail;
      } else if (
        typeof data.detail === "object" &&
        data.detail !== null &&
        typeof data.detail.message === "string"
      ) {
        return data.detail.message;
      } else if (Array.isArray(data.detail)) {
        // Handle FastAPI validation errors
        return data.detail
          .map(
            (err: any) =>
              `${err.loc?.[err.loc.length - 1] || "field"}: ${err.msg}`,
          )
          .join("; ");
      }
    }

    if (Array.isArray(data?.errors) && data.errors.length > 0) {
      return data.errors
        .map((err: any) => err?.message || "Dữ liệu không hợp lệ.")
        .join("\n");
    }

    if (typeof data?.message === "string" && data.message.trim().length > 0) {
      return data.message;
    }

    if (error.response.status === 422) {
      return "Dữ liệu không hợp lệ. Vui lòng kiểm tra lại thông tin.";
    }

    return `Lỗi máy chủ (${error.response.status}). Vui lòng thử lại.`;
  } else if (error.request) {
    // Request made but no response received
    return "Không nhận được phản hồi từ máy chủ. Vui lòng kiểm tra backend.";
  } else {
    // Error setting up request
    return `Lỗi gửi yêu cầu: ${error.message}`;
  }
};

const shouldSkipSystemErrorToast = (error: AxiosError): boolean => {
  if (error.code === "ERR_CANCELED") {
    return true;
  }

  const config = (error.config || {}) as {
    url?: string;
    suppressErrorToast?: boolean;
  };

  if (config.suppressErrorToast) {
    return true;
  }

  const url = config.url || "";
  const isAuthEndpoint =
    url.startsWith("/auth/login") || url.startsWith("/auth/register");

  return isAuthEndpoint;
};

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      const url = error.config?.url || "";
      const isAuthEndpoint =
        url.startsWith("/auth/login") || url.startsWith("/auth/register");
      if (!isAuthEndpoint) {
        clearStoredAuth();
      }
    }

    if (!shouldSkipSystemErrorToast(error)) {
      toastService.error(handleError(error));
    }

    return Promise.reject(error);
  },
);

// Interface for conversion response
interface ConvertResponse {
  success: boolean;
  markdown: string;
  file_name: string;
  document_id: string;
  preview_url?: string | null;
  file_size: number;
  extraction_method: string;
  cleaning_method?: string; // "standard", "advanced", or "divider"
  noise_removed_ratio?: number; // Percentage of content removed
  pages: number;
  conversion_time_ms: number;
  message: string;
}

interface ConvertSessionResponse {
  success: boolean;
  document_id: string;
  markdown: string;
  file_name: string;
  cleaning_method: string;
  pages: number;
  preview_url?: string | null;
  message: string;
}

// Interface for processing request
interface ProcessRequest {
  markdown: string;
  file_name: string;
  chunk_size?: number;
  chunk_overlap?: number;
}

// Interface for chunking statistics
interface ChunkStatistics {
  total_chunks: number;
  avg_chunk_size: number;
  total_characters: number;
  chunks_with_h1: number;
  chunks_with_h2: number;
  chunks_with_h3: number;
  processing_time: number;
}

// Interface for processing response
interface ProcessResponse {
  success: boolean;
  file_name: string;
  statistics: ChunkStatistics;
  message: string;
}

interface PipelineResponse {
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

interface ChatSource {
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

interface ChatResponse {
  success: boolean;
  answer: string;
  sources: ChatSource[];
  message: string;
}

interface TocFromMarkdownResponse {
  success: boolean;
  toc_markdown: string;
  gemini_real_call: boolean;
  llm_model: string;
  message: string;
}

interface SubsectionExtractResponse {
  success: boolean;
  subsection: string;
  content: string;
  gemini_real_call: boolean;
  llm_model: string;
  message: string;
}

interface SectionEditResponse {
  success: boolean;
  section_title: string;
  updated_content: string;
  gemini_real_call: boolean;
  llm_model: string;
  message: string;
}

interface ContextSelectionResponse {
  success: boolean;
  section_title: string;
  filtered_chunks: string[];
  gemini_real_call: boolean;
  llm_model: string;
  message: string;
}

interface StudioSectionPayload {
  id: string;
  title: string;
  content: string | null;
  loading: boolean;
  loaded: boolean;
  locked: boolean;
}

interface SaveStudioDraftRequest {
  fileName: string;
  collectionName: string;
  reason: "toc-edited" | "content-generated" | "content-edited";
  sections: StudioSectionPayload[];
  markdown: string;
}

export const registerUser = async (
  email: string,
  password: string,
  confirmPassword: string,
): Promise<RegisterResponse> => {
  try {
    const response = await apiClient.post("/auth/register", {
      email,
      password,
      confirm_password: confirmPassword,
    });
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown error occurred during registration");
    }
  }
};

export const loginUser = async (
  email: string,
  password: string,
  rememberMe: boolean = true,
): Promise<AuthUser> => {
  try {
    const response = await apiClient.post<AuthTokenResponse>("/auth/login", {
      email,
      password,
    });
    const payload = response.data;
    const tokenPayload = payload.data;
    storeAuth(tokenPayload.access_token, tokenPayload.user, rememberMe);
    return {
      user_id: tokenPayload.user.user_id,
      username: tokenPayload.user.username,
      email: tokenPayload.user.email,
      role: tokenPayload.user.role,
    };
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown error occurred during login");
    }
  }
};

export const requestPasswordReset = async (email: string): Promise<{ success: boolean; message: string }> => {
  try {
    const response = await apiClient.post("/auth/forgot-password", { email });
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown error occurred during password reset request");
    }
  }
};

export const confirmPasswordReset = async (token: string, password: string, confirmPassword: string): Promise<{ success: boolean; message: string }> => {
  try {
    const response = await apiClient.post("/auth/reset-password", { 
      token, 
      password, 
      confirm_password: confirmPassword 
    });
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown error occurred during password reset confirmation");
    }
  }
};

export const logoutUser = () => {
  clearStoredAuth();
  clearAllScopedUiStorage();
};

export const getMyProfile = async (): Promise<{
  success: boolean;
  user: AuthUser;
}> => {
  try {
    const response = await apiClient.get<{ success: boolean; user: AuthUser }>(
      "/auth/me",
    );
    if (response.data?.user) {
      const token = getStoredAccessToken();
      if (token) {
        storeAuth(token, response.data.user);
      }
    }
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown error occurred while fetching profile");
    }
  }
};

export const updateMyProfile = async (payload: { username?: string; email?: string }): Promise<{ success: boolean; message: string; user: AuthUser }> => {
  try {
    const response = await apiClient.patch<{ success: boolean; message: string; user: AuthUser }>("/auth/me/profile", payload);
    if (response.data?.user) {
      const token = getStoredAccessToken();
      if (token) {
        storeAuth(token, response.data.user);
      }
    }
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown error occurred while updating profile");
    }
  }
};

export const updateMyPassword = async (payload: { old_password: string; new_password: string; confirm_password: string }): Promise<{ success: boolean; message: string }> => {
  try {
    const response = await apiClient.patch<{ success: boolean; message: string }>("/auth/me/password", payload);
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown error occurred while updating password");
    }
  }
};

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

export const createEditorProject = async (payload: {
  title: string;
  description: string;
  knowledge_base_ids: string[];
  level: string;
  format: string;
  teaching_tone?: string;
}): Promise<EditorProject> => {
  const response = await apiClient.post<EditorProject>("/projects", payload);
  return response.data;
};

export const listEditorProjects = async (
  limit: number = 100,
  offset: number = 0,
): Promise<EditorProject[]> => {
  const response = await apiClient.get<{
    success: boolean;
    projects: EditorProject[];
  }>(`/projects?limit=${limit}&offset=${offset}`);
  return response.data.projects || [];
};

export const getEditorProjectDetail = async (
  projectId: string,
): Promise<EditorProject & { sections: EditorSection[] }> => {
  const response = await apiClient.get<{
    success: boolean;
    project: EditorProject & { sections: EditorSection[] };
  }>(`/projects/${encodeURIComponent(projectId)}`);
  return response.data.project;
};

export const deleteEditorProject = async (projectId: string): Promise<void> => {
  await apiClient.delete(`/projects/${encodeURIComponent(projectId)}`);
};

export const updateEditorProject = async (
  projectId: string,
  payload: {
    title?: string;
    description?: string;
    knowledge_base_ids?: string[];
    level?: string;
    format?: string;
    teaching_tone?: string;
  },
): Promise<EditorProject> => {
  const response = await apiClient.patch<{
    success: boolean;
    project: EditorProject;
  }>(`/projects/${encodeURIComponent(projectId)}`, payload);
  return response.data.project;
};

export const createEditorSection = async (payload: {
  project_id: string;
  title: string;
  prompt?: string;
  order?: number;
}): Promise<EditorSection> => {
  const response = await apiClient.post<{
    success: boolean;
    section: EditorSection;
  }>("/sections", payload);
  return response.data.section;
};

export const deleteEditorSection = async (sectionId: string): Promise<void> => {
  await apiClient.delete(`/sections/${encodeURIComponent(sectionId)}`);
};

export const generateEditorProjectOutline = async (
  projectId: string,
  prompt: string,
): Promise<EditorSection[]> => {
  const response = await apiClient.post<{
    success: boolean;
    sections: EditorSection[];
  }>(
    `/projects/${encodeURIComponent(projectId)}/generate-outline`,
    { prompt },
    { suppressErrorToast: true } as any,
  );
  return response.data.sections || [];
};

export const patchEditorSection = async (
  sectionId: string,
  payload: {
    title?: string;
    content?: string;
    prompt?: string;
    order?: number;
  },
): Promise<EditorSection> => {
  const response = await apiClient.patch<{
    success: boolean;
    section: EditorSection;
  }>(`/sections/${encodeURIComponent(sectionId)}`, payload);
  return response.data.section;
};

export const generateEditorSection = async (payload: {
  project_id: string;
  section_id: string;
  prompt: string;
}): Promise<{
  content: string;
  retrieved_chunks: Array<{
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
  };
}> => {
  const response = await apiClient.post<{
    success: boolean;
    content: string;
    retrieved_chunks: Array<{
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
    };
  }>("/generate-section", payload, { suppressErrorToast: true } as any);
  return {
    content: response.data.content || "",
    retrieved_chunks: response.data.retrieved_chunks || [],
    evaluation: response.data.evaluation,
  };
};

export interface BatchSectionResult {
  section_id: string;
  title: string;
  content: string;
  status: "generated" | "empty";
  sentinel: string;
}

export const generateBatchSections = async (payload: {
  project_id: string;
  section_ids: string[];
  prompt: string;
}): Promise<{
  sections: Record<string, BatchSectionResult>;
  group_type: string | null;
}> => {
  const response = await apiClient.post<{
    sections: Record<string, BatchSectionResult>;
    group_type: string | null;
  }>("/generate-batch-sections", payload, { suppressErrorToast: true } as any);
  return {
    sections: response.data.sections || {},
    group_type: response.data.group_type ?? null,
  };
};


export const exportEditorProjectMarkdown = async (
  projectId: string,
): Promise<Blob> => {
  return exportEditorProject(projectId, "md");
};

export type EditorProjectExportFormat = "md" | "pdf" | "docx";

export const exportEditorProject = async (
  projectId: string,
  format: EditorProjectExportFormat,
): Promise<Blob> => {
  const response = await apiClient.get<Blob>(
    `/projects/${encodeURIComponent(projectId)}/export/${format}`,
    { responseType: "blob" },
  );
  return response.data;
};

export interface GenerateTeachingMaterialRequest {
  document_ids: string[];
  prompt: string;
  level: string;
  format?: string;
  output_format?: "lecture" | "slide" | "summary";
  length: string;
  top_k?: number;
  action?: "generate" | "regenerate" | "improve";
  improve_prompt?: string;
  previous_content?: string;
}

export interface GenerateTeachingMaterialResponse {
  success: boolean;
  content_markdown: string;
  evaluation: {
    relevance: number;
    faithfulness: number;
    completeness: number;
    clarity: number;
    strengths?: string;
    weaknesses?: string;
    improvements?: string;
  };
  contexts: TeachingContextChunk[];
  gemini_real_call: boolean;
  llm_model: string;
}

export const generateTeachingMaterial = async (
  payload: GenerateTeachingMaterialRequest,
): Promise<GenerateTeachingMaterialResponse> => {
  const normalizedPayload = {
    ...payload,
    output_format: payload.output_format || payload.format || "lecture",
  };
  const response = await apiClient.post<GenerateTeachingMaterialResponse>(
    "/generate/teaching-doc",
    normalizedPayload,
    { suppressErrorToast: true } as any,
  );
  return response.data;
};

export const regenerateTeachingMaterial = async (
  payload: GenerateTeachingMaterialRequest,
): Promise<GenerateTeachingMaterialResponse> => {
  return generateTeachingMaterial({
    ...payload,
    action: "regenerate",
  });
};

export const improveTeachingMaterial = async (
  payload: GenerateTeachingMaterialRequest & { improve_prompt: string },
): Promise<GenerateTeachingMaterialResponse> => {
  return generateTeachingMaterial({
    ...payload,
    action: "improve",
  });
};

export const secureUploadDocument = async (
  file: File,
  options?: {
    ocrMode?: "auto" | "on" | "off";
  },
  onProgress?: (progressEvent: AxiosProgressEvent) => void,
): Promise<SecureUploadResponse> => {
  try {
    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith(".pdf") && !lowerName.endsWith(".docx")) {
      throw new Error("Secure upload supports PDF hoặc DOCX");
    }
    const formData = new FormData();
    formData.append("file", file);

    const params = new URLSearchParams();
    const ocrMode = options?.ocrMode || "auto";
    if (ocrMode !== "auto") {
      params.append("ocr_mode", ocrMode);
    }

    const endpoint = params.toString()
      ? `/upload?${params.toString()}`
      : "/upload";

    const response = await apiClient.post<SecureUploadResponse>(
      endpoint,
      formData,
      {
        onUploadProgress: onProgress,
        suppressErrorToast: true,
      } as any,
    );
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown error occurred during secure upload");
    }
  }
};

export const secureUploadPdf = secureUploadDocument;

export const listSecureDocuments = async (): Promise<SecureDocument[]> => {
  try {
    const response = await apiClient.get<{
      success: boolean;
      documents: SecureDocument[];
    }>("/documents");
    return response.data.documents || [];
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown error occurred while listing secure documents");
    }
  }
};

export const deleteSecureDocument = async (
  documentId: string,
): Promise<{
  success: boolean;
  document_id: string;
  chunks_deleted: number;
  message: string;
}> => {
  try {
    const response = await apiClient.delete<{
      success: boolean;
      document_id: string;
      chunks_deleted: number;
      message: string;
    }>(`/documents/${encodeURIComponent(documentId)}`);
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown error occurred while deleting secure document");
    }
  }
};

export const getSecureDocumentDetail = async (
  documentId: string,
): Promise<SecureDocumentDetailResponse> => {
  try {
    const response = await apiClient.get<SecureDocumentDetailResponse>(
      `/documents/${encodeURIComponent(documentId)}/detail`,
    );
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown error occurred while loading document detail");
    }
  }
};

export const getSecureDocumentPreviewUrl = (documentId: string): string => {
  const safeId = encodeURIComponent(documentId);
  return `${API_BASE_URL}/documents/${safeId}/preview`;
};

export const fetchSecureDocumentPreviewBlob = async (
  documentId: string,
): Promise<Blob> => {
  try {
    const response = await apiClient.get<Blob>(
      `/documents/${encodeURIComponent(documentId)}/preview`,
      { responseType: "blob" },
    );
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown error occurred while loading document preview");
    }
  }
};

export const generateTeachingDocument = async (payload: {
  document_ids: string[];
  prompt: string;
  level: "basic" | "intermediate" | "advanced";
  output_format: "lecture" | "slide" | "summary";
  length: "short" | "medium" | "long";
  top_k?: number;
}): Promise<GenerateTeachingDocResponse> => {
  try {
    const response = await apiClient.post<GenerateTeachingDocResponse>(
      "/generate/teaching-doc",
      payload,
    );
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error(
        "Unknown error occurred while generating teaching document",
      );
    }
  }
};

export const secureGenerate = async (payload: {
  document_id: string;
  mode: "toc" | "section" | "edit" | "teaching_doc";
  topic?: string;
  section_id?: string;
  section_title?: string;
  optional_previous_summary?: string;
  user_instruction?: string;
  current_content?: string;
  prompt?: string;
  top_k?: number;
}): Promise<SecureGenerateResponse> => {
  try {
    const response = await apiClient.post<SecureGenerateResponse>(
      "/generate",
      payload,
    );
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown error occurred while generating secure content");
    }
  }
};

export const secureAskChat = async (payload: {
  document_id?: string;
  document_ids?: string[];
  conversation_id?: string;
  question: string;
  top_k?: number;
  vector_weight?: number;
  keyword_weight?: number;
  use_rerank?: boolean;
}): Promise<SecureChatResponse> => {
  try {
    const response = await apiClient.post<SecureChatResponse>("/chat", payload);
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown error occurred during secure chat");
    }
  }
};

export const secureAskChatStream = async (
  payload: {
    document_id?: string;
    document_ids?: string[];
    conversation_id?: string;
    question: string;
    top_k?: number;
    vector_weight?: number;
    keyword_weight?: number;
    use_rerank?: boolean;
  },
  onChunk: (text: string) => void,
  onMetadata: (metadata: any) => void
): Promise<void> => {
  const token = getStoredAccessToken();
  if (!token) throw new Error("Chưa đăng nhập");

  const response = await fetch(`${API_BASE_URL}/api/v1/secure/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    let errMessage = "Chat stream failed";
    try {
      const errJson = await response.json();
      errMessage = errJson.detail || errMessage;
    } catch {
      const errText = await response.text();
      if (errText) errMessage = errText;
    }
    throw new Error(errMessage);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No readable stream");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const dataStr = line.slice(6);
        try {
          const data = JSON.parse(dataStr);
          if (data.type === "metadata") {
            onMetadata(data);
          } else if (data.type === "chunk") {
            onChunk(data.content);
          } else if (data.type === "done") {
            // completed
          }
        } catch (e) {
          console.error("Error parsing SSE chunk", e, dataStr);
        }
      }
    }
  }
};

export const listChatConversations = async (): Promise<ChatConversation[]> => {
  try {
    const response = await apiClient.get<{
      success: boolean;
      conversations: ChatConversation[];
    }>("/chat/conversations");
    return response.data.conversations || [];
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown error occurred while loading conversations");
    }
  }
};

export const createChatConversation = async (payload?: {
  title?: string;
  document_id?: string;
  document_ids?: string[];
}): Promise<ChatConversation> => {
  try {
    const response = await apiClient.post<{
      success: boolean;
      conversation: ChatConversation;
    }>("/chat/conversations", payload || {});
    return response.data.conversation;
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown error occurred while creating conversation");
    }
  }
};

export const getChatMessages = async (
  conversationId: string,
): Promise<ChatMessage[]> => {
  try {
    const response = await apiClient.get<{
      success: boolean;
      conversation_id: string;
      messages: ChatMessage[];
    }>(`/chat/conversations/${encodeURIComponent(conversationId)}/messages`);
    return response.data.messages || [];
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown error occurred while loading chat messages");
    }
  }
};

export const deleteChatConversation = async (
  conversationId: string,
): Promise<void> => {
  try {
    await apiClient.delete(
      `/chat/conversations/${encodeURIComponent(conversationId)}`,
    );
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown error occurred while deleting conversation");
    }
  }
};

/**
 * Stage 1: Convert a document file to Markdown
 *
 * @param file - The document file to convert (PDF or DOCX)
 * @param options - Conversion options
 * @param options.advanced - DEPRECATED: Use cleaningMode instead
 * @param options.cleaningMode - Cleaning strategy: "standard", "advanced", or "divider"
 * @param options.ocrMode - OCR strategy for image-based PDF: "auto", "on", or "off"
 * @param options.onProgress - Optional callback for upload progress
 * @returns Promise with conversion response containing markdown text
 */
export const convertDocument = async (
  file: File,
  options?: {
    advanced?: boolean;
    cleaningMode?: "standard" | "advanced" | "divider";
    ocrMode?: "auto" | "on" | "off";
    onProgress?: (progressEvent: AxiosProgressEvent) => void;
  },
): Promise<ConvertResponse> => {
  try {
    // Validate file type
    const validTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
      "",
    ];

    const validExtensions = [".pdf", ".docx", ".doc"];
    const fileExtension = file.name
      .substring(file.name.lastIndexOf("."))
      .toLowerCase();

    const isValidByType = validTypes.includes(file.type);
    const isValidByExtension = validExtensions.includes(fileExtension);

    if (!isValidByType && !isValidByExtension) {
      throw new Error(`Only PDF and DOCX files are supported`);
    }

    // Create FormData for multipart upload
    const formData = new FormData();
    formData.append("file", file);

    // Build query parameters
    const params = new URLSearchParams();

    // Support cleaning_mode parameter, fallback to advanced if not provided
    const cleaningMode =
      options?.cleaningMode || (options?.advanced ? "advanced" : "standard");
    if (cleaningMode && cleaningMode !== "standard") {
      params.append("cleaning_mode", cleaningMode);
    }

    const ocrMode = options?.ocrMode || "auto";
    if (ocrMode !== "auto") {
      params.append("ocr_mode", ocrMode);
    }

    // Call convert endpoint
    const endpoint = params.toString()
      ? `/documents/convert?${params.toString()}`
      : "/documents/convert";

    const response = await apiClient.post<ConvertResponse>(endpoint, formData, {
      onUploadProgress: options?.onProgress,
    });

    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown error occurred during conversion");
    }
  }
};

export const getConversionSession = async (
  documentId: string,
): Promise<ConvertSessionResponse> => {
  try {
    const response = await apiClient.get<ConvertSessionResponse>(
      `/documents/convert/session/${encodeURIComponent(documentId)}`,
    );
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown error occurred while restoring session");
    }
  }
};

/**
 * Stage 2: Process Markdown text with chunking
 *
 * @param markdown - The markdown text to process
 * @param fileName - Name of the source file
 * @param chunkSize - Optional chunk size (default: 2000)
 * @param chunkOverlap - Optional chunk overlap (default: 200)
 * @returns Promise with processing response containing chunking statistics
 */
export const processDocument = async (
  markdown: string,
  fileName: string,
  chunkSize: number = 2000,
  chunkOverlap: number = 200,
): Promise<ProcessResponse> => {
  try {
    const response = await apiClient.post<ProcessResponse>(
      "/documents/process",
      {
        markdown,
        file_name: fileName,
        chunk_size: chunkSize,
        chunk_overlap: chunkOverlap,
      } as ProcessRequest,
    );

    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown error occurred during processing");
    }
  }
};

/**
 * One-shot pipeline: convert + clean + chunk + embed + index.
 */
export const runPipelineUpload = async (
  file: File,
  options?: {
    cleaningMode?: "standard" | "advanced" | "divider";
    chunkSize?: number;
    chunkOverlap?: number;
    collectionName?: string;
    onProgress?: (progressEvent: AxiosProgressEvent) => void;
  },
): Promise<PipelineResponse> => {
  try {
    const formData = new FormData();
    formData.append("file", file);

    const params = new URLSearchParams();
    params.append("cleaning_mode", options?.cleaningMode || "divider");
    if (options?.chunkSize)
      params.append("chunk_size", String(options.chunkSize));
    if (options?.chunkOverlap)
      params.append("chunk_overlap", String(options.chunkOverlap));
    if (options?.collectionName)
      params.append("collection_name", options.collectionName);

    const response = await apiClient.post<PipelineResponse>(
      `/documents/pipeline/upload?${params.toString()}`,
      formData,
      { onUploadProgress: options?.onProgress },
    );

    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown error occurred during one-shot pipeline upload");
    }
  }
};

/**
 * Chat with indexed documents using hybrid retrieval + rerank.
 */
export const askRagQuestion = async (
  question: string,
  options?: {
    collectionName?: string;
    sourceFilter?: string;
    topK?: number;
    vectorWeight?: number;
    keywordWeight?: number;
    useRerank?: boolean;
  },
): Promise<ChatResponse> => {
  try {
    const response = await apiClient.post<ChatResponse>("/documents/chat", {
      question,
      collection_name: options?.collectionName,
      source_filter: options?.sourceFilter,
      top_k: options?.topK ?? 6,
      vector_weight: options?.vectorWeight ?? 0.65,
      keyword_weight: options?.keywordWeight ?? 0.35,
      use_rerank: options?.useRerank ?? true,
    });
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown error occurred during chat request");
    }
  }
};

export const generateTocFromMarkdown = async (
  markdown: string,
  prompt: string,
  fileName?: string,
): Promise<TocFromMarkdownResponse> => {
  try {
    const response = await apiClient.post<TocFromMarkdownResponse>(
      "/documents/toc/from-markdown",
      {
        markdown,
        file_name: fileName,
        prompt,
      },
    );
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown error occurred during TOC generation");
    }
  }
};

export const extractSubsectionFromMarkdown = async (
  markdown: string,
  subsection: string,
  prompt?: string,
  options?: {
    documentId?: string;
    sectionId?: string;
    sectionTitle?: string;
    retrievedChunks?: string;
    optionalPreviousSummary?: string;
  },
): Promise<SubsectionExtractResponse> => {
  try {
    const response = await apiClient.post<SubsectionExtractResponse>(
      "/documents/subsection/extract-from-markdown",
      {
        markdown,
        subsection,
        prompt,
        document_id: options?.documentId,
        section_id: options?.sectionId,
        section_title: options?.sectionTitle,
        retrieved_chunks: options?.retrievedChunks,
        optional_previous_summary: options?.optionalPreviousSummary,
      },
    );
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown error occurred during subsection extraction");
    }
  }
};

export const selectContextChunksForSection = async (
  sectionTitle: string,
  allChunks: string,
  options?: {
    topK?: number;
    prompt?: string;
  },
): Promise<ContextSelectionResponse> => {
  try {
    const response = await apiClient.post<ContextSelectionResponse>(
      "/documents/chunks/select-for-section",
      {
        section_title: sectionTitle,
        all_chunks: allChunks,
        top_k: options?.topK ?? 5,
        prompt: options?.prompt,
      },
    );
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown error occurred during context selection");
    }
  }
};

export const editSubsectionFromInstruction = async (
  sectionTitle: string,
  currentContent: string,
  userInstruction: string,
  prompt?: string,
): Promise<SectionEditResponse> => {
  try {
    const response = await apiClient.post<SectionEditResponse>(
      "/documents/subsection/edit-from-instruction",
      {
        section_title: sectionTitle,
        current_content: currentContent,
        user_instruction: userInstruction,
        prompt,
      },
    );
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown error occurred during section edit");
    }
  }
};

export const saveStudioDraft = async (
  payload: SaveStudioDraftRequest,
): Promise<void> => {
  try {
    await apiClient.post("/save", {
      file_name: payload.fileName,
      collection_name: payload.collectionName,
      reason: payload.reason,
      sections: payload.sections,
      markdown: payload.markdown,
    });
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown error occurred during studio draft save");
    }
  }
};

/**
 * Index an existing cleaned markdown into RAG pipeline.
 */
export const indexMarkdownPipeline = async (
  markdown: string,
  fileName: string,
  pages: number = 0,
  options?: {
    collectionName?: string;
    chunkSize?: number;
    chunkOverlap?: number;
  },
): Promise<PipelineResponse> => {
  try {
    const response = await apiClient.post<PipelineResponse>(
      "/documents/pipeline/index-markdown",
      {
        markdown,
        file_name: fileName,
        pages,
        collection_name: options?.collectionName,
        chunk_size: options?.chunkSize ?? 1200,
        chunk_overlap: options?.chunkOverlap ?? 120,
      },
    );
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown error occurred during markdown indexing");
    }
  }
};

/**
 * Legacy: Upload a document file for processing (one-stage)
 *
 * @param file - The document file to upload (PDF or DOCX)
 * @param onProgress - Optional callback for upload progress
 * @returns Promise with document response
 * @deprecated Use convertDocument and processDocument instead
 */
export const uploadDocument = async (
  file: File,
  onProgress?: (progressEvent: AxiosProgressEvent) => void,
): Promise<DocumentUploadResponse> => {
  try {
    // Validate file type
    const validTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
      "",
    ];

    const validExtensions = [".pdf", ".docx", ".doc"];
    const fileExtension = file.name
      .substring(file.name.lastIndexOf("."))
      .toLowerCase();

    const isValidByType = validTypes.includes(file.type);
    const isValidByExtension = validExtensions.includes(fileExtension);

    if (!isValidByType && !isValidByExtension) {
      throw new Error(`Only PDF and DOCX files are supported`);
    }

    const formData = new FormData();
    formData.append("file", file);

    const response = await apiClient.post("/documents/upload", formData, {
      onUploadProgress: onProgress,
    });

    return response.data as DocumentUploadResponse;
  } catch (error) {
    if (error instanceof AxiosError) {
      throw new Error(handleError(error));
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error("Unknown error occurred during upload");
    }
  }
};

/**
 * Check health status of the backend
 */
export const checkHealth = async (): Promise<boolean> => {
  try {
    const response = await apiClient.get("/health");
    return response.status === 200;
  } catch (error) {
    console.error("Health check failed:", error);
    return false;
  }
};


// Admin APIs moved to the end of file with better typing


// ── Quiz ──────────────────────────────────────────────────────────────────────

export interface QuizItem {
  id: string;
  question: string;
  options: string[];
  correct_answer: string; // "A" | "B" | "C" | "D"
  explanation: string;
  restudy_hint?: string; // e.g. "Đọc lại mục 1.2"
  type: "knowledge" | "comprehension" | "application" | "analysis";
}

export interface GenerateQuizResponse {
  questions: QuizItem[];
  variation_seed: number;
}

export const generateQuiz = async (
  lessonContent: string,
  numQuestions: number = 5,
  variationSeed?: number,
): Promise<GenerateQuizResponse> => {
  const response = await apiClient.post<GenerateQuizResponse>(
    "/quiz/generate-quiz",
    {
      lesson_content: lessonContent,
      num_questions: numQuestions,
      ...(variationSeed !== undefined && { variation_seed: variationSeed }),
    },
  );
  return response.data;
};

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

export const saveQuizAttempt = async (payload: {
  score: number;
  total: number;
  num_questions: number;
  answers: Record<string, string>;
  project_id?: string;
  variation_seed?: number;
}): Promise<QuizAttemptResult> => {
  const res = await apiClient.post<QuizAttemptResult>("/quiz/save-attempt", payload);
  return res.data;
};

export const getQuizStats = async (projectId?: string): Promise<QuizStats> => {
  const params = projectId ? { project_id: projectId } : {};
  const res = await apiClient.get<QuizStats>("/quiz/stats", { params });
  return res.data;
};

export const getQuizHistory = async (projectId?: string, limit = 10) => {
  const params: Record<string, unknown> = { limit };
  if (projectId) params.project_id = projectId;
  const res = await apiClient.get<{ attempts: unknown[] }>("/quiz/history", { params });
  return res.data.attempts;
};

// ── Slides ────────────────────────────────────────────────────────────────────

export interface SlideItem {
  title: string;
  bullet_points: string[];
  speaker_notes: string;
  visual_prompt?: string;  // AI-suggested image or diagram idea for this slide
  talking_points?: string[]; // AI-suggested talking points for teacher
  estimated_duration?: number; // Estimated presentation time in seconds
}

export interface GenerateOutlineResponse {
  slides: SlideItem[];
  total: number;
}

export interface SlidesHealthResponse {
  pptx_available: boolean;
  pptx_error: string | null;
}

export const checkSlidesHealth = async (): Promise<SlidesHealthResponse> => {
  const res = await apiClient.get<SlidesHealthResponse>("/slides/health");
  return res.data;
};

export const generateSlideOutline = async (
  lessonContent: string,
  numSlides: number = 8,
): Promise<GenerateOutlineResponse> => {
  const response = await apiClient.post<GenerateOutlineResponse>(
    "/slides/generate-outline",
    { lesson_content: lessonContent, num_slides: numSlides },
  );
  return response.data;
};

export const downloadPptx = async (
  slides: SlideItem[],
  title: string = "Bài giảng",
): Promise<Blob> => {
  // axios throws AxiosError for 4xx/5xx before we can read response.data
  let blob: Blob;
  try {
    const res = await apiClient.post(
      "/slides/download-pptx",
      { slides, title },
      { responseType: "blob" },
    );
    blob = res.data as Blob;
  } catch (err: unknown) {
    const axiosData = (err as { response?: { data?: Blob } })?.response?.data;
    if (axiosData instanceof Blob) {
      try {
        const txt = await axiosData.text();
        const parsed = JSON.parse(txt) as { detail?: string };
        throw new Error(parsed.detail ?? "Xuất PPTX thất bại.");
      } catch (inner) {
        throw inner instanceof Error ? inner : new Error("Lỗi server.");
      }
    }
    throw new Error("Không kết nối được server. Kiểm tra Docker đang chạy.");
  }
  if (!blob || blob.size < 50) {
    throw new Error("File PPTX rỗng — python-pptx chưa được cài (cần rebuild Docker).");
  }
  return blob;
};

export const downloadPdf = async (slides: SlideItem[], title: string): Promise<Blob> => {
  let blob: Blob;
  try {
    const res = await apiClient.post(
      "/slides/download-pdf",
      { slides, title },
      { responseType: "blob" },
    );
    blob = res.data as Blob;
  } catch (err: unknown) {
    const axiosData = (err as { response?: { data?: Blob } })?.response?.data;
    if (axiosData instanceof Blob) {
      try {
        const txt = await axiosData.text();
        const parsed = JSON.parse(txt) as { detail?: string };
        throw new Error(parsed.detail ?? "Xuất PDF thất bại.");
      } catch (inner) { throw inner instanceof Error ? inner : new Error("Lỗi server."); }
    }
    throw new Error("Không kết nối được server.");
  }
  if (!blob || blob.size < 100) throw new Error("File PDF rỗng.");
  return blob;
};

export interface SlideDraftMeta {
  found: boolean;
  id?: number;
  title?: string;
  slides?: SlideItem[];
  layouts?: Record<string, string>;
  slide_count?: number;
  saved_at?: string;
}

export const saveSlidesDraft = async (
  projectId: string,
  title: string,
  slides: SlideItem[],
  layouts: Record<number, string>,
): Promise<{ id: number; slide_count: number; saved_at: string }> => {
  const res = await apiClient.post("/slides/save-draft", {
    project_id: projectId, title, slides,
    layouts: Object.fromEntries(Object.entries(layouts).map(([k, v]) => [String(k), v])),
  });
  return res.data;
};

export const loadSlidesDraft = async (projectId: string): Promise<SlideDraftMeta> => {
  const res = await apiClient.get<SlideDraftMeta>(`/slides/load-draft/${projectId}`);
  return res.data;
};


// ── Admin API ─────────────────────────────────────────────────────────────────

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

export const adminGetUsers = async (): Promise<AdminUser[]> => {
  const res = await apiClient.get<{ success: boolean; users: AdminUser[] }>(
    "/auth/admin/users",
  );
  return res.data.users ?? [];
};

export const adminGetDocuments = async (): Promise<AdminDocument[]> => {
  const res = await apiClient.get<{
    success: boolean;
    documents: AdminDocument[];
  }>("/auth/admin/documents");
  return res.data.documents ?? [];
};

export const adminGetUsage = async (): Promise<AdminUsageEntry[]> => {
  const res = await apiClient.get<{
    success: boolean;
    usage: AdminUsageEntry[];
  }>("/auth/admin/usage");
  return res.data.usage ?? [];
};

export const adminGetLogs = async (
  limit: number = 200,
): Promise<AdminLogEntry[]> => {
  const res = await apiClient.get<{
    success: boolean;
    logs: AdminLogEntry[];
  }>(`/auth/admin/logs?limit=${limit}`);
  return res.data.logs ?? [];
};

export const adminDeleteDocument = async (documentId: string): Promise<void> => {
  await apiClient.delete(
    `/auth/admin/documents/${encodeURIComponent(documentId)}`,
  );
};

export const adminSetUserLocked = async (
  userId: number,
  locked: boolean,
): Promise<AdminUser> => {
  const res = await apiClient.patch<{ success: boolean; user: AdminUser }>(
    `/auth/admin/users/${userId}/lock`,
    { locked },
  );
  return res.data.user;
};

export const adminDeleteUser = async (userId: number): Promise<void> => {
  await apiClient.delete(`/auth/admin/users/${userId}`);
};

export default apiClient;


export type {
  AuthTokenResponse,
  ConvertResponse,
  ConvertSessionResponse,
  ProcessResponse,
  ChunkStatistics,
  PipelineResponse,
  ChatSource,
  ChatResponse,
  TocFromMarkdownResponse,
  SubsectionExtractResponse,
};
