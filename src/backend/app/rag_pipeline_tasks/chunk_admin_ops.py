from __future__ import annotations

import logging
import re
from typing import Dict, List, Optional, TYPE_CHECKING

from qdrant_client.http import models

if TYPE_CHECKING:
    from ..rag_pipeline import RAGPipeline

logger = logging.getLogger(__name__)


def get_chunks_by_source(
    pipeline: "RAGPipeline",
    source_tag: str,
    collection_name: Optional[str] = None,
    limit: int = 50,
) -> List[Dict[str, object]]:
    source = (source_tag or "").strip()
    if not source:
        return []

    collection_title = pipeline._collection(collection_name)
    safe_limit = max(1, min(200, int(limit)))

    try:
        scroll_res = pipeline.qdrant_client.scroll(
            collection_name=collection_title,
            scroll_filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="source",
                        match=models.MatchValue(value=source)
                    )
                ]
            ),
            limit=safe_limit,
            with_payload=True,
            with_vectors=False
        )
        records, _ = scroll_res
    except Exception as e:
        logger.warning("Qdrant scroll failed: %s", e)
        records = []

    chunks: List[Dict[str, object]] = []
    for record in records:
        payload = record.payload or {}
        chunk_id = payload.get("chunk_id") or str(record.id)
        text = payload.get("document") or ""
        metadata = {k: v for k, v in payload.items() if k not in {"document", "chunk_id"}}
        chunks.append(
            {
                "chunk_id": str(chunk_id),
                "text": str(text or ""),
                "metadata": metadata,
            }
        )

    def _chunk_order_key(item: Dict[str, object]) -> tuple[int, str]:
        chunk_id = str(item.get("chunk_id", ""))
        match = re.search(r"__chunk_(\d+)__", chunk_id)
        if match:
            return (int(match.group(1)), chunk_id)
        return (10**9, chunk_id)

    chunks.sort(key=_chunk_order_key)
    return chunks[:safe_limit]


def delete_chunks_by_source(
    pipeline: "RAGPipeline",
    source_tag: str,
    collection_name: Optional[str] = None,
) -> Dict[str, object]:
    source = (source_tag or "").strip()
    if not source:
        return {"success": True, "deleted_count": 0, "remaining_count": 0}

    collection_title = pipeline._collection(collection_name)

    try:
        scroll_res = pipeline.qdrant_client.scroll(
            collection_name=collection_title,
            scroll_filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="source",
                        match=models.MatchValue(value=source)
                    )
                ]
            ),
            limit=10000,
            with_payload=False,
            with_vectors=False
        )
        records, _ = scroll_res
        before_count = len(records)
    except Exception:
        before_count = 0

    if before_count > 0:
        try:
            pipeline.qdrant_client.delete(
                collection_name=collection_title,
                points_selector=models.FilterSelector(
                    filter=models.Filter(
                        must=[
                            models.FieldCondition(
                                key="source",
                                match=models.MatchValue(value=source)
                            )
                        ]
                    )
                )
            )
        except Exception as e:
            logger.warning("Qdrant delete failed for source %s: %s", source, e)

    try:
        scroll_res_after = pipeline.qdrant_client.scroll(
            collection_name=collection_title,
            scroll_filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="source",
                        match=models.MatchValue(value=source)
                    )
                ]
            ),
            limit=100,
            with_payload=False,
            with_vectors=False
        )
        records_after, _ = scroll_res_after
        remaining_count = len(records_after)
    except Exception:
        remaining_count = 0

    return {
        "success": remaining_count == 0,
        "deleted_count": max(0, before_count - remaining_count),
        "remaining_count": remaining_count,
    }
