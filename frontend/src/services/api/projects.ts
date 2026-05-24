import { apiClient } from "./client";
import { EditorProject, EditorSection, BatchSectionResult } from "../../types/api";

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

export const generateEditorSection = async (payload: {
  project_id: string;
  section_id: string;
  prompt: string;
}): Promise<{
  content: string;
  retrieved_chunks: any[];
  evaluation?: any;
}> => {
  const response = await apiClient.post<{
    success: boolean;
    content: string;
    retrieved_chunks: any[];
    evaluation?: any;
  }>("/generate-section", payload, { suppressErrorToast: true } as any);
  return {
    content: response.data.content || "",
    retrieved_chunks: response.data.retrieved_chunks || [],
    evaluation: response.data.evaluation,
  };
};

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

export const exportEditorProjectMarkdown = async (projectId: string): Promise<Blob> => {
  return exportEditorProject(projectId, "md");
};
