from __future__ import annotations

from typing import Dict, List, Optional, Tuple, TYPE_CHECKING

if TYPE_CHECKING:
    from ..rag_pipeline import RAGPipeline


def retrieve_until_sufficient(
    pipeline: "RAGPipeline",
    query: str,
    retrieval_tasks: List[Dict[str, object]],
    top_k_levels: Optional[List[int]] = None,
    min_unique_chunks: int = 4,
    min_total_chars: int = 1400,
    min_unique_sources: int = 1,
    final_top_k: int = 12,
    use_rerank: bool = True,
) -> Tuple[List[Dict[str, object]], bool, Dict[str, object]]:
    """Retrieve context in a single pass with speculative expansion for speed."""

    safe_query = (query or "").strip()
    if not safe_query or not retrieval_tasks:
        return [], False, {
            "sufficient": False,
            "reason": "missing_query_or_tasks",
            "attempts": [],
        }

    levels = top_k_levels or [3, 4, 5, 6, 8, 10, 12]
    levels = sorted({max(1, int(v)) for v in levels})
    safe_final_top_k = max(1, int(final_top_k or 12))

    # ONE-PASS Speculative Retrieval: Fetch the max needed + buffer
    max_fetch_k = max(levels[-1] if levels else 12, safe_final_top_k) + 4

    merged_by_id: Dict[str, Dict[str, object]] = {}
    any_rerank_real_call = False

    # Fetch all candidates in ONE round trip per task
    for task in retrieval_tasks:
        collection_name = str(task.get("collection_name") or "") or None
        source_filter = task.get("source_filter")
        if not isinstance(source_filter, list):
            source_filter = str(source_filter or "") or None
        vector_weight = float(task.get("vector_weight", 0.65) or 0.65)
        keyword_weight = float(task.get("keyword_weight", 0.35) or 0.35)

        retrieved, rerank_real_call = pipeline.search_knowledge_base(
            query=safe_query,
            collection_name=collection_name,
            top_k=max_fetch_k,
            vector_weight=vector_weight,
            keyword_weight=keyword_weight,
            source_filter=source_filter,
            use_rerank=use_rerank,
        )
        any_rerank_real_call = any_rerank_real_call or rerank_real_call

        for item in retrieved:
            chunk_id = str(item.get("id") or "")
            if not chunk_id:
                continue
            score = float(item.get("rerank_score", item.get("hybrid_score", 0.0)))
            prev = merged_by_id.get(chunk_id)
            if prev is None or float(prev.get("_score", -1.0)) < score:
                merged_by_id[chunk_id] = {**item, "_score": score}

    # Sort all fetched chunks globally
    all_merged = list(merged_by_id.values())
    all_merged.sort(key=lambda x: float(x.get("_score", 0.0)), reverse=True)

    attempts: List[Dict[str, object]] = []

    # Simulate the progressive sufficiency check from the pre-fetched pool
    for top_k in levels:
        # Take a slice of the globally sorted chunks up to top_k
        current_slice = all_merged[:top_k]

        total_chars = sum(len(str(item.get("text", "") or "")) for item in current_slice)
        unique_sources = {
            str((item.get("metadata") or {}).get("source") or "")
            for item in current_slice
            if isinstance(item.get("metadata"), dict)
        }
        unique_sources.discard("")

        sufficient = (
            len(current_slice) >= max(1, int(min_unique_chunks))
            and total_chars >= max(200, int(min_total_chars))
            and len(unique_sources) >= max(1, int(min_unique_sources))
        )

        attempts.append(
            {
                "top_k": top_k,
                "merged_chunks": len(current_slice),
                "total_chars": total_chars,
                "unique_sources": len(unique_sources),
                "sufficient": sufficient,
            }
        )

        if sufficient:
            return current_slice, any_rerank_real_call, {
                "sufficient": True,
                "attempts": attempts,
                "final_top_k": top_k,
                "merged_chunks": len(current_slice),
                "total_chars": total_chars,
                "unique_sources": len(unique_sources),
            }

    # If no level is sufficient, fallback to final_top_k slice
    final_slice = all_merged[:safe_final_top_k]
    total_chars = sum(len(str(item.get("text", "") or "")) for item in final_slice)
    unique_sources = {
        str((item.get("metadata") or {}).get("source") or "")
        for item in final_slice
        if isinstance(item.get("metadata"), dict)
    }
    unique_sources.discard("")

    return final_slice, any_rerank_real_call, {
        "sufficient": False,
        "attempts": attempts,
        "final_top_k": levels[-1] if levels else safe_final_top_k,
        "merged_chunks": len(final_slice),
        "total_chars": total_chars,
        "unique_sources": len(unique_sources),
    }
