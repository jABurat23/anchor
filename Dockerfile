FROM node:18-alpine

# Install system dependencies (mDNS support if needed)
# Install system dependencies (mDNS support if needed)
RUN apk add --no-cache avahi-dev dbus g++ make python3

WORKDIR /app

# Install app dependencies
COPY package.json package-lock.json ./
RUN npm ci --production

# Copy app source
COPY . .

# Expose ports
EXPOSE 3333

# Start commands
CMD ["npm", "start"]
