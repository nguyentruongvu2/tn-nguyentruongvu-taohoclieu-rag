# Minimal frontend Docker image - services only
# Stage 1: Build
FROM node:18-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json .

# Install dependencies
RUN npm ci

# Build args (override for production: --build-arg VITE_API_URL=/api)
ARG VITE_API_URL=/api

# Copy source code
COPY . .

# Build (inject API URL into Vite bundle)
RUN VITE_API_URL=${VITE_API_URL} npm run build


# Stage 2: Runtime (minimal nginx for serving)
FROM nginx:alpine

# Copy built files to nginx
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000 || exit 1

# Run nginx
CMD ["nginx", "-g", "daemon off;"]
