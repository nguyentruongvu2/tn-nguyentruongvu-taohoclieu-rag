import axios, { AxiosInstance, AxiosError, AxiosHeaders } from "axios";
import { toastService } from "../toastService";
import { AuthUser } from "../../types/api";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

export const AUTH_TOKEN_STORAGE_KEY = "rag.auth.access_token";
export const AUTH_USER_STORAGE_KEY = "rag.auth.user";
export const DASHBOARD_STORAGE_PREFIX = "rag_dashboard_state";
export const GENERATE_STORAGE_PREFIX = "rag_generate_form_state";

export const LEGACY_UI_STORAGE_KEYS = [
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

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 300000,
});

export const canUseStorage = () => typeof window !== "undefined";

export const clearLegacyUiStorage = () => {
  if (!canUseStorage()) return;
  for (const key of LEGACY_UI_STORAGE_KEYS) {
    window.localStorage.removeItem(key);
  }
};

export const clearUiStorageByPrefix = (prefix: string) => {
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

export const clearStoredAuth = () => {
  if (!canUseStorage()) return;
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(AUTH_USER_STORAGE_KEY);
  window.sessionStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  window.sessionStorage.removeItem(AUTH_USER_STORAGE_KEY);
  clearLegacyUiStorage();
};

export const storeAuth = (token: string, user: AuthUser, persist: boolean = true) => {
  if (!canUseStorage()) return;
  const previousUser = getStoredAuthUser();
  if (previousUser && Number(previousUser.user_id) !== Number(user.user_id)) {
    clearAllScopedUiStorage();
  }
  clearLegacyUiStorage();
  
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(AUTH_USER_STORAGE_KEY);
  window.sessionStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  window.sessionStorage.removeItem(AUTH_USER_STORAGE_KEY);

  const storage = persist ? window.localStorage : window.sessionStorage;
  storage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  storage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user));

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("auth-update"));
  }
};

export const handleError = (error: AxiosError): string => {
  if (error.response) {
    const data = error.response.data as any;
    if (error.response.status === 401) {
      const url = error.config?.url || "";
      const isAuthEndpoint = url.includes("auth/login") || url.includes("auth/register") || url.includes("/login") || url.includes("/register");
      if (isAuthEndpoint) {
        if (data?.message) return data.message;
        if (data?.detail) {
          if (typeof data.detail === "string") return data.detail;
          if (typeof data.detail === "object" && data.detail.message) return data.detail.message;
        }
      }
      return "Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.";
    }
    if (data && data.detail) {
      if (typeof data.detail === "string") return data.detail;
      if (typeof data.detail === "object" && data.detail.message) return data.detail.message;
      if (Array.isArray(data.detail)) {
        return data.detail.map((err: any) => `${err.loc?.[err.loc.length - 1] || "field"}: ${err.msg}`).join("; ");
      }
    }
    if (Array.isArray(data?.errors) && data.errors.length > 0) {
      return data.errors.map((err: any) => err?.message || "Dữ liệu không hợp lệ.").join("\n");
    }
    if (data?.message) return data.message;
    if (error.response.status === 422) return "Dữ liệu không hợp lệ. Vui lòng kiểm tra lại thông tin.";
    return `Lỗi máy chủ (${error.response.status}). Vui lòng thử lại.`;
  } else if (error.request) {
    return "Không nhận được phản hồi từ máy chủ. Vui lòng kiểm tra backend.";
  }
  return `Lỗi gửi yêu cầu: ${error.message}`;
};

const shouldSkipSystemErrorToast = (error: AxiosError): boolean => {
  if (error.code === "ERR_CANCELED") return true;
  const config = (error.config || {}) as any;
  if (config.suppressErrorToast) return true;
  const url = config.url || "";
  return url.startsWith("/auth/login") || url.startsWith("/auth/register");
};

apiClient.interceptors.request.use((config) => {
  const token = getStoredAccessToken();
  if (!token) return config;
  const url = config.url || "";
  if (url.startsWith("/auth/login") || url.startsWith("/auth/register")) return config;
  if (!config.headers) config.headers = new AxiosHeaders();
  if (config.headers instanceof AxiosHeaders) {
    if (!config.headers.get("Authorization")) config.headers.set("Authorization", `Bearer ${token}`);
  } else {
    const headers = config.headers as any;
    if (!headers.Authorization) headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      const url = error.config?.url || "";
      if (!url.startsWith("/auth/login") && !url.startsWith("/auth/register")) {
        clearStoredAuth();
      }
    }
    if (!shouldSkipSystemErrorToast(error)) {
      toastService.error(handleError(error));
    }
    return Promise.reject(error);
  }
);

export const hasStoredAuthSession = (): boolean => {
  return !!getStoredAccessToken();
};
