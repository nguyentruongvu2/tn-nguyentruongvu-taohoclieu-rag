from __future__ import annotations

import logging
import re
import uuid
from typing import Dict, List, Optional, Tuple, TYPE_CHECKING

from qdrant_client.http import models

from .embedding_ops import embed_query, local_embedding

try:
    import cohere
except Exception:  # pragma: no cover
    cohere = None

if TYPE_CHECKING:
    from ..rag_pipeline import RAGPipeline

logger = logging.getLogger(__name__)


def tokenize(text: str) -> List[str]:
    return re.findall(r"[a-zA-Z0-9_\-]+", text.lower())


def keyword_search(
    pipeline: "RAGPipeline",
    query: str,
    collection_name: str,
    top_k: int,
    source_filter: Optional[str | List[str]] = None,
) -> Dict[str, float]:
    q_tokens = set(tokenize(query))
    if not q_tokens:
        return {}

    must_conditions = []
    if source_filter:
        if isinstance(source_filter, list):
            must_conditions.append(
                models.FieldCondition(
                    key="source",
                    match=models.MatchAny(any=source_filter)
                )
            )
        else:
            must_conditions.append(
                models.FieldCondition(
                    key="source",
                    match=models.MatchValue(value=source_filter)
                )
            )

    scroll_filter = models.Filter(must=must_conditions) if must_conditions else None
    limit = None if scroll_filter else 3000

    try:
        scroll_res = pipeline.qdrant_client.scroll(
            collection_name=collection_name,
            scroll_filter=scroll_filter,
            limit=limit or 10000,
            with_payload=True,
            with_vectors=False
        )
        records, _ = scroll_res
    except Exception as e:
        logger.warning("Keyword search scroll failed: %s", e)
        records = []

    ids = [record.payload.get("chunk_id") or str(record.id) for record in records]
    docs = [record.payload.get("document", "") for record in records]

    scores: List[Tuple[str, float]] = []
    q_len = len(q_tokens)
    
    escaped_tokens = [re.escape(q) for q in q_tokens]
    pattern = re.compile(r'\b(' + '|'.join(escaped_tokens) + r')\b')

    for doc_id, doc_text in zip(ids, docs):
        if not doc_text:
            continue
            
        doc_lower = doc_text.lower()
        
        if not any(q in doc_lower for q in q_tokens):
            continue

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
    collection_title = pipeline._collection(collection_name)

    query_embedding = embed_query(pipeline, query)
    must_conditions = []
    if source_filter:
        if isinstance(source_filter, list):
            must_conditions.append(
                models.FieldCondition(
                    key="source",
                    match=models.MatchAny(any=source_filter)
                )
            )
        else:
            must_conditions.append(
                models.FieldCondition(
                    key="source",
                    match=models.MatchValue(value=source_filter)
                )
            )
    query_filter = models.Filter(must=must_conditions) if must_conditions else None

    try:
        col_info = pipeline.qdrant_client.get_collection(collection_name=collection_title)
        expected_dims = col_info.config.params.vectors.size
    except Exception:
        expected_dims = len(query_embedding)

    if expected_dims != len(query_embedding):
        logger.warning(
            "Embedding dimension mismatch on collection '%s' (expected=%s, got=%s). "
            "Retrying with local query embedding for backward compatibility.",
            collection_title,
            expected_dims,
            len(query_embedding),
        )
        query_embedding = local_embedding(query, dims=expected_dims)

    try:
        query_res = pipeline.qdrant_client.query_points(
            collection_name=collection_title,
            query=query_embedding,
            query_filter=query_filter,
            limit=max(top_k * 4, 10),
            with_payload=True,
            with_vectors=False
        )
        search_res = query_res.points
    except Exception as exc:
        logger.warning(
            "Qdrant vector query failed on collection '%s': %s. Falling back to keyword search.",
            collection_title,
            exc,
        )
        search_res = []

    vector_scores: Dict[str, float] = {}
    vector_payload: Dict[str, Dict[str, object]] = {}

    for record in search_res:
        payload = record.payload or {}
        chunk_id = payload.get("chunk_id") or str(record.id)
        score = float(record.score)
        vector_scores[chunk_id] = score
        
        meta = {k: v for k, v in payload.items() if k not in {"document", "chunk_id"}}
        doc_text = payload.get("document", "")

        vector_payload[chunk_id] = {
            "id": chunk_id,
            "text": doc_text,
            "metadata": meta,
            "vector_score": score,
        }

    keyword_scores = keyword_search(
        pipeline=pipeline,
        query=query,
        collection_name=collection_title,
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

    id_to_doc = {}
    if top_ids:
        try:
            qdrant_uuids = [str(uuid.uuid5(uuid.NAMESPACE_DNS, tid)) for tid in top_ids]
            records_fetched, _ = pipeline.qdrant_client.scroll(
                collection_name=collection_title,
                scroll_filter=models.Filter(
                    must=[
                        models.HasIdCondition(has_id=qdrant_uuids)
                    ]
                ),
                limit=len(top_ids),
                with_payload=True,
                with_vectors=False
            )
            for record in records_fetched:
                payload = record.payload or {}
                chunk_id = payload.get("chunk_id") or str(record.id)
                doc_text = payload.get("document", "")
                meta = {k: v for k, v in payload.items() if k not in {"document", "chunk_id"}}
                id_to_doc[chunk_id] = (doc_text, meta)
        except Exception as exc:
            logger.warning("Failed to fetch top IDs from Qdrant: %s", exc)

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
