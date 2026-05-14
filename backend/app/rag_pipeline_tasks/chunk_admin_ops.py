from __future__ import annotations

import re
from typing import Dict, List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from ..rag_pipeline import RAGPipeline


def get_chunks_by_source(
    pipeline: "RAGPipeline",
    source_tag: str,
    collection_name: Optional[str] = None,
    limit: int = 50,
) -> List[Dict[str, object]]:
    source = (source_tag or "").strip()
    if not source:
        return []

    collection = pipeline._collection(collection_name)
    safe_limit = max(1, min(200, int(limit)))
    raw = collection.get(
        where={"source": source},
        include=["documents", "metadatas"],
    )

    ids = raw.get("ids", []) or []
    docs = raw.get("documents", []) or []
    metas = raw.get("metadatas", []) or []

    chunks: List[Dict[str, object]] = []
    for chunk_id, text, metadata in zip(ids, docs, metas):
        chunks.append(
            {
                "chunk_id": str(chunk_id),
                "text": str(text or ""),
                "metadata": metadata or {},
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

    collection = pipeline._collection(collection_name)

    before_raw = collection.get(where={"source": source}, include=[])
    before_ids = before_raw.get("ids", []) or []
    before_count = len(before_ids)

    if before_count > 0:
        collection.delete(where={"source": source})

    after_raw = collection.get(where={"source": source}, include=[])
    after_ids = after_raw.get("ids", []) or []
    remaining_count = len(after_ids)

    return {
        "success": remaining_count == 0,
        "deleted_count": max(0, before_count - remaining_count),
        "remaining_count": remaining_count,
    }
