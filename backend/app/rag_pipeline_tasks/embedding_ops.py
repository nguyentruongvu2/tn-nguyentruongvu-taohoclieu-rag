from __future__ import annotations

import logging
import math
import re
from typing import Dict, List, Optional, Tuple, TYPE_CHECKING

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
