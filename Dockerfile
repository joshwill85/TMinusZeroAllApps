FROM node:24.14.1-alpine

WORKDIR /app

COPY . .

RUN npm set progress=false && npm config set fund false && \
  npm ci

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=development

EXPOSE 3000
CMD ["npm", "run", "dev"]
