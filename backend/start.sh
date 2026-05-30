#!/bin/bash
# Khởi động Redis server chạy ngầm
redis-server --daemonize yes

# Chờ một chút để Redis khởi động hoàn toàn
sleep 2

# Khởi động Backend bằng Gunicorn với timeout 120s để tránh 502 khi tạo nhiều câu hỏi
exec gunicorn app.main:app --workers 4 --worker-class uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000 --timeout 120
