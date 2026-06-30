import { AxiosError } from "axios";
import { apiClient, handleError, storeAuth, getStoredAccessToken, clearStoredAuth, clearAllScopedUiStorage, getStoredAuthUser } from "./client";
import { AuthUser, AuthTokenResponse, RegisterResponse } from "../../types/api";

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
    if (error instanceof AxiosError) throw new Error(handleError(error));
    throw error;
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
      avatar_url: tokenPayload.user.avatar_url,
    };
  } catch (error) {
    if (error instanceof AxiosError) throw new Error(handleError(error));
    throw error;
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
    const response = await apiClient.get<{ success: boolean; user: AuthUser }>("/auth/me");
    if (response.data?.user) {
      const token = getStoredAccessToken();
      if (token) storeAuth(token, response.data.user);
    }
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) throw new Error(handleError(error));
    throw error;
  }
};

export const updateMyProfile = async (payload: { username?: string; email?: string }): Promise<{ success: boolean; message: string; user: AuthUser }> => {
  try {
    const response = await apiClient.patch<{ success: boolean; message: string; user: AuthUser }>("/auth/me/profile", payload);
    if (response.data?.user) {
      const token = getStoredAccessToken();
      if (token) storeAuth(token, response.data.user);
    }
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) throw new Error(handleError(error));
    throw error;
  }
};

export const updateMyPassword = async (payload: { old_password: string; new_password: string; confirm_password: string }): Promise<{ success: boolean; message: string }> => {
  try {
    const response = await apiClient.patch<{ success: boolean; message: string }>("/auth/me/password", payload);
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) throw new Error(handleError(error));
    throw error;
  }
};

export const requestPasswordReset = async (email: string): Promise<{ success: boolean; message: string }> => {
  try {
    const response = await apiClient.post("/auth/forgot-password", { email });
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) throw new Error(handleError(error));
    throw error;
  }
};

export const confirmPasswordReset = async (token: string, password: string, confirmPassword: string): Promise<{ success: boolean; message: string }> => {
  try {
    const response = await apiClient.post("/auth/reset-password", { token, password, confirm_password: confirmPassword });
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) throw new Error(handleError(error));
    throw error;
  }
};

export const uploadAvatar = async (file: File): Promise<{ success: boolean; message: string; avatar_url: string }> => {
  try {
    const formData = new FormData();
    formData.append("file", file);
    const response = await apiClient.post<{ success: boolean; message: string; avatar_url: string }>("/auth/me/avatar", formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });
    const user = getStoredAuthUser();
    const token = getStoredAccessToken();
    if (user && token) {
      user.avatar_url = response.data.avatar_url;
      storeAuth(token, user);
    }
    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) throw new Error(handleError(error));
    throw error;
  }
};
