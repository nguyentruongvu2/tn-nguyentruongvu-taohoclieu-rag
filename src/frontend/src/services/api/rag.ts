import { apiClient, getStoredAccessToken } from "./client";
import { 
  SecureGenerateResponse, 
  SecureChatResponse, 
  ChatConversation, 
  ChatMessage,
  GenerateTeachingDocResponse,
  ChatResponse,
  TocFromMarkdownResponse,
  SubsectionExtractResponse,
  ContextSelectionResponse,
  SectionEditResponse,
  PipelineResponse
} from "../../types/api";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

export const secureGenerate = async (payload: any): Promise<SecureGenerateResponse> => {
  const response = await apiClient.post<SecureGenerateResponse>("/generate", payload);
  return response.data;
};

export const secureAskChat = async (payload: any): Promise<SecureChatResponse> => {
  const response = await apiClient.post<SecureChatResponse>("/chat", payload);
  return response.data;
};

export const secureAskChatStream = async (
  payload: any,
  onChunk: (text: string) => void,
  onMetadata: (metadata: any) => void,
  onRetry?: () => void
): Promise<void> => {
  const token = getStoredAccessToken();
  if (!token) throw new Error("Chưa đăng nhập");

  const maxRetries = 2;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      const response = await fetch(`${API_BASE_URL}/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
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
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === "metadata") onMetadata(data);
              else if (data.type === "chunk") onChunk(data.content);
            } catch (e) { console.error("Error parsing SSE chunk", e); }
          }
        }
      }
      return; // Success
    } catch (error) {
      attempt++;
      console.warn(`Stream attempt ${attempt} failed:`, error);
      if (attempt > maxRetries) {
        throw new Error(`Lỗi kết nối. Vui lòng thử lại sau. (${(error as Error).message})`);
      }
      if (onRetry) onRetry();
      await new Promise(res => setTimeout(res, 2000 * attempt)); // exponential backoff
    }
  }
};

export const listChatConversations = async (): Promise<ChatConversation[]> => {
  const response = await apiClient.get<{ conversations: ChatConversation[] }>("/chat/conversations");
  return response.data.conversations || [];
};

export const createChatConversation = async (payload?: any): Promise<ChatConversation> => {
  const response = await apiClient.post<{ conversation: ChatConversation }>("/chat/conversations", payload || {});
  return response.data.conversation;
};

export const getChatMessages = async (conversationId: string): Promise<ChatMessage[]> => {
  const response = await apiClient.get<{ messages: ChatMessage[] }>(`/chat/conversations/${encodeURIComponent(conversationId)}/messages`);
  return response.data.messages || [];
};

export const deleteChatConversation = async (conversationId: string): Promise<void> => {
  await apiClient.delete(`/chat/conversations/${encodeURIComponent(conversationId)}`);
};

export const generateTeachingDocument = async (payload: any): Promise<GenerateTeachingDocResponse> => {
  const response = await apiClient.post<GenerateTeachingDocResponse>("/generate/teaching-doc", payload);
  return response.data;
};

export const askRagQuestion = async (question: string, options?: any): Promise<ChatResponse> => {
  const response = await apiClient.post<ChatResponse>("/documents/chat", {
    question,
    ...options
  });
  return response.data;
};

export const generateTocFromMarkdown = async (markdown: string, prompt: string, fileName?: string): Promise<TocFromMarkdownResponse> => {
  const response = await apiClient.post<TocFromMarkdownResponse>("/documents/toc/from-markdown", { markdown, prompt, file_name: fileName });
  return response.data;
};

export const extractSubsectionFromMarkdown = async (markdown: string, subsection: string, prompt?: string, options?: any): Promise<SubsectionExtractResponse> => {
  const response = await apiClient.post<SubsectionExtractResponse>("/documents/subsection/extract-from-markdown", { markdown, subsection, prompt, ...options });
  return response.data;
};

export const selectContextChunksForSection = async (sectionTitle: string, allChunks: string, options?: any): Promise<ContextSelectionResponse> => {
  const response = await apiClient.post<ContextSelectionResponse>("/documents/chunks/select-for-section", { section_title: sectionTitle, all_chunks: allChunks, ...options });
  return response.data;
};

export const editSubsectionFromInstruction = async (sectionTitle: string, currentContent: string, userInstruction: string, prompt?: string): Promise<SectionEditResponse> => {
  const response = await apiClient.post<SectionEditResponse>("/documents/subsection/edit-from-instruction", { section_title: sectionTitle, current_content: currentContent, user_instruction: userInstruction, prompt });
  return response.data;
};

export const indexMarkdownPipeline = async (markdown: string, fileName: string, pages: number = 0, options?: any): Promise<PipelineResponse> => {
  const response = await apiClient.post<PipelineResponse>("/documents/pipeline/index-markdown", { markdown, file_name: fileName, pages, ...options });
  return response.data;
};

export const saveStudioDraft = async (payload: any): Promise<void> => {
  await apiClient.post("/save", payload);
};

export const generateTeachingMaterial = async (payload: {
  document_ids: string[];
  prompt: string;
  level: string;
  output_format: "lecture" | "slide" | "summary";
  length: string;
}): Promise<GenerateTeachingDocResponse> => {
  return generateTeachingDocument({
    ...payload,
    action: "generate",
  });
};

export const regenerateTeachingMaterial = async (payload: {
  document_ids: string[];
  prompt: string;
  level: string;
  output_format: "lecture" | "slide" | "summary";
  length: string;
  previous_content?: string;
}): Promise<GenerateTeachingDocResponse> => {
  return generateTeachingDocument({
    ...payload,
    action: "regenerate",
  });
};

export const improveTeachingMaterial = async (payload: {
  document_ids: string[];
  prompt: string;
  level: string;
  output_format: "lecture" | "slide" | "summary";
  length: string;
  improve_prompt: string;
  previous_content?: string;
}): Promise<GenerateTeachingDocResponse> => {
  return generateTeachingDocument({
    ...payload,
    action: "improve",
  });
};
