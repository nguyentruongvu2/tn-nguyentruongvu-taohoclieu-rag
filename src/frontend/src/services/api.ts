/**
 * API service module (Modularized)
 * Handles all HTTP communication with the FastAPI backend.
 * 
 * This file is now a proxy to the modularized services in ./api/
 */

export * from "./api/index";
export { apiClient as default } from "./api/client";

// Re-export types for backward compatibility
export * from "../types/api";
