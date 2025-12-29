# Используем легкий образ Node.js
FROM node:20-alpine

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем файлы зависимостей
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install

# Копируем исходный код
COPY . .

# Собираем проект (создает папку dist)
RUN npm run build

# Открываем 80 порт
EXPOSE 80

# Запускаем предпросмотр Vite на 80 порту (он поддерживает проксирование API)
CMD ["npm", "run", "preview"]
