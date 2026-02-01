---
title: "9. Docker Compose"
# tags:
#   - docker
#   - debugging
#   - troubleshooting
draft: false
---


Running one container with `docker run` is fine. Running four containers (API, DB, cache, UI) with long commands and manual networks is pain. **Docker Compose** solves this by letting you describe your whole stack in a single YAML file and manage it with a few short commands.

---

## 1. Why Compose exists

## The pain of raw `docker run`

A realistic microservice stack might need for each container:

- `--name`
- `-p` port mappings
- `--network`
- `-e` environment variables
- `-v` volumes

For an `api` + `db` stack, that’s already two ugly commands you must remember and retype, and it gets much worse with more services. Recreating the same environment on another machine is error‑prone.

## YAML as “docker run on steroids”

Docker Compose lets you write a **declarative** description of your stack in `docker-compose.yml`:

- Each service describes its image, ports, environment, volumes, networks.
- Compose takes care of:
  - Creating the network(s).
  - Starting services in the right order (with `depends_on` as a hint).
  - Wiring DNS names (service names) for container‑to‑container communication.

One file becomes your **local environment definition** that you can version‑control and share.

---

## 2. Core concepts

At a high level, Compose YAML has three main sections you use most often:

1. **services** – each container you want to run.
2. **volumes** – named volumes for persistent storage.
3. **networks** – logical networks connecting services.

Example skeleton:

```
version: "3.9"

services:
  api:
    image: myorg/orders-api:1.0.0
    ports:
      - "8080:8080"
    environment:
      DB_HOST: db

  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_PASSWORD: secret
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:

networks:
  # optional to declare explicitly; Compose creates a default one if omitted
```

Mental model:

- **services.api** and **services.db** are like named `docker run` definitions.
- **volumes.pgdata** is like `docker volume create pgdata`.
- Compose automatically creates a dedicated **network** for this stack, and connects all services to it.

One `docker-compose.yml` = one **stack** (your “local environment”).

---

## 3. Walking through a simple stack

Let’s build a concrete `api` + `db` stack.

## Compose file

```
version: "3.9"

services:
  db:
    image: postgres:15-alpine
    container_name: orders-db
    environment:
      POSTGRES_DB: orders
      POSTGRES_USER: orders_user
      POSTGRES_PASSWORD: secret
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  api:
    image: myorg/orders-api:1.0.0
    container_name: orders-api
    depends_on:
      - db
    environment:
      DB_HOST: db        # service name, not host IP
      DB_PORT: 5432
      DB_NAME: orders
      DB_USER: orders_user
      DB_PASSWORD: secret
    ports:
      - "8080:8080"

volumes:
  pgdata:
```

What Compose does when you run `docker compose up`:

1. Creates a **network** (e.g., `foldername_default`).
2. Starts `db` on that network with hostname `db`.
3. Starts `api` on the same network with hostname `api`.
4. Sets env vars inside each container as defined.
5. Publishes host ports:
   - Host `5432` → container `db:5432`.
   - Host `8080` → container `api:8080`.

Service‑to‑service communication:

- `api` reaches the database using `DB_HOST=db` (Docker‑provided DNS name).
- You don’t care about the actual container IPs.

From your host:

- `psql -h localhost -p 5432 -U orders_user orders`
- `curl http://localhost:8080/actuator/health`

This is exactly the networking and volumes mental model you already built, but declared in YAML instead of manual `docker run` flags.

---

## 4. Developer workflows

Compose gives you a few key commands that cover almost all daily needs.

Assume you have `docker-compose.yml` in the current directory.

## 4.1 Bring up the stack

`docker compose up -d`

- `-d` runs in detached mode.
- Creates the network and volumes if they don’t exist.
- Starts all services.

To see what’s running:

`docker compose ps`

## 4.2 Logs

To see logs for all services:

```
docker compose logs
# or follow:
docker compose logs -f
```

