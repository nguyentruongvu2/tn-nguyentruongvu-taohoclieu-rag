import { apiClient } from "./client";
import { AdminUser, AdminDocument, AdminUsageEntry, AdminLogEntry, AdminStats } from "../../types/api";

export const adminGetUsers = async (): Promise<AdminUser[]> => {
  const res = await apiClient.get<{ success: boolean; users: AdminUser[] }>("/auth/admin/users");
  return res.data.users ?? [];
};

export const adminGetStats = async (): Promise<AdminStats> => {
  const res = await apiClient.get<{ success: boolean; stats: AdminStats }>("/auth/admin/stats");
  return res.data.stats;
};

export const adminGetDocuments = async (): Promise<AdminDocument[]> => {
  const res = await apiClient.get<{ success: boolean; documents: AdminDocument[] }>("/auth/admin/documents");
  return res.data.documents ?? [];
};

export const adminGetUsage = async (): Promise<AdminUsageEntry[]> => {
  const res = await apiClient.get<{ success: boolean; usage: AdminUsageEntry[] }>("/auth/admin/usage");
  return res.data.usage ?? [];
};

export const adminGetLogs = async (limit: number = 200): Promise<AdminLogEntry[]> => {
  const res = await apiClient.get<{ success: boolean; logs: AdminLogEntry[] }>(`/auth/admin/logs?limit=${limit}`);
  return res.data.logs ?? [];
};

export const adminDeleteDocument = async (documentId: string): Promise<void> => {
  await apiClient.delete(`/auth/admin/documents/${encodeURIComponent(documentId)}`);
};

export const adminSetUserLocked = async (userId: number, locked: boolean): Promise<AdminUser> => {
  const res = await apiClient.patch<{ success: boolean; user: AdminUser }>(`/auth/admin/users/${userId}/lock`, { locked });
  return res.data.user;
};

export const adminDeleteUser = async (userId: number): Promise<void> => {
  await apiClient.delete(`/auth/admin/users/${userId}`);
};
