/**
 * Type definitions for document processing API
 */

/**
 * Document metadata from cleaning stage
 */
export interface DocumentMetadata {
  title?: string | null;
  page_count: number;
  chapters: string[];
  repeated_headers: string[];
  repeated_footers: string[];
}

/**
 * Response from document upload endpoint
 */
export interface DocumentUploadResponse {
  filename: string;
  markdown_content: string;
  original_filename: string;
  upload_timestamp: string;
  metadata?: DocumentMetadata | null;
}

/**
 * Document processing state in UI
 */
export interface DocumentState {
  isLoading: boolean;
  error: string | null;
  document: DocumentUploadResponse | null;
}

/**
 * Upload progress tracking
 */
export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}
