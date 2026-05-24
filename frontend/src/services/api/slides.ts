import { apiClient } from "./client";
import { SlideItem, GenerateOutlineResponse, SlidesHealthResponse } from "../../types/api";

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
  templatePath?: string
): Promise<Blob> => {
  try {
    const res = await apiClient.post(
      "/slides/download-pptx",
      { slides, title, template_path: templatePath },
      { responseType: "blob" },
    );
    return res.data as Blob;
  } catch (err: any) {
    throw new Error("Xuất PPTX thất bại. Kiểm tra backend.");
  }
};

export const downloadPdf = async (slides: SlideItem[], title: string): Promise<Blob> => {
  try {
    const res = await apiClient.post(
      "/slides/download-pdf",
      { slides, title },
      { responseType: "blob" },
    );
    return res.data as Blob;
  } catch (err: any) {
    throw new Error("Xuất PDF thất bại.");
  }
};

export const uploadTemplate = async (file: File): Promise<{ success: boolean; template_path: string; filename: string }> => {
  const formData = new FormData();
  formData.append("file", file);
  const res = await apiClient.post("/slides/upload-template", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  return res.data;
};

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

export const loadSlidesDraft = async (projectId: string): Promise<any> => {
  const res = await apiClient.get(`/slides/load-draft/${projectId}`);
  return res.data;
};
