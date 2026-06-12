from __future__ import annotations

import logging
import os
import re
from typing import Dict, List, Optional, Set, Tuple, TYPE_CHECKING

from google import genai
from google.genai import types

if TYPE_CHECKING:
    from ..rag_pipeline import RAGPipeline

logger = logging.getLogger(__name__)


def normalize_model_name(name: str) -> str:
    cleaned = (name or "").strip()
    if cleaned.startswith("models/"):
        cleaned = cleaned.split("/", 1)[1]
    return cleaned


def normalize_embedding_model_name(name: str) -> str:
    cleaned = (name or "").strip()
    if not cleaned:
        return "models/gemini-embedding-001"
    if cleaned.startswith("models/"):
        return cleaned
    return f"models/{cleaned}"


def parse_bool_env(key: str, default: bool) -> bool:
    value = os.getenv(key)
    if value is None:
        return default
    normalized = value.strip().lower()
    return normalized in {"1", "true", "yes", "y", "on"}


def deduplicate_models(models: List[str]) -> List[str]:
    seen: Set[str] = set()
    ordered: List[str] = []
    for model_name in models:
        normalized = (model_name or "").strip()
        if not normalized:
            continue
        if normalized not in seen:
            ordered.append(normalized)
            seen.add(normalized)
    return ordered


def parse_model_list_env(key: str) -> List[str]:
    raw = os.getenv(key, "")
    if not raw.strip():
        return []
    parts = re.split(r"[,;\n]", raw)
    return deduplicate_models([normalize_model_name(part) for part in parts if part.strip()])


def list_generate_models() -> Set[str]:
    available: Set[str] = set()
    try:
        api_key = os.getenv("GEMINI_API_KEY", "")
        if not api_key:
            return available
        client = genai.Client(api_key=api_key)
        for model in client.models.list():
            actions = getattr(model, "supported_actions", []) or []
            if "generateContent" not in actions:
                continue
            name = normalize_model_name(getattr(model, "name", ""))
            if name:
                available.add(name)
    except Exception as exc:
        logger.warning("Cannot list Gemini models: %s", exc)
    return available


def resolve_candidate_alias(candidate: str, available: Set[str]) -> Optional[str]:
    if candidate in available:
        return candidate

    prefix_hits = [name for name in available if name.startswith(candidate + "-")]
    if prefix_hits:
        latest_hits = [name for name in prefix_hits if name.endswith("-latest")]
        if latest_hits:
            return sorted(latest_hits)[0]

        preview_hits = [name for name in prefix_hits if "-preview" in name]
        if preview_hits:
            return sorted(preview_hits)[0]

        return sorted(prefix_hits)[0]

    contains_hits = [name for name in available if candidate in name]
    if contains_hits:
        return sorted(contains_hits)[0]

    return None


def resolve_initial_llm_model(pipeline: "RAGPipeline") -> str:
    if not pipeline.gemini_model_auto_probe:
        return pipeline.gemini_llm_model

    available = list_generate_models()
    if not available:
        return pipeline.gemini_llm_model

    resolved_candidates: List[str] = []
    for candidate in pipeline.gemini_llm_candidates:
        resolved = resolve_candidate_alias(candidate, available)
        if resolved:
            resolved_candidates.append(resolved)

    if resolved_candidates:
        pipeline.gemini_llm_candidates = deduplicate_models(resolved_candidates)
        selected = pipeline.gemini_llm_candidates[0]
        if selected != pipeline.gemini_llm_model:
            logger.info("Using available Gemini model '%s' from candidate list.", selected)
        return selected

    logger.warning(
        "No configured Gemini model is currently listed by API. Keeping '%s'.",
        pipeline.gemini_llm_model,
    )
    return pipeline.gemini_llm_model


