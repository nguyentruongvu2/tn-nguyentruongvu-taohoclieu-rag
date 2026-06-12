"""RAG pipeline orchestration service."""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

import qdrant_client
from qdrant_client.http import models

from .rag_flows.answer_generation import answer_with_gemini as flow_answer_with_gemini
from .rag_flows.answer_generation import answer_with_gemini_stream as flow_answer_with_gemini_stream
from .rag_flows.outline_generation import generate_outline as flow_generate_outline
from .rag_flows.output_formatting import format_output as flow_format_output
from .rag_flows.retrieval_loop import retrieve_until_sufficient as flow_retrieve_until_sufficient
from .rag_flows.summarization import summarize_document as flow_summarize_document
from .rag_pipeline_tasks.chunk_admin_ops import (
    delete_chunks_by_source as task_delete_chunks_by_source,
)
from .rag_pipeline_tasks.chunk_admin_ops import (
    get_chunks_by_source as task_get_chunks_by_source,
)
from .rag_pipeline_tasks.embedding_ops import (
    dominant_embedding_dims as task_dominant_embedding_dims,
)
from .rag_pipeline_tasks.embedding_ops import embed_document as task_embed_document
from .rag_pipeline_tasks.embedding_ops import embed_query as task_embed_query
from .rag_pipeline_tasks.embedding_ops import local_embedding as task_local_embedding
from .rag_pipeline_tasks.embedding_ops import (
    normalize_embedding_batch as task_normalize_embedding_batch,
)
from .rag_pipeline_tasks.indexing_ops import (
    clean_metadata as task_clean_metadata,
)
from .rag_pipeline_tasks.indexing_ops import (
    extract_page_number as task_extract_page_number,
)
from .rag_pipeline_tasks.indexing_ops import extract_title as task_extract_title
from .rag_pipeline_tasks.indexing_ops import index_markdown as task_index_markdown
from .rag_pipeline_tasks.model_management import (
    check_model_health as task_check_model_health,
)
from .rag_pipeline_tasks.model_management import (
    deduplicate_models as task_deduplicate_models,
)
from .rag_pipeline_tasks.model_management import (
    generate_content_with_failover as task_generate_content_with_failover,
    stream_content_with_failover as task_stream_content_with_failover,
)
from .rag_pipeline_tasks.model_management import (
    list_generate_models as task_list_generate_models,
)
from .rag_pipeline_tasks.model_management import (
    normalize_embedding_model_name as task_normalize_embedding_model_name,
)
from .rag_pipeline_tasks.model_management import (
    normalize_model_name as task_normalize_model_name,
)
from .rag_pipeline_tasks.model_management import parse_bool_env as task_parse_bool_env
from .rag_pipeline_tasks.model_management import (
    parse_model_list_env as task_parse_model_list_env,
)
from .rag_pipeline_tasks.model_management import (
    resolve_candidate_alias as task_resolve_candidate_alias,
)
from .rag_pipeline_tasks.model_management import (
    resolve_initial_llm_model as task_resolve_initial_llm_model,
)
from .rag_pipeline_tasks.model_management import (
    runtime_model_order as task_runtime_model_order,
)
from .rag_pipeline_tasks.retrieval_ops import keyword_search as task_keyword_search
from .rag_pipeline_tasks.retrieval_ops import rerank as task_rerank
from .rag_pipeline_tasks.retrieval_ops import retrieve_hybrid as task_retrieve_hybrid
from .rag_pipeline_tasks.retrieval_ops import (
    search_knowledge_base as task_search_knowledge_base,
)
from .rag_pipeline_tasks.retrieval_ops import tokenize as task_tokenize

logger = logging.getLogger(__name__)


