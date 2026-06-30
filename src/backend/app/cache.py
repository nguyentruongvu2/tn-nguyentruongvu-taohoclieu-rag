import hashlib
import json
from fastapi import Request
from starlette.responses import Response

def chat_key_builder(
    func,
    namespace: str = "",
    request: Request = None,
    response: Response = None,
    *args,
    **kwargs,
):
    """
    Key builder for POST /chat and POST /chat/stream.
    Hashes the document_id and user message to create a cache key.
    """
    # Extract the payload from kwargs (assumes the endpoint has a pydantic model named 'payload' or 'req')
    payload = kwargs.get("payload") or kwargs.get("req")
    if not payload:
        return f"{namespace}:{func.__module__}:{func.__name__}:default"
    
    # Depending on the schema, extract relevant fields to cache
    doc_id = getattr(payload, "document_id", "")
    message = getattr(payload, "message", "")
    conv_id = getattr(payload, "conversation_id", "")
    
    # We only cache if it's the exact same document, conversation, and message.
    # Note: If memory/chat history is used, conversation_id is crucial.
    raw_str = f"{doc_id}:{conv_id}:{message}"
    
    key_hash = hashlib.md5(raw_str.encode("utf-8")).hexdigest()
    return f"{namespace}:{func.__module__}:{func.__name__}:{key_hash}"
