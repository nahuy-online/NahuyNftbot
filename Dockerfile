# Этап 1: Сборка React приложения
FROM node:18-alpine as build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

# Этап 2: Запуск Nginx
FROM nginx:alpine
# Удаляем дефолтный конфиг, чтобы не мешал
RUN rm -rf /etc/nginx/conf.d/default.conf

# Копируем статику
COPY --from=build /app/dist /usr/share/nginx/html

# ВАЖНО: Копируем наш конфиг в основной файл конфигурации Nginx
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
