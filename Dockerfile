# Build the static site, then serve it with nginx.
FROM node:20-alpine AS build
WORKDIR /site
COPY . .
ARG SITE_URL=https://pro.occpllogistics.com
RUN SITE_URL=$SITE_URL node build.mjs

FROM nginx:1.27-alpine
COPY --from=build /site/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
# The courier backend that answers tracking. COURIER_API_HOST must be its host name.
ENV COURIER_API=https://courier.dev.occplsoftech.com \
    COURIER_API_HOST=courier.dev.occplsoftech.com \
    NGINX_ENVSUBST_FILTER=^COURIER_
EXPOSE 80
