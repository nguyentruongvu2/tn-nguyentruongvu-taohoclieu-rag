/**
 * Utility to resolve the user avatar image URL.
 * If user has avatar_url, returns it prepended with base API URL.
 * Otherwise, falls back to DiceBear initials SVG.
 */
export const getAvatarUrl = (user: { username?: string; avatar_url?: string | null } | null): string => {
  const defaultAvatar = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(user?.username || "U")}&radius=50&backgroundColor=3b82f6,6366f1,8b5cf6,ec4899`;
  if (!user?.avatar_url) return defaultAvatar;
  
  if (user.avatar_url.startsWith("http")) return user.avatar_url;
  
  if (user.avatar_url.startsWith("/api")) {
    const baseUrl = import.meta.env.VITE_API_BASE_URL || "/api";
    if (baseUrl === "/api") return user.avatar_url;
    return user.avatar_url.replace("/api", baseUrl);
  }
  
  return user.avatar_url;
};
