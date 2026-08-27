# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN yarn build

FROM node:24-alpine AS dev
WORKDIR /app
RUN corepack enable
# dovecot-pigeonhole gives the sievec the rules module shells out to.
RUN apk add --no-cache dovecot-pigeonhole-plugin
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable
COPY . .
EXPOSE 8080
CMD ["yarn", "dev"]

FROM node:24-alpine AS prod
WORKDIR /app
RUN addgroup --system app && adduser --system --ingroup app app
ENV NODE_ENV=production
RUN corepack enable
RUN apk add --no-cache dovecot-pigeonhole-plugin
COPY --chown=app:app package.json yarn.lock .yarnrc.yml ./
RUN yarn workspaces focus --production && yarn cache clean --all
COPY --chown=app:app --from=build /app/dist ./dist
COPY --chown=app:app drizzle ./drizzle
# MAIL_ATTACHMENTS_DIR is a named volume. Docker creates a missing mountpoint as root, which
# the app user cannot write; owning it here is what makes Docker seed the volume as app.
RUN install -d -o app -g app /data/attachments
USER app
EXPOSE 8080
ENV NODE_OPTIONS="--max-old-space-size=384"
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "dist/main.js"]
