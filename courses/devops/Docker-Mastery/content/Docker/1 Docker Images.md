---
title: "1. Docker Images"
# tags:
#   - docker
#   - debugging
#   - troubleshooting
draft: false
---

If containers are lightweight processes, images are the immutable blueprints
that define what those processes look like at runtime.

This article walks from mental models to real Dockerfile behavior.

## 1. Mental Model: Image vs Container vs Registry

Before touching commands, fix this mental picture in your head:

- **Image**
  - A read‑only, versioned filesystem template plus metadata.
  - Think: “frozen snapshot of a root filesystem + config”.
- **Container**
  - A running (or stopped) Linux process that **uses** an image as its root filesystem, plus a small writable layer on top.
  - Think: “image + runtime state”.
- **Registry**
  - A remote storage for images, similar to a Git server for code.
  - Docker Hub, ECR, GCR, GitHub Container Registry, etc.

Workflow in one sentence:  
You build an image locally → tag it → push it to a registry → pull and run it on other machines (or clusters).

---

## 2. Image Internals: Layers and the Build Graph

Docker images are not single files; they’re stacks of **layers**, usually implemented via a union filesystem. Each layer:

- Represents a change to the filesystem (add files, remove files, modify files).
- Is identified by a content hash.
- Is immutable once created.
- Can be shared between images to save space and speed up pulls.

When you write a Dockerfile:

```

FROM eclipse-temurin:21-jre-alpine

WORKDIR /app
COPY app.jar /app/app.jar
CMD ["java","-jar","app.jar"]

```

Conceptually, Docker does something like this:

1. Start from the base image `eclipse-temurin:21-jre-alpine` (many layers already).
2. Add a layer that creates/sets `WORKDIR /app`.
3. Add a layer that copies `app.jar`.
4. Add metadata for the `CMD`.

Each instruction produces a new layer **if it changes the filesystem**. That layering is exactly what powers Docker’s build cache and efficient distribution.

---

## 3. Build Cache: Why Instruction Order Matters

The Docker build cache works from **top to bottom** of your Dockerfile:

- For each instruction, Docker checks: “Have I seen this same instruction with the same inputs before?”
- If yes, it can reuse the previously built layer instead of rebuilding it.
- If no (e.g., different files, different command), it must rebuild from that point downward.

That means:

- If you put `COPY . .` near the top, any change in your source tree invalidates cache for **all later steps**, including heavy dependency installs.
- If you separate dependency steps from source code, you can avoid re‑downloading dependencies on every small code change.

Example: Java Maven app.

**Suboptimal Dockerfile:**

```
FROM eclipse-temurin:21-jdk-alpine

WORKDIR /app
COPY . .
RUN mvn -q -B package -DskipTests
CMD ["java","-jar","target/app.jar"]

```

Every time you change any file in the repo, `COPY . .` changes → cache invalidation from there down → Maven redownloads stuff and rebuilds.

**Better, cache‑friendly multi‑stage Dockerfile:**

```
FROM eclipse-temurin:21-jdk-alpine AS build
WORKDIR /app

# 1. Copy only dependency descriptors and warm cache
COPY pom.xml .
RUN mvn -q -B dependency:go-offline

# 2. Copy source code and build
COPY src ./src
RUN mvn -q -B package -DskipTests

# 3. Runtime image
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=build /app/target/app.jar app.jar
CMD ["java","-jar","app.jar"]

```

Now:

- Changing code in `src` does **not** invalidate the dependency cache step.
- Only the final build step re‑runs, making rebuilds much faster.

This “dependency layer before source layer” pattern is universal: Node, Python, Go, Java, etc.

---

## 4. Core Commands: List, Build, Tag, Push, Inspect

## 4.1 Listing Images

See what’s on your machine:

```
docker images
# or
docker image ls

```

You’ll see columns like:

- REPOSITORY (`myorg/payment-service`)
- TAG (`1.0.0`, `latest`)
- IMAGE ID
- CREATED
- SIZE

Good hygiene: periodically scan this list and prune unused images.

---

## 4.2 Building Images

Basic build:

```
docker build -t myorg/payment-service:1.0.0 .
```

Key points:

- `.` is the **build context**: everything under this directory is sent to the Docker daemon.
- Avoid sending huge directories (node_modules, target, .git) unless needed → use `.dockerignore`.

Disable cache when you really want fresh layers:

```
docker build --no-cache -t myorg/payment-service:1.0.0 .
```

You’ll rarely want `--no-cache` in normal dev; it’s mainly for debugging or when the cache gets confusing.

---

## 4.3 Tagging Images

Tags are just **labels** pointing to a specific image ID.

Common patterns:

```
# Changing tag locally
docker tag myorg/payment-service:1.0.0 myorg/payment-service:latest
docker tag myorg/payment-service:1.0.0 myorg/payment-service:1.0.0-prod

```

Mentally treat tags like Git branches pointing to commits:

- `latest` is not special; it’s just a tag.
- You decide what `latest` means (usually “most stable release” or “most recent build”).

---

## 4.4 Pushing & Pulling (Registries)

Once tagged correctly, push to a registry:

```
# Login once (if required)
docker login my-registry.example.com

# Tag for registry namespace
docker tag myorg/payment-service:1.0.0 \
  my-registry.example.com/myorg/payment-service:1.0.0

# Push
docker push my-registry.example.com/myorg/payment-service:1.0.0

```

On another machine (or your CI/CD):

```
docker pull my-registry.example.com/myorg/payment-service:1.0.0
docker run -d -p 8080:8080 my-registry.example.com/myorg/payment-service:1.0.0

```

