from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from .rag import ChatSource


class SecureUploadResponse(BaseModel):
    success: bool
    document_id: str
    file_name: str
    collection: str
    chunks_indexed: int
    quality: Literal["good", "medium", "bad"] = "medium"
    ocr_used: bool = False
    message: str


class SecureDeleteResponse(BaseModel):
    success: bool
    document_id: str
    chunks_deleted: int
    message: str


class SecureReprocessResponse(BaseModel):
    success: bool
    document_id: str
    file_name: str
    collection: str
    chunks_deleted: int
    chunks_indexed: int
    quality: Literal["good", "medium", "bad"] = "medium"
    ocr_used: bool = False
    message: str


class GenerateRequest(BaseModel):
    document_id: str
    mode: str = Field(description="toc | section | edit | teaching_doc")
    topic: str | None = None
    section_id: str | None = None
    section_title: str | None = None
    optional_previous_summary: str | None = None
    user_instruction: str | None = None
    current_content: str | None = None
    prompt: str | None = None
    top_k: int = 5


class GenerateResponse(BaseModel):
    success: bool
    document_id: str
    mode: str
    content: str
    gemini_real_call: bool
    llm_model: str
    evaluation: dict | None = None


class SecureChatRequest(BaseModel):
    document_id: str | None = None
    document_ids: list[str] | None = None
    conversation_id: str | None = None
    question: str
    top_k: int = 10
    vector_weight: float = 0.65
    keyword_weight: float = 0.35
    use_rerank: bool = True


class SecureChatResponse(BaseModel):
    success: bool
    answer: str
    sources: list[ChatSource]
    conversation_id: str | None = None
    gemini_real_call: bool
    cohere_rerank_real_call: bool
    llm_model: str
    rerank_model: str


class ChatConversationCreateRequest(BaseModel):
    title: str | None = None
    document_id: str | None = None
    document_ids: list[str] | None = None


class ChatConversationItem(BaseModel):
    id: str
    title: str
    document_id: str | None = None
    document_ids: list[str] | None = None
    created_at: str
    updated_at: str
    last_message: str | None = None


class ChatConversationListResponse(BaseModel):
    success: bool
    conversations: list[ChatConversationItem]


class ChatConversationResponse(BaseModel):
    success: bool
    conversation: ChatConversationItem


class ChatMessageItem(BaseModel):
    id: int
    role: str
    content: str
    metadata: dict[str, Any] | None = None
    created_at: str


class ChatMessageListResponse(BaseModel):
    success: bool
    conversation_id: str
    messages: list[ChatMessageItem]


class ChatConversationDeleteResponse(BaseModel):
    success: bool
    conversation_id: str
    message: str


class SecureChunkPreview(BaseModel):
    chunk_id: str
    snippet: str
    content: str | None = None
    h1: str | None = None
    h2: str | None = None
    h3: str | None = None
    page_number: int = -1


class SecureDocumentDetailResponse(BaseModel):
    success: bool
    document: dict[str, Any]
    markdown: str
    chunks: list[SecureChunkPreview]


class TeachingContextChunk(BaseModel):
    source: str
    title: str
    page_number: int
    snippet: str
    full_text: str | None = None
    clean_content: str | None = None
    relevance: str | None = None
    file_name: str | None = None
    chapter: str | None = None
    section: str | None = None
    subsection: str | None = None
    page: str | None = None
    start_page: int | None = None
    end_page: int | None = None


class GenerateTeachingDocRequest(BaseModel):
    document_ids: list[str]
    prompt: str
    level: str = "basic"
    output_format: str = "lecture"
    # Backward compatibility with older FE payload shape.
    format: str | None = None
    length: str = "medium"
    top_k: int = 6
    action: Literal["generate", "regenerate", "improve"] = "generate"
    improve_prompt: str | None = None
    previous_content: str | None = None


class GenerateTeachingDocResponse(BaseModel):
    success: bool
    content_markdown: str
    contexts: list[TeachingContextChunk]
    evaluation: dict
    gemini_real_call: bool
    llm_model: str