For just the API:

bash

`docker compose logs -f api`

## 4.3 Restarting services

If you’ve rebuilt the image or changed configuration:

bash

`docker compose restart api`

This restarts **only** the `api` service, leaving `db` and others alone.

When code changes and you rebuild the image:

```
docker build -t myorg/orders-api:1.0.1 .
docker compose up -d api
```

Compose compares the new image and recreates just that service.

## 4.4 Stopping and cleaning up

To stop containers but keep volumes/networks:

bash

`docker compose down`

To also remove volumes (careful: data loss for DB):

bash

`docker compose down -v`

In dev:

- Use `docker compose down` when you just want to stop the stack.
- Use `-v` when you want a completely fresh environment (fresh DB, etc.).

---

## 5. Patterns and best practices

## 5.1 Separate override files for local dev vs CI

Compose supports multiple files:

- Base file: `docker-compose.yml` (common definition).
- Overrides: `docker-compose.override.yml`, `docker-compose.dev.yml`, etc.

Example:

docker-compose.yml (base):

```
services:
  api:
    image: myorg/orders-api:1.0.0
    environment:
      DB_HOST: db
  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_PASSWORD: secret
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:

```

docker-compose.override.yml (local dev specifics):

```
services:
  api:
    build: .
    image: myorg/orders-api:dev
    ports:
      - "8080:8080"
  db:
    ports:
      - "5432:5432"
```

Then:
`docker compose up -d`

automatically applies both base and override. In CI, you might use only the base file or a different override (e.g., no host port exposure).

This pattern:

- Keeps environment‑independent config in one place.
- Keeps environment‑specific tweaks (ports, build vs image, debug tools) in overrides.

## 5.2 Healthchecks in Compose for better startup order

Compose’s `depends_on` only ensures start **order**, not readiness. Your DB may start its process but not yet be ready to accept connections.

You can define healthchecks at the service level:

```
services:
  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_PASSWORD: secret
    healthcheck:
      test: ["CMD-SHELL","pg_isready -U postgres"]
      interval: 10s
      timeout: 3s
      retries: 5

  api:
    image: myorg/orders-api:1.0.0
    depends_on:
      db:
        condition: service_healthy
```

Now:

- Compose waits until `db` is marked `healthy` before starting `api`.
- This avoids common “API can’t connect to DB on startup” races in local dev.

## 5.3 Avoid re‑encoding docker run flags

Let Compose own most of the configuration:

- Put ports, env, volumes, networks into YAML, not CLI flags.
- Use `docker compose` commands instead of `docker run` for those services.

`docker run` is still fine for one‑off debug containers (alpine shells, tools). For your **stack**, Compose should be the source of truth.

---

## 6. Bridge to Kubernetes

Compose is conceptually very close to how you define workloads in Kubernetes; the vocabulary changes, but the mental model stays.

Mapping:

- Compose **service** → Kubernetes **Deployment** (or StatefulSet) + **Service**.
- Compose **volumes** → Kubernetes **PersistentVolumes** and **PersistentVolumeClaims**.
- Compose **networks** → Kubernetes cluster network and Service discovery (DNS names).
- Compose **environment variables** → Kubernetes Pod env vars.

Example concept mapping for `api` + `db`:

- `services.api`:
  - `image: myorg/orders-api:1.0.0` → `Deployment.spec.template.spec.containers[0].image`.
  - `ports: "8080:8080"` → `Service` exposing port 8080 externally.
  - `environment` → Pod env vars.
- `services.db`:
  - `volumes: pgdata:/var/lib/postgresql/data` → PVC + volume mount.
  - `healthcheck` → liveness/readiness probes.

So by getting comfortable with:

- Declaring services, volumes, and networks in YAML.
- Using service names instead of IPs.
- Managing multi‑container lifecycles with a few commands.

you’re building intuition that transfers almost 1:1 into Kubernetes manifests and Helm charts later.