You’ve now decoupled build (anywhere) from run (anywhere else).

---

## 4.5 Inspecting Images and Their Layers

To see the full metadata:

```
docker inspect myorg/payment-service:1.0.0
```

Useful sections:

- `Config.Env` → default environment variables baked into the image.
- `Config.Cmd` & `Config.Entrypoint` → what runs by default.
- `RootFS.Layers` → the list of layer digests.

To see Dockerfile history:

```
docker history myorg/payment-service:1.0.0
```

This shows:

- Each layer’s size.
- The instruction that produced it (when available).
- Which layers are huge and could be optimized.

You can often spot mistakes like:

- Giant `RUN` layer that includes package caches.
- Accidentally copying the entire repo (`COPY . .`) when only a few directories are needed.

---

## 5. Image Size: Why It Matters and How to Shrink It

Big images hurt you in several ways:

- Slower pushes and pulls (more network usage).
- Slower deployments in Kubernetes clusters.
- More disk usage on every node.
- Larger attack surface: more packages → more CVEs.

## 5.1 Choose the Right Base Image

For example:

- `ubuntu` or `debian` → full distribution, useful for tooling but heavy.
- `alpine` → very small, musl‑based, good for many apps but not all (e.g., some JVM or glibc‑dependent tools need tweaks).
- Language‑specific slim variants (`python:3.13-slim`, `openjdk:21-jre-slim`).

If your app is a Spring Boot service:

- A typical progression: `openjdk:21-jre` → `eclipse-temurin:21-jre-alpine` → maybe even distroless Java images later.

## 5.2 Clean Up After Package Installs

In single `RUN` instructions, chain commands so you can remove caches in the same layer:

```
RUN apk add --no-cache curl

```

For apt‑based images:

```
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

```

If you don’t clean up, the package index stays in the layer and bloats your image.

## 5.3 Multi-Stage Builds to Strip Tools

As shown earlier, multi‑stage builds keep compilers and build tools in a separate stage, and copy only artifacts to the final runtime image.

For example, Node:

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

Here:

- No Node, npm, or dev dependencies remain in the final image.
- Final image is just Nginx + static files.

---

## 6. Tagging Strategy: Knowing What’s in Prod

Bad pattern: everyone just uses `:latest` everywhere, and no one knows what commit is actually running in production.

Better approach:

- Always tag images with:
  - Semantic version: `1.0.0`.
  - Build identifier: `1.0.0-20260130.1`.
  - Git SHA: `app:git-abc1234` (even if only for internal use).

Example flow for a CI build:

1. Build the image from commit `abc1234`.
2. Tag:
   - `myorg/payment-service:1.0.0`
   - `myorg/payment-service:1.0.0-abc1234`
   - `myorg/payment-service:git-abc1234`

3. Push all tags.
4. Deploy a specific tag (`1.0.0-abc1234`) in staging.
5. Promote the **same** tag to production (retag or reuse directly) instead of rebuilding.

This makes it easy to answer “what exact code is running in prod?” and to roll back by deploying a previously known tag.

---

## 7. Cleanup and Disk Management

Over time, your Docker host accumulates:

- Old images.
- Dangling images (no tags pointing to them).
- Build cache for images you don’t use anymore.

Commands you’ll use to stay sane:

```
# Remove unused images (no containers use them)
docker image prune

# More aggressive: remove all images not referenced by any container
docker image prune -a

# Remove unused containers, networks, images (and optionally volumes if you add flags)
docker system prune
docker system prune -a

```

Use aggressive flags (`-a`) with care, especially on shared or production systems.

In a dev environment, a periodic `docker system prune -a` is fine as long as you know you’ll be re‑pulling images.

---

## 8. Security Basics for Images

Even at the image level, you can make security better or worse.

Key principles:

- **Minimal base**: fewer packages, fewer vulnerabilities.
- **No secrets baked into images**:
  - Never `COPY .env` or embed passwords as ENV variables in the Dockerfile.
- **Non‑root where possible**:
  - Create a dedicated user and `USER` switch to it in the Dockerfile.

Example:

```
FROM eclipse-temurin:21-jre-alpine

# Create user and group
RUN addgroup -S app && adduser -S app -G app

WORKDIR /app
COPY app.jar /app/app.jar

USER app
CMD ["java","-jar","app.jar"]

```

This won’t make you bulletproof, but it’s a baseline: an exploit in your app has fewer permissions inside the container.

---

## 9. Putting It Together: A Typical Spring Boot Image

Here’s a complete example that combines most of the ideas above.

```
# Build stage
FROM eclipse-temurin:21-jdk-alpine AS build
WORKDIR /app

# Dependencies
COPY pom.xml .
RUN mvn -q -B dependency:go-offline

# Source and build
COPY src ./src
RUN mvn -q -B package -DskipTests

# Runtime stage
FROM eclipse-temurin:21-jre-alpine

# Create non-root user
RUN addgroup -S app && adduser -S app -G app

WORKDIR /app
COPY --from=build /app/target/app.jar app.jar

USER app
EXPOSE 8080
CMD ["java","-jar","app.jar"]

```

This gives you:

- Cache‑friendly builds.
- Smaller runtime image (no Maven/JDK).
- Non‑root user.
- Explicit port.

From there:

```
docker build -t myorg/orders-api:1.0.0 .
docker tag myorg/orders-api:1.0.0 myorg/orders-api:latest
docker run -d --name orders-api -p 8080:8080 myorg/orders-api:1.0.0

```

You now have a well‑structured image lifecycle, instead of random copy‑paste Dockerfiles.

---
