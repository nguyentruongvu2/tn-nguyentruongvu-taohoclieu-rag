import os

source_file = 'd:/AI_RAG_Project/backend/app/routes/project_rag.py'
with open(source_file, 'r', encoding='utf-8') as f:
    lines = f.readlines()

route_start_idx = 3300
service_code = ''.join(lines[:route_start_idx])
routes_code = ''.join(lines[route_start_idx:])

imports = """\"\"\"Project-based RAG APIs (Controller).\"\"\"
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import PlainTextResponse, Response
from typing import Any
import json
import logging
from ..security import get_current_user

# Models
from ..services.project_rag_service import (
    ProjectCreateRequest, ProjectCreateResponse, ProjectUpdateRequest,
    SectionPayload, DocumentCreateRequest, DocumentResponse, OutlineRequest,
    OutlineResponse, GenerateSectionRequest, BatchGenerateRequest,
    UpdateSectionRequest, CreateSectionRequest, GenerateProjectOutlineRequest
)

# Services
from ..services.project_rag_service import *
"""

final_routes_code = imports + '\nrouter = APIRouter(tags=["project-rag"])\nlogger = logging.getLogger(__name__)\n\n' + routes_code

os.makedirs('d:/AI_RAG_Project/backend/app/services', exist_ok=True)

with open('d:/AI_RAG_Project/backend/app/services/project_rag_service.py', 'w', encoding='utf-8') as f:
    f.write(service_code)

with open('d:/AI_RAG_Project/backend/app/routes/project_rag.py', 'w', encoding='utf-8') as f:
    f.write(final_routes_code)

print('Split successfully!')
