from __future__ import annotations

import logging
import math
import re
from typing import Callable, Dict, List, Optional, Tuple, TYPE_CHECKING

from google import genai
from google.genai import types

if TYPE_CHECKING:
    from ..rag_pipeline import RAGPipeline

logger = logging.getLogger(__name__)


def local_embedding(text: str, dims: int = 256) -> List[float]:
    """Deterministic fallback embedding for local testing without API keys."""
    vec = [0.0] * dims
    tokens = re.findall(r"[a-zA-Z0-9_\-]+", text.lower())
    if not tokens:
        return vec

    for token in tokens:
        idx = hash(token) % dims
        vec[idx] += 1.0

    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def embed_document(pipeline: "RAGPipeline", text: str) -> List[float]:
    if not pipeline.gemini_api_key:
        return local_embedding(text)
    try:
        client = genai.Client(api_key=pipeline.gemini_api_key)
        response = client.models.embed_content(
            model=pipeline.gemini_embedding_model,
            contents=text,
            config=types.EmbedContentConfig(task_type="RETRIEVAL_DOCUMENT")
        )
        return response.embeddings[0].values
    except Exception as exc:
        logger.warning(
            "Gemini embedding failed for model '%s' (document mode). Falling back to local embedding. Error: %s",
            pipeline.gemini_embedding_model,
            exc,
        )
        return local_embedding(text)


def embed_documents(
    pipeline: "RAGPipeline",
    texts: List[str],
    batch_size: int = 100,
    progress_callback: Optional[Callable[[int, int], None]] = None,
) -> List[List[float]]:
    if not pipeline.gemini_api_key:
        return [local_embedding(t) for t in texts]

    embeddings: List[List[float]] = []
    quota_exhausted = False

    try:
        client = genai.Client(api_key=pipeline.gemini_api_key)
        total_texts = len(texts)
        for i in range(0, total_texts, batch_size):
            batch = texts[i : i + batch_size]
            
            if quota_exhausted:
                embeddings.extend([local_embedding(t) for t in batch])
                if progress_callback:
                    try:
                        progress_callback(len(embeddings), total_texts)
                    except Exception as cb_exc:
                        logger.warning("Progress callback failed during batch embedding: %s", cb_exc)
                continue

            try:
                response = client.models.embed_content(
                    model=pipeline.gemini_embedding_model,
                    contents=batch,
                    config=types.EmbedContentConfig(task_type="RETRIEVAL_DOCUMENT")
                )
                if len(response.embeddings) == len(batch):
                    embeddings.extend([emb.values for emb in response.embeddings])
                else:
                    raise ValueError(f"Embeddings length mismatch: expected {len(batch)}, got {len(response.embeddings)}")
            except Exception as batch_exc:
                batch_exc_str = str(batch_exc).lower()
                is_quota = "429" in batch_exc_str or "quota" in batch_exc_str or "exhausted" in batch_exc_str or "limit" in batch_exc_str
                logger.warning(
                    "Gemini batch embedding failed for batch %s-%s. Quota exhausted: %s. Error: %s.",
                    i,
                    i + len(batch),
                    is_quota,
                    batch_exc,
                )
                
                if is_quota:
                    quota_exhausted = True
                    embeddings.extend([local_embedding(t) for t in batch])
                else:
                    logger.info("Attempting individual fallback embedding for batch %s-%s.", i, i + len(batch))
                    for text in batch:
                        if quota_exhausted:
                            embeddings.append(local_embedding(text))
                        else:
                            try:
                                response = client.models.embed_content(
                                    model=pipeline.gemini_embedding_model,
                                    contents=text,
                                    config=types.EmbedContentConfig(task_type="RETRIEVAL_DOCUMENT")
                                )
                                embeddings.append(response.embeddings[0].values)
                            except Exception as ind_exc:
                                ind_exc_str = str(ind_exc).lower()
                                is_ind_quota = "429" in ind_exc_str or "quota" in ind_exc_str or "exhausted" in ind_exc_str or "limit" in ind_exc_str
                                if is_ind_quota:
                                    quota_exhausted = True
                                    logger.warning("Quota exhausted during individual fallback. Switching to local embeddings.")
                                else:
                                    logger.warning("Individual embedding failed: %s", ind_exc)
                                embeddings.append(local_embedding(text))
            
            if progress_callback:
                try:
                    progress_callback(len(embeddings), total_texts)
                except Exception as cb_exc:
                    logger.warning("Progress callback failed during batch embedding: %s", cb_exc)
    except Exception as exc:
        logger.warning(
            "Gemini embedding batch client initialization failed. Falling back to local embedding. Error: %s",
            exc,
        )
        embeddings = [local_embedding(t) for t in texts]

    return embeddings


def embed_query(pipeline: "RAGPipeline", text: str) -> List[float]:
    if not pipeline.gemini_api_key:
        return local_embedding(text)
    try:
        client = genai.Client(api_key=pipeline.gemini_api_key)
        response = client.models.embed_content(
            model=pipeline.gemini_embedding_model,
            contents=text,
            config=types.EmbedContentConfig(task_type="RETRIEVAL_QUERY")
        )
        return response.embeddings[0].values
    except Exception as exc:
        logger.warning(
            "Gemini embedding failed for model '%s' (query mode). Falling back to local embedding. Error: %s",
            pipeline.gemini_embedding_model,
            exc,
        )
        return local_embedding(text)


def dominant_embedding_dims(embeddings: List[List[float]]) -> Optional[int]:
    if not embeddings:
        return None

    counts: Dict[int, int] = {}
    for emb in embeddings:
        dims = len(emb)
        counts[dims] = counts.get(dims, 0) + 1

    # Prefer most frequent dimension; on tie, prefer larger dimension.
    return sorted(counts.items(), key=lambda x: (x[1], x[0]), reverse=True)[0][0]


def normalize_embedding_batch(
    texts: List[str],
    embeddings: List[List[float]],
) -> Tuple[List[List[float]], Optional[int]]:
    target_dims = dominant_embedding_dims(embeddings)
    if target_dims is None:
        return embeddings, None

    normalized: List[List[float]] = []
    for text, emb in zip(texts, embeddings):
        if len(emb) == target_dims:
            normalized.append(emb)
            continue

        logger.warning(
            "Embedding dims mismatch inside batch (target=%s, got=%s). "
            "Replacing chunk embedding with local fallback.",
            target_dims,
            len(emb),
        )
        normalized.append(local_embedding(text, dims=target_dims))

    return normalized, target_dims
