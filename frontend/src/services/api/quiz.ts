import { apiClient } from "./client";
import { GenerateQuizResponse, QuizAttemptResult, QuizStats, AnalyzeContentResponse } from "../../types/api";

export const analyzeQuizContent = async (
  lessonContent: string
): Promise<AnalyzeContentResponse> => {
  const response = await apiClient.post<AnalyzeContentResponse>(
    "/quiz/analyze-content",
    { lesson_content: lessonContent }
  );
  return response.data;
};

export const generateQuiz = async (
  lessonContent: string,
  numQuestions: number = 5,
  variationSeed?: number,
  bloomLevel?: string,
  customInstruction?: string
): Promise<GenerateQuizResponse> => {
  const response = await apiClient.post<GenerateQuizResponse>(
    "/quiz/generate-quiz",
    {
      lesson_content: lessonContent,
      num_questions: numQuestions,
      ...(variationSeed !== undefined && { variation_seed: variationSeed }),
      ...(bloomLevel && { bloom_level: bloomLevel }),
      ...(customInstruction && { custom_instruction: customInstruction }),
    },
  );
  return response.data;
};

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
