# Use Node.js LTS alpine image
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install

# Copy backend source code
COPY . .

# Expose the port the app runs on
EXPOSE 8080

# Start the application
CMD ["npm", "start"]
