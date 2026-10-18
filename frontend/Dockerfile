FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN printf 'VITE_API_BASE_URL=\n' > .env.production && npm run build
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx-storage.conf /etc/nginx/conf.d/default.conf
