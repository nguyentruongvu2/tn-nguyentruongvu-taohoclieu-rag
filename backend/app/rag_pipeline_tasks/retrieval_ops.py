from __future__ import annotations

import logging
import re
from typing import Dict, List, Optional, Tuple, TYPE_CHECKING

from chromadb.api.models.Collection import Collection

from .embedding_ops import embed_query, local_embedding

try:
    import cohere
except Exception:  # pragma: no cover
    cohere = None

if TYPE_CHECKING:
    from ..rag_pipeline import RAGPipeline

logger = logging.getLogger(__name__)

_DIMENSION_MISMATCH_RE = re.compile(
    r"Collection expecting embedding with dimension of\s+(\d+),\s*got\s+(\d+)",
    re.IGNORECASE,
)


def tokenize(text: str) -> List[str]:
    return re.findall(r"[a-zA-Z0-9_\-]+", text.lower())


def keyword_search(
    query: str,
    collection: Collection,
    top_k: int,
    source_filter: Optional[str | List[str]] = None,
) -> Dict[str, float]:
    q_tokens = set(tokenize(query))
    if not q_tokens:
        return {}

    if isinstance(source_filter, list):
        where = {"source": {"$in": source_filter}}
    else:
        where = {"source": source_filter} if source_filter else None
        
    # OPTIMIZATION 1: Prevent Out-of-Memory (OOM) by capping max docs if no filter
    limit = None if where else 3000
    
    # OPTIMIZATION 2: Only include 'documents' to reduce payload size over IPC/network
    all_docs = collection.get(include=["documents"], where=where, limit=limit)
    docs = all_docs.get("documents", []) or []
    ids = all_docs.get("ids", []) or []

    scores: List[Tuple[str, float]] = []
    q_len = len(q_tokens)
    
    # OPTIMIZATION 3: Use a compiled regex for fast boundary-aware token matching
    escaped_tokens = [re.escape(q) for q in q_tokens]
    # \b matches word boundaries to avoid substring matching (e.g. "to" in "tomato")
    pattern = re.compile(r'\b(' + '|'.join(escaped_tokens) + r')\b')

    for doc_id, doc_text in zip(ids, docs):
        if not doc_text:
            continue
            
        doc_lower = doc_text.lower()
        
        # Fast pre-filter using C-optimized substring search
        if not any(q in doc_lower for q in q_tokens):
            continue

        # Exact token matching using C-optimized regex
        matches = set(pattern.findall(doc_lower))
        overlap = len(matches)
        
        if overlap > 0:
            score = overlap / q_len
            scores.append((doc_id, score))

    scores.sort(key=lambda x: x[1], reverse=True)
    return {doc_id: score for doc_id, score in scores[: top_k * 4]}


