FROM node:20-alpine

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем файлы зависимостей
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install

# Копируем исходный код
COPY . .

# Собираем React приложение (создается папка dist)
RUN npm run build

# Открываем порт 80
EXPOSE 80

# Запускаем сервер (который настроен в package.json как "node server.js")
CMD ["npm", "run", "start"]
