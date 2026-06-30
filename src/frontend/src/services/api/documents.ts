import { AxiosError, AxiosProgressEvent } from "axios";
import { apiClient, handleError } from "./client";
import { 
  SecureDocument, 
  SecureUploadResponse, 
  SecureDocumentDetailResponse,
  ConvertResponse,
  ConvertSessionResponse,
  ProcessResponse,
  PipelineResponse
} from "../../types/api";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

export const secureUploadDocument = async (
  file: File,
  options?: { ocrMode?: "auto" | "on" | "off" },
  onProgress?: (progressEvent: AxiosProgressEvent) => void,
): Promise<SecureUploadResponse> => {
  try {
    const formData = new FormData();
    formData.append("file", file);
    const params = new URLSearchParams();
    if (options?.ocrMode && options.ocrMode !== "auto") params.append("ocr_mode", options.ocrMode);
    const endpoint = params.toString() ? `/upload?${params.toString()}` : "/upload";
    const response = await apiClient.post<SecureUploadResponse>(endpoint, formData, {
      onUploadProgress: onProgress,
      suppressErrorToast: true,
    } as any);
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) throw new Error(handleError(error));
    throw error;
  }
};

export const listSecureDocuments = async (): Promise<SecureDocument[]> => {
  const response = await apiClient.get<{ success: boolean; documents: SecureDocument[] }>("/documents");
  return response.data.documents || [];
};

export const deleteSecureDocument = async (documentId: string) => {
  const response = await apiClient.delete(`/documents/${encodeURIComponent(documentId)}`);
  return response.data;
};

export const getSecureDocumentReferences = async (documentId: string): Promise<{ success: boolean; projects: string[] }> => {
  const response = await apiClient.get(`/documents/${encodeURIComponent(documentId)}/references`);
  return response.data;
};

export const getSecureDocumentDetail = async (documentId: string): Promise<SecureDocumentDetailResponse> => {
  const response = await apiClient.get<SecureDocumentDetailResponse>(`/documents/${encodeURIComponent(documentId)}/detail`);
  return response.data;
};

export const getSecureDocumentPreviewUrl = (documentId: string): string => {
  return `${API_BASE_URL}/documents/${encodeURIComponent(documentId)}/preview`;
};

export const fetchSecureDocumentPreviewBlob = async (documentId: string): Promise<Blob> => {
  const response = await apiClient.get<Blob>(`/documents/${encodeURIComponent(documentId)}/preview`, { responseType: "blob" });
  return response.data;
};

export const convertDocument = async (
  file: File,
  options?: {
    cleaningMode?: "standard" | "advanced" | "divider";
    ocrMode?: "auto" | "on" | "off";
    onProgress?: (progressEvent: AxiosProgressEvent) => void;
  },
): Promise<ConvertResponse> => {
  const formData = new FormData();
  formData.append("file", file);
  const params = new URLSearchParams();
  if (options?.cleaningMode) params.append("cleaning_mode", options.cleaningMode);
  if (options?.ocrMode) params.append("ocr_mode", options.ocrMode);
  
  const response = await apiClient.post<ConvertResponse>(`/documents/convert?${params.toString()}`, formData, {
    onUploadProgress: options?.onProgress,
  });
  return response.data;
};

export const getConversionSession = async (documentId: string): Promise<ConvertSessionResponse> => {
  const response = await apiClient.get<ConvertSessionResponse>(`/documents/convert/session/${encodeURIComponent(documentId)}`);
  return response.data;
};

export const processDocument = async (
  markdown: string,
  fileName: string,
  chunkSize: number = 2000,
  chunkOverlap: number = 200,
): Promise<ProcessResponse> => {
  const response = await apiClient.post<ProcessResponse>("/documents/process", {
    markdown,
    file_name: fileName,
    chunk_size: chunkSize,
    chunk_overlap: chunkOverlap,
  });
  return response.data;
};

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
  const formData = new FormData();
  formData.append("file", file);
  const params = new URLSearchParams();
  params.append("cleaning_mode", options?.cleaningMode || "divider");
  if (options?.chunkSize) params.append("chunk_size", String(options.chunkSize));
  if (options?.chunkOverlap) params.append("chunk_overlap", String(options.chunkOverlap));
  if (options?.collectionName) params.append("collection_name", options.collectionName);

  const response = await apiClient.post<PipelineResponse>(`/documents/pipeline/upload?${params.toString()}`, formData, {
    onUploadProgress: options?.onProgress,
  });
  return response.data;
};
