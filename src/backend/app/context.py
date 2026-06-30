import contextvars

# ContextVar containing a dict with request-scoped LLM stats: {"llm_calls": int, "token_usage": int}
request_usage_var = contextvars.ContextVar("request_usage", default=None)
