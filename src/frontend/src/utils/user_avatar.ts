export const getAvatarUrl = (user: { username?: string; avatar_url?: string | null } | null): string => {
  const username = user?.username || "U";
  const firstLetter = username.charAt(0).toUpperCase();
  
  // Use local inline SVG Data URI as fallback so it works offline and avoids blocked external APIs
  const defaultAvatar = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="50" fill="%238b5cf6"/><text x="50" y="55" font-family="system-ui, sans-serif" font-size="40" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="middle">${firstLetter}</text></svg>`;
  
  if (!user?.avatar_url) return defaultAvatar;
  
  if (user.avatar_url.startsWith("http")) return user.avatar_url;
  
  if (user.avatar_url.startsWith("/api")) {
    const baseUrl = import.meta.env.VITE_API_BASE_URL || "/api";
    if (baseUrl === "/api") return user.avatar_url;
    return user.avatar_url.replace("/api", baseUrl);
  }
  
  return user.avatar_url;
};