def runtime_model_order(pipeline: "RAGPipeline") -> List[str]:
    if not pipeline.gemini_model_auto_failover:
        return [pipeline.gemini_llm_model]
    return deduplicate_models([pipeline.gemini_llm_model, *pipeline.gemini_llm_candidates])

def generate_content_with_failover(
    pipeline: "RAGPipeline",
    prompt: str,
    temperature: Optional[float] = None,
    max_output_tokens: Optional[int] = None,
    response_mime_type: Optional[str] = None,
) -> Tuple[str, bool]:
    errors: List[str] = []
    
    config_args = {}
    if temperature is not None:
        config_args["temperature"] = temperature
    if max_output_tokens is not None:
        config_args["max_output_tokens"] = max_output_tokens
    if response_mime_type is not None:
        config_args["response_mime_type"] = response_mime_type

    client = genai.Client(api_key=pipeline.gemini_api_key)

    for model_name in runtime_model_order(pipeline):
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(**config_args) if config_args else None
            )
            text = (getattr(response, "text", "") or "").strip()
            if text:
                if model_name != pipeline.gemini_llm_model:
                    logger.info("Gemini failover switch: '%s' -> '%s'", pipeline.gemini_llm_model, model_name)
                    pipeline.gemini_llm_model = model_name
                return text, True
            errors.append(f"{model_name}: empty response")
        except Exception as exc:
            errors.append(f"{model_name}: {exc}")
            logger.warning("Gemini generation failed on model '%s': %s", model_name, exc)

    raise RuntimeError("All configured Gemini models failed. " + " | ".join(errors))


def stream_content_with_failover(
    pipeline: "RAGPipeline",
    prompt: str,
    temperature: Optional[float] = None,
    max_output_tokens: Optional[int] = None,
):
    errors: List[str] = []
    
    config_args = {}
    if temperature is not None:
        config_args["temperature"] = temperature
    if max_output_tokens is not None:
        config_args["max_output_tokens"] = max_output_tokens

    client = genai.Client(api_key=pipeline.gemini_api_key)

    for model_name in runtime_model_order(pipeline):
        try:
            response = client.models.generate_content_stream(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(**config_args) if config_args else None
            )
            
            yielded_anything = False
            for chunk in response:
                text = (getattr(chunk, "text", "") or "")
                if text:
                    yield text
                    yielded_anything = True
            
            if yielded_anything:
                if model_name != pipeline.gemini_llm_model:
                    logger.info("Gemini failover switch: '%s' -> '%s'", pipeline.gemini_llm_model, model_name)
                    pipeline.gemini_llm_model = model_name
                return
            else:
                errors.append(f"{model_name}: empty response")
        except Exception as exc:
            errors.append(f"{model_name}: {exc}")
            logger.warning("Gemini streaming failed on model '%s': %s", model_name, exc)

    raise RuntimeError("All configured Gemini models failed for streaming. " + " | ".join(errors))


def check_model_health(pipeline: "RAGPipeline") -> Dict[str, object]:
    result: Dict[str, object] = {
        "api_key_configured": bool(pipeline.gemini_api_key),
        "active_model": pipeline.gemini_llm_model,
        "candidates": pipeline.gemini_llm_candidates,
        "available_models": [],
        "generate_test": {},
    }
    if not pipeline.gemini_api_key:
        return result

    available = sorted(list_generate_models())
    result["available_models"] = available

    if pipeline.gemini_probe_generation:
        checks: Dict[str, object] = {}
        client = genai.Client(api_key=pipeline.gemini_api_key)
        for model_name in runtime_model_order(pipeline):
            try:
                response = client.models.generate_content(
                    model=model_name, 
                    contents=pipeline.gemini_probe_prompt
                )
                text = (getattr(response, "text", "") or "").strip()
                checks[model_name] = {
                    "ok": bool(text),
                    "preview": text[:120],
                }
            except Exception as exc:
                checks[model_name] = {
                    "ok": False,
                    "error": str(exc),
                }
        result["generate_test"] = checks

    return result