class RAGPipeline:
    def __init__(self) -> None:
        self.gemini_api_key = os.getenv("GEMINI_API_KEY", "")
        self.gemini_embedding_model = self._normalize_embedding_model_name(
            os.getenv("GEMINI_EMBEDDING_MODEL", "models/gemini-embedding-001")
        )
        self.gemini_llm_model = self._normalize_model_name(os.getenv("GEMINI_LLM_MODEL", "gemini-1.5-flash"))
        self.gemini_llm_model_fallbacks = self._parse_model_list_env("GEMINI_LLM_MODEL_FALLBACKS")
        extra_candidates = self._parse_model_list_env("GEMINI_LLM_MODEL_CANDIDATES")
        self.gemini_model_auto_probe = self._parse_bool_env("GEMINI_MODEL_AUTO_PROBE", True)
        self.gemini_model_auto_failover = self._parse_bool_env("GEMINI_MODEL_AUTO_FAILOVER", True)
        self.gemini_probe_generation = self._parse_bool_env("GEMINI_MODEL_PROBE_GENERATION", False)
        self.gemini_probe_prompt = os.getenv("GEMINI_MODEL_PROBE_PROMPT", "Reply with one word: OK")
        self.gemini_llm_candidates = self._deduplicate_models(
            [self.gemini_llm_model, *self.gemini_llm_model_fallbacks, *extra_candidates]
        )

        self.cohere_api_key = os.getenv("COHERE_API_KEY", "")
        self.cohere_rerank_model = os.getenv("COHERE_RERANK_MODEL", "rerank-v3.5")

        qdrant_url = os.getenv("QDRANT_URL", "").strip()
        qdrant_dir = os.getenv("QDRANT_PERSIST_DIR", str(Path(__file__).resolve().parent.parent / "qdrant_db"))
        self.default_collection_name = os.getenv("QDRANT_COLLECTION", "rag_markdown_chunks_qdrant")

        if qdrant_url:
            try:
                self.qdrant_client = qdrant_client.QdrantClient(url=qdrant_url, timeout=3.0)
                self.qdrant_client.get_collections()
                logger.info("Connected to Qdrant server at %s", qdrant_url)
            except Exception as e:
                logger.warning("Failed to connect to Qdrant server at %s: %s. Falling back to local embedded Qdrant Client.", qdrant_url, e)
                self.qdrant_client = qdrant_client.QdrantClient(path=qdrant_dir)
        else:
            logger.info("Initializing local embedded Qdrant Client at %s", qdrant_dir)
            self.qdrant_client = qdrant_client.QdrantClient(path=qdrant_dir)

        if self.gemini_api_key:
            self.gemini_llm_model = self._resolve_initial_llm_model()

    @staticmethod
    def _normalize_model_name(name: str) -> str:
        return task_normalize_model_name(name)

    @staticmethod
    def _normalize_embedding_model_name(name: str) -> str:
        return task_normalize_embedding_model_name(name)

    @staticmethod
    def _parse_bool_env(key: str, default: bool) -> bool:
        return task_parse_bool_env(key, default)

    def _parse_model_list_env(self, key: str) -> List[str]:
        return task_parse_model_list_env(key)

    @staticmethod
    def _deduplicate_models(models: List[str]) -> List[str]:
        return task_deduplicate_models(models)

    def _list_generate_models(self) -> Set[str]:
        return task_list_generate_models()

    def _resolve_initial_llm_model(self) -> str:
        return task_resolve_initial_llm_model(self)

    @staticmethod
    def _resolve_candidate_alias(candidate: str, available: Set[str]) -> Optional[str]:
        return task_resolve_candidate_alias(candidate, available)

    def _runtime_model_order(self) -> List[str]:
        return task_runtime_model_order(self)

    @staticmethod
    def _normalize_temperature(value: Optional[float]) -> Optional[float]:
        if value is None:
            return None
        try:
            return round(max(0.0, min(1.0, float(value))), 2)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _normalize_max_output_tokens(value: Optional[int]) -> Optional[int]:
        if value is None:
            return None
        try:
            # Gemini expects positive integer; clamp conservatively for safety.
            return max(1, min(8192, int(value)))
        except (TypeError, ValueError):
            return None

    @classmethod
    def _resolve_generation_temperature(cls, prompt: str, explicit_temperature: Optional[float] = None) -> Optional[float]:
        normalized_explicit = cls._normalize_temperature(explicit_temperature)
        if normalized_explicit is not None:
            return normalized_explicit

        normalized_prompt = (prompt or "").upper()

        # Stabilize deterministic sections.
        if (
            "SYSTEM MODE: SECTION_MAIN_CONTENT." in normalized_prompt
            or "SYSTEM MODE: SECTION_INTRODUCTION." in normalized_prompt
        ):
            return 0.3

        # Allow slightly more reasoning diversity for question/example generation.
        if (
            "SYSTEM MODE: SECTION_PRACTICE_QUESTIONS." in normalized_prompt
            or "SYSTEM MODE: SECTION_EXAMPLES." in normalized_prompt
        ):
            return 0.55

        return None

    @classmethod
    def _resolve_generation_max_output_tokens(
        cls,
        prompt: str,
        explicit_max_output_tokens: Optional[int] = None,
    ) -> Optional[int]:
        normalized_explicit = cls._normalize_max_output_tokens(explicit_max_output_tokens)
        if normalized_explicit is not None:
            return normalized_explicit

        normalized_prompt = (prompt or "").upper()

        # Main content needs larger output budget to avoid truncated sentences.
        if "SYSTEM MODE: SECTION_MAIN_CONTENT." in normalized_prompt:
            return 4000

        # Learning objectives often get cut off; give extra room for complete sentences.
        if "SYSTEM MODE: SECTION_LEARNING_OBJECTIVES." in normalized_prompt:
            return 600

        return None

    def _generate_content_with_failover(
        self,
        prompt: str,
        temperature: Optional[float] = None,
        max_output_tokens: Optional[int] = None,
        response_mime_type: Optional[str] = None,
    ) -> Tuple[str, bool]:
        return task_generate_content_with_failover(
            self,
            prompt,
            temperature=temperature,
            max_output_tokens=max_output_tokens,
            response_mime_type=response_mime_type,
        )

    def check_model_health(self) -> Dict[str, object]:
        return task_check_model_health(self)

    def _collection(self, collection_name: Optional[str] = None, dims: int = 3072) -> str:
        name = collection_name or self.default_collection_name
        try:
            self.qdrant_client.get_collection(collection_name=name)
        except Exception:
            try:
                self.qdrant_client.create_collection(
                    collection_name=name,
                    vectors_config=models.VectorParams(
                        size=dims,
                        distance=models.Distance.COSINE
                    )
                )
            except Exception as e:
                logger.debug("Failed to create collection %s: %s", name, e)
        return name

    def _embed_document(self, text: str) -> List[float]:
        return task_embed_document(self, text)

    def _embed_query(self, text: str) -> List[float]:
        return task_embed_query(self, text)

    @staticmethod
    def _local_embedding(text: str, dims: int = 256) -> List[float]:
        return task_local_embedding(text, dims=dims)

    @staticmethod
    def _extract_title(markdown: str) -> str:
        return task_extract_title(markdown)

    @staticmethod
    def _extract_page_number(text: str) -> Optional[int]:
        return task_extract_page_number(text)

    @staticmethod
    def _clean_metadata(md: Dict[str, object]) -> Dict[str, object]:
        return task_clean_metadata(md)

    @staticmethod
    def _dominant_embedding_dims(embeddings: List[List[float]]) -> Optional[int]:
        return task_dominant_embedding_dims(embeddings)

    def _normalize_embedding_batch(
        self,
        texts: List[str],
        embeddings: List[List[float]],
    ) -> Tuple[List[List[float]], Optional[int]]:
        return task_normalize_embedding_batch(texts, embeddings)

    def index_markdown(
        self,
        markdown: str,
        source: str,
        collection_name: Optional[str] = None,
        chunk_size: int = 1200,
        chunk_overlap: int = 120,
        total_pages: int = 0,
        doc_id: Optional[str] = None,
        file_name: Optional[str] = None,
    ) -> Dict[str, object]:
        return task_index_markdown(
            pipeline=self,
            markdown=markdown,
            source=source,
            collection_name=collection_name,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            total_pages=total_pages,
            doc_id=doc_id,
            file_name=file_name,
        )

    @staticmethod
    def _tokenize(text: str) -> List[str]:
        return task_tokenize(text)

    def _keyword_search(
        self,
        query: str,
        collection: Collection,
        top_k: int,
        source_filter: Optional[str] = None,
    ) -> Dict[str, float]:
        return task_keyword_search(
            query=query,
            collection=collection,
            top_k=top_k,
            source_filter=source_filter,
        )

    def retrieve_hybrid(
        self,
        query: str,
        collection_name: Optional[str] = None,
        top_k: int = 6,
        vector_weight: float = 0.65,
        keyword_weight: float = 0.35,
        source_filter: Optional[str] = None,
    ) -> List[Dict[str, object]]:
        return task_retrieve_hybrid(
            pipeline=self,
            query=query,
            collection_name=collection_name,
            top_k=top_k,
            vector_weight=vector_weight,
            keyword_weight=keyword_weight,
            source_filter=source_filter,
        )

    def rerank(
        self,
        query: str,
        candidates: List[Dict[str, object]],
        top_k: int = 6,
        use_rerank: bool = True,
    ) -> Tuple[List[Dict[str, object]], bool]:
        return task_rerank(
            pipeline=self,
            query=query,
            candidates=candidates,
            top_k=top_k,
            use_rerank=use_rerank,
        )

    def answer_with_gemini(self, query: str, contexts: List[Dict[str, object]]) -> Tuple[str, bool]:
        return flow_answer_with_gemini(self, query, contexts)

    def answer_with_gemini_stream(self, query: str, contexts: List[Dict[str, object]], chat_history: str = ""):
        return flow_answer_with_gemini_stream(self, query, contexts, chat_history)

    def generate_with_gemini_from_markdown(
        self,
        markdown: str,
        prompt: str,
        temperature: Optional[float] = None,
        max_output_tokens: Optional[int] = None,
    ) -> Tuple[str, bool]:
        if not markdown.strip():
            return "", False

        if not self.gemini_api_key:
            # Fallback: return only existing markdown headings when Gemini key is unavailable.
            lines = [line.strip() for line in markdown.splitlines()]
            headings = [line for line in lines if re.match(r"^#{1,3}\s+", line)]
            return "\n".join(headings[:200]).strip(), False

        composed_prompt = f"{prompt}\n\nINPUT DOCUMENT (MARKDOWN):\n{markdown}"
        resolved_temperature = self._resolve_generation_temperature(prompt, explicit_temperature=temperature)
        resolved_max_output_tokens = self._resolve_generation_max_output_tokens(
            prompt,
            explicit_max_output_tokens=max_output_tokens,
        )
        return self._generate_content_with_failover(
            composed_prompt,
            temperature=resolved_temperature,
            max_output_tokens=resolved_max_output_tokens,
        )

    def _stream_content_with_failover(
        self,
        prompt: str,
        temperature: Optional[float] = None,
        max_output_tokens: Optional[int] = None,
    ):
        return task_stream_content_with_failover(
            self,
            prompt,
            temperature=temperature,
            max_output_tokens=max_output_tokens,
        )

    def search_knowledge_base(
        self,
        query: str,
        collection_name: Optional[str] = None,
        top_k: int = 6,
        vector_weight: float = 0.65,
        keyword_weight: float = 0.35,
        source_filter: Optional[str] = None,
        use_rerank: bool = True,
    ) -> Tuple[List[Dict[str, object]], bool]:
        return task_search_knowledge_base(
            pipeline=self,
            query=query,
            collection_name=collection_name,
            top_k=top_k,
            vector_weight=vector_weight,
            keyword_weight=keyword_weight,
            source_filter=source_filter,
            use_rerank=use_rerank,
        )

    def retrieve_until_sufficient(
        self,
        query: str,
        retrieval_tasks: List[Dict[str, object]],
        top_k_levels: Optional[List[int]] = None,
        min_unique_chunks: int = 4,
        min_total_chars: int = 1400,
        min_unique_sources: int = 1,
        final_top_k: int = 12,
        use_rerank: bool = True,
    ) -> Tuple[List[Dict[str, object]], bool, Dict[str, object]]:
        return flow_retrieve_until_sufficient(
            pipeline=self,
            query=query,
            retrieval_tasks=retrieval_tasks,
            top_k_levels=top_k_levels,
            min_unique_chunks=min_unique_chunks,
            min_total_chars=min_total_chars,
            min_unique_sources=min_unique_sources,
            final_top_k=final_top_k,
            use_rerank=use_rerank,
        )

    def summarize_document(self, text: str, max_chars: int = 7000) -> str:
        return flow_summarize_document(self, text, max_chars=max_chars)

    def generate_outline(self, topic: str, context: str) -> str:
        return flow_generate_outline(self, topic, context)

    @staticmethod
    def format_output(markdown_text: str) -> str:
        return flow_format_output(markdown_text)

    def get_chunks_by_source(
        self,
        source_tag: str,
        collection_name: Optional[str] = None,
        limit: int = 50,
    ) -> List[Dict[str, object]]:
        return task_get_chunks_by_source(
            pipeline=self,
            source_tag=source_tag,
            collection_name=collection_name,
            limit=limit,
        )

    def delete_chunks_by_source(
        self,
        source_tag: str,
        collection_name: Optional[str] = None,
    ) -> Dict[str, object]:
        return task_delete_chunks_by_source(
            pipeline=self,
            source_tag=source_tag,
            collection_name=collection_name,
        )


rag_pipeline = RAGPipeline()
