# IssueScout Production Dockerfile
FROM node:20-alpine

# Set non-root user and production environment
ENV NODE_ENV=production
ENV PORT=4173
ENV HOST=0.0.0.0

WORKDIR /app

# Copy application files
COPY package.json LICENSE README.md server.mjs app.js styles.css index.html ./

# Create non-root user and group
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:4173/health || exit 1

EXPOSE 4173

CMD ["node", "server.mjs"]
