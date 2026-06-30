#!/bin/bash
# Khởi động Redis server chạy ngầm
redis-server --daemonize yes

# Chờ một chút để Redis khởi động hoàn toàn
sleep 2

# Khởi động Backend bằng Gunicorn với timeout 300s để tránh 502 khi tải lên và xử lý tài liệu lớn
exec gunicorn app.main:app --workers 2 --worker-class uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000 --timeout 300
