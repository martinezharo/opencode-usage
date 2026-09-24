FROM node:24-alpine

WORKDIR /app

COPY package.json ./
COPY bin ./bin
COPY lib ./lib
COPY public ./public
COPY server.mjs ./

ENV HOST=0.0.0.0
ENV PORT=4173
EXPOSE 4173

# No USER on purpose: with rootless Docker the container root maps to the host
# user, which is what makes the bind-mounted auth.json readable.
CMD ["node", "server.mjs"]
