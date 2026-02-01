---
title: "Docker Cheatsheet"
# tags:
#   - Docker Cheatsheet
#   - docker
#   - debugging
#   - troubleshooting
draft: false
---

## Docker Cheatsheet – Developer & DevOps Reference

This page provides a concise, command-focused reference for common Docker tasks
used by developers and DevOps engineers. It is intended for quick lookup during
development, debugging, and operational troubleshooting.

The commands are grouped by use case and reflect practical, real-world workflows
rather than exhaustive coverage.

## Images

- List images: `docker images`
- Pull image: `docker pull nginx:1.25-alpine`
- Build image: `docker build -t myorg/app:1.0.0 .`
- Build no cache: `docker build --no-cache -t myorg/app:1.0.0 .`
- Tag image: `docker tag myorg/app:1.0.0 myorg/app:latest`
- Push image: `docker push myorg/app:1.0.0`
- Inspect image: `docker inspect myorg/app:1.0.0`
- Image history: `docker history myorg/app:1.0.0`
- Prune unused images: `docker image prune -f`
- Prune all unused: `docker image prune -a -f`

## Containers – Run & Lifecycle

- Run interactive: `docker run --rm -it alpine:3.19 sh`
- Run detached + port + name: `docker run -d --name web -p 8080:80 nginx:1.25-alpine`
- Run with limits: `docker run -d --name web -p 8080:80 --cpus="1" --memory="512m" nginx:1.25-alpine`
- Run with restart: `docker run -d --restart=on-failure --name api -p 8080:8080 myorg/api:1.0.0`
- List running: `docker ps`
- List all: `docker ps -a`
- Stop container: `docker stop web`
- Start container: `docker start web`
- Remove container: `docker rm web`
- Logs follow: `docker logs -f web`
- Exec shell: `docker exec -it web sh`
- Inspect container: `docker inspect web`
- Resource stats: `docker stats`

## Networking

- List networks: `docker network ls`
- Create bridge network: `docker network create app-net`
- Run on network (db):  
   `docker run -d --name db --network app-net -e POSTGRES_PASSWORD=secret postgres:15-alpine`
- Run on network (api):  
   `docker run -d --name api --network app-net -e DB_HOST=db myorg/api:1.0.0`
- Connect existing container: `docker network connect app-net api`
- Inspect network: `docker network inspect app-net`
- Host network: `docker run --net=host nginx:1.25-alpine`
- None network: `docker run --network none alpine:3.19`

## Volumes & Persistence

- Create volume: `docker volume create pgdata`
- List volumes: `docker volume ls`
- Inspect volume: `docker volume inspect pgdata`
- Prune volumes: `docker volume prune -f`
- Named volume (Postgres):  
   `docker run -d --name db -e POSTGRES_PASSWORD=secret -v pgdata:/var/lib/postgresql/data postgres:15-alpine`
- Bind mount (dev):  
   `docker run -d --name web-dev -p 3000:3000 -v "$PWD/src:/usr/src/app" node:22-alpine sh -c "cd /usr/src/app && npm install && npm run dev"`

## Dockerfile – Core Snippets

- Base image: `FROM eclipse-temurin:21-jre-alpine`
- Run command: `RUN apk add --no-cache curl`
- Copy files: `COPY app.jar /app/app.jar`
- Workdir: `WORKDIR /app`
- Env var: `ENV SPRING_PROFILES_ACTIVE=prod`
- Build‑time arg:  
   `ARG BUILD_VERSION=dev`  
   `LABEL version="${BUILD_VERSION}"`
- Expose port: `EXPOSE 8080`
- Non‑root user:  
   `RUN addgroup -S app && adduser -S app -G app`  
   `USER app`
- Entrypoint + cmd:  
   `ENTRYPOINT ["java","-jar","app.jar"]`  
   `CMD ["--spring.profiles.active=prod"]`
- Healthcheck:  
   `HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost:8080/actuator/health || exit 1`

## Multi‑Stage Builds

- Node example:

         ```
         FROM node:22-alpine AS build
         WORKDIR /app
         COPY package*.json ./
         RUN npm ci
         COPY . .
         RUN npm run build

         FROM nginx:1.25-alpine
         COPY --from=build /app/dist /usr/share/nginx/html
         EXPOSE 80
         CMD ["nginx","-g","daemon off;"]

         ```

## Security Essentials

- Drop root in Dockerfile: `USER app` (after creating user)
- Drop all caps, add minimal:  
   `docker run -d --name web --cap-drop=ALL --cap-add=NET_BIND_SERVICE -p 80:80 nginx:1.25-alpine`
- Read‑only FS:  
   `docker run -d --name api --read-only -v app-tmp:/tmp myorg/api:1.0.0`

## Registries & Tagging

- Login: `docker login my-registry.example.com`
- Tag for registry:  
   `docker tag myorg/api:1.0.0 my-registry.example.com/myorg/api:1.0.0`
- Push: `docker push my-registry.example.com/myorg/api:1.0.0`

## Docker Compose – Essentials

- `docker-compose.yml` minimal:

         ```
         services:
         db:
            image: postgres:15-alpine
            environment:
               POSTGRES_PASSWORD: secret
            volumes:
               - pgdata:/var/lib/postgresql/data
         api:
            image: myorg/orders-api:1.0.0
            ports:
               - "8080:8080"
            environment:
               DB_HOST: db
         volumes:
         pgdata:

         ```

- Bring up: `docker compose up -d`
- Status: `docker compose ps`
- Logs: `docker compose logs -f api`
- Tear down: `docker compose down`

## Troubleshooting Quickies

- Shell into container: `docker exec -it api sh`
- Check env: `docker inspect api`
- Check mounts: `docker inspect api`
- Check ports: `docker ps`
- Test from host: `curl http://localhost:8080/actuator/health`
