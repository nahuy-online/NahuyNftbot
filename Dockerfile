# Этап 1: Сборка React приложения
FROM node:18-alpine as build
WORKDIR /app

# Копируем файлы зависимостей
COPY package.json package-lock.json* ./
# Устанавливаем зависимости
RUN npm install

# Копируем исходный код и собираем проект
COPY . .
RUN npm run build

# Этап 2: Запуск Nginx
FROM nginx:alpine

# Удаляем стандартный конфиг default.conf, чтобы не мешал
RUN rm -rf /etc/nginx/conf.d/default.conf

# Копируем собранные файлы фронтенда из папки dist (Vite собирает в dist)
COPY --from=build /app/dist /usr/share/nginx/html

# ВАЖНО: Копируем наш кастомный конфиг, ЗАМЕНЯЯ основной конфиг Nginx
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