def retrieve_hybrid(
    pipeline: "RAGPipeline",
    query: str,
    collection_name: Optional[str] = None,
    top_k: int = 6,
    vector_weight: float = 0.65,
    keyword_weight: float = 0.35,
    source_filter: Optional[str | List[str]] = None,
) -> List[Dict[str, object]]:
    collection = pipeline._collection(collection_name)

    query_embedding = embed_query(pipeline, query)
    if isinstance(source_filter, list):
        where = {"source": {"$in": source_filter}}
    else:
        where = {"source": source_filter} if source_filter else None
    try:
        vector_raw = collection.query(
            query_embeddings=[query_embedding],
            n_results=max(top_k * 4, 10),
            include=["documents", "metadatas", "distances"],
            where=where,
        )
    except Exception as exc:
        msg = str(exc)
        match = _DIMENSION_MISMATCH_RE.search(msg)
        if not match:
            raise

        expected_dims = int(match.group(1))
        got_dims = int(match.group(2))
        logger.warning(
            "Embedding dimension mismatch on collection '%s' (expected=%s, got=%s). "
            "Retrying with local query embedding for backward compatibility.",
            collection.name,
            expected_dims,
            got_dims,
        )

        fallback_query_embedding = local_embedding(query, dims=expected_dims)
        vector_raw = collection.query(
            query_embeddings=[fallback_query_embedding],
            n_results=max(top_k * 4, 10),
            include=["documents", "metadatas", "distances"],
            where=where,
        )

    v_ids = vector_raw.get("ids", [[]])[0]
    v_docs = vector_raw.get("documents", [[]])[0]
    v_metas = vector_raw.get("metadatas", [[]])[0]
    v_dist = vector_raw.get("distances", [[]])[0]

    vector_scores: Dict[str, float] = {}
    vector_payload: Dict[str, Dict[str, object]] = {}

    for doc_id, doc, meta, dist in zip(v_ids, v_docs, v_metas, v_dist):
        score = 1.0 / (1.0 + float(dist))
        vector_scores[doc_id] = score
        vector_payload[doc_id] = {
            "id": doc_id,
            "text": doc,
            "metadata": meta or {},
            "vector_score": score,
        }

    keyword_scores = keyword_search(
        query,
        collection,
        top_k=top_k,
        source_filter=source_filter,
    )

    all_ids = set(vector_scores.keys()) | set(keyword_scores.keys())
    blended: List[Tuple[str, float]] = []
    for doc_id in all_ids:
        vector_score = vector_scores.get(doc_id, 0.0)
        keyword_score = keyword_scores.get(doc_id, 0.0)
        hybrid = (vector_weight * vector_score) + (keyword_weight * keyword_score)
        blended.append((doc_id, hybrid))

    blended.sort(key=lambda x: x[1], reverse=True)
    top_ids = [doc_id for doc_id, _ in blended[: top_k * 3]]

    if top_ids:
        fetched = collection.get(ids=top_ids, include=["documents", "metadatas"])
        id_to_doc = {
            doc_id: (doc, metadata)
            for doc_id, doc, metadata in zip(
                fetched.get("ids", []),
                fetched.get("documents", []),
                fetched.get("metadatas", []),
            )
        }
    else:
        id_to_doc = {}

    merged_results: List[Dict[str, object]] = []
    for doc_id, hybrid_score in blended[: top_k * 3]:
        doc, metadata = id_to_doc.get(
            doc_id,
            (
                vector_payload.get(doc_id, {}).get("text", ""),
                vector_payload.get(doc_id, {}).get("metadata", {}),
            ),
        )
        merged_results.append(
            {
                "id": doc_id,
                "text": doc,
                "metadata": metadata or {},
                "vector_score": vector_scores.get(doc_id, 0.0),
                "keyword_score": keyword_scores.get(doc_id, 0.0),
                "hybrid_score": hybrid_score,
            }
        )

    return merged_results[: top_k * 3]


def rerank(
    pipeline: "RAGPipeline",
    query: str,
    candidates: List[Dict[str, object]],
    top_k: int = 6,
    use_rerank: bool = True,
) -> Tuple[List[Dict[str, object]], bool]:
    if not candidates:
        return [], False

    if not use_rerank or not pipeline.cohere_api_key or cohere is None:
        ordered = sorted(candidates, key=lambda x: x.get("hybrid_score", 0.0), reverse=True)
        return ordered[:top_k], False

    try:
        client = cohere.Client(pipeline.cohere_api_key)
        response = client.rerank(
            model=pipeline.cohere_rerank_model,
            query=query,
            documents=[candidate.get("text", "") for candidate in candidates],
            top_n=top_k,
        )

        reranked: List[Dict[str, object]] = []
        for item in response.results:
            idx = int(item.index)
            candidate = candidates[idx]
            candidate = {**candidate, "rerank_score": float(item.relevance_score)}
            reranked.append(candidate)
        return reranked, True
    except Exception as exc:
        logger.warning("Cohere rerank failed, fallback to hybrid score: %s", exc)
        ordered = sorted(candidates, key=lambda x: x.get("hybrid_score", 0.0), reverse=True)
        return ordered[:top_k], False


def search_knowledge_base(
    pipeline: "RAGPipeline",
    query: str,
    collection_name: Optional[str] = None,
    top_k: int = 6,
    vector_weight: float = 0.65,
    keyword_weight: float = 0.35,
    source_filter: Optional[str] = None,
    use_rerank: bool = True,
) -> Tuple[List[Dict[str, object]], bool]:
    candidates = retrieve_hybrid(
        pipeline=pipeline,
        query=query,
        collection_name=collection_name,
        top_k=top_k,
        vector_weight=vector_weight,
        keyword_weight=keyword_weight,
        source_filter=source_filter,
    )
    return rerank(
        pipeline=pipeline,
        query=query,
        candidates=candidates,
        top_k=top_k,
        use_rerank=use_rerank,
    )
