---
title: "5. Dockerfile Mastery"
# tags:
#   - docker
#   - debugging
#   - troubleshooting
draft: false
---

A Dockerfile is not a shell script; it’s a **deterministic build recipe** that produces an immutable image. Once you understand how instructions translate into layers and how the cache behaves, you stop copy‑pasting random snippets and start designing Dockerfiles like you design code: intentionally, with tradeoffs in mind.

Below we walk through the mental model and every core instruction, then finish by refactoring a bad Dockerfile into a production‑quality one.

---

## 1. Mental model: Dockerfile as a deterministic build recipe

## Top‑down execution and build graph

When you run `docker build`:

1. Docker sends the **build context** (files from your directory, minus `.dockerignore`) to the daemon.
2. It parses the Dockerfile **top to bottom**.
3. Each instruction (FROM, RUN, COPY, etc.) produces a **new layer** (except a few pure‑metadata ones like some LABELs).
4. The final image is a stack of these layers.

You can think of it as:

- `FROM` → base layers.
- Every `RUN/COPY/ADD` → new layer on top.
- `CMD/ENTRYPOINT/ENV/EXPOSE/USER/WORKDIR/HEALTHCHECK` → configuration for how containers will run.

## Build cache and layer invalidation

Docker’s build cache works instruction by instruction:

- For each instruction, the daemon checks: “Have I already built this instruction before with the same inputs?”
- Inputs include:
  - The instruction text itself.
  - The files it touches from the build context (e.g., paths in COPY).
- If identical, Docker **reuses the old layer** instead of re‑executing.

If an instruction changes, or the files it touches change, that instruction and **all instructions after it** must be rebuilt.

That means:

- If you do `COPY . .` early, then any code change invalidates the cache for the rest of the file: expensive.
- If you split dependency installation and source copy, you can reuse the dependency layer even when code changes.

Example: better ordering for a Maven build:

```
# 1. Copy pom.xml only → stable if deps don’t change
COPY pom.xml .
RUN mvn -q -B dependency:go-offline

# 2. Copy source → changes more often
COPY src ./src
RUN mvn -q -B package -DskipTests

```

This is the core “art of small layers”: structure your Dockerfile so that **rarely changing steps go first**, frequently changing steps go later.

---

## 2. Core instructions, with intent

Let’s go instruction by instruction: what it really means and when to use it.

## 2.1 FROM

Sets the **base image** (starting point) for your build.

Examples:

```
FROM eclipse-temurin:21-jre-alpine    # Java runtime
FROM node:22-alpine                   # Node.js
FROM python:3.13-slim                 # Python
```

When to use:

- Always at the top of each stage.
- For multi‑stage builds, each new stage starts with `FROM`.

Design considerations:

- Choose minimal but appropriate base (slim/alpine/distroless vs full OS).
- Pin versions (`:21-jre-alpine`, not `:latest`) for reproducibility.
- Prefer official or trusted vendor images.

---

## 2.2 RUN

Executes a command **at build time** and commits the result as a new layer.

Examples:

```
RUN apk add --no-cache curl

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*
```

When to use:

- Install packages and dependencies.
- Build/compile your application.
- Perform one‑time setup that affects filesystem contents.

Design tips:

- Combine related steps into a single `RUN` when they are tightly coupled, especially for package installation + cleanup.
- Avoid leaving caches behind in earlier layers (do update/install/cleanup in the **same** RUN).
- Don’t install heavy dev tools in the **final** runtime stage; keep them in build stages.

---

## 2.3 COPY and ADD

Copy files/directories into the image.

- COPY:

```
COPY app.jar /app/app.jar
COPY src/ /app/src/
```

- ADD (with extra capabilities):

```
ADD data.tar.gz /data/        # auto‑extracts
ADD https://example.com/file /tmp/file   # fetches from URL
```

When to use:

- **COPY** for almost everything: it’s explicit and predictable.
- **ADD** only when you *specifically need* its special behaviors (tar auto‑extract or URL fetch).

We go deeper on COPY vs ADD in section 3.

---

## 2.4 WORKDIR

Sets the working directory for subsequent instructions.

```
WORKDIR /app
COPY app.jar .
RUN ls -l
CMD ["java","-jar","app.jar"]
```

When to use:

- To avoid full absolute paths everywhere.
- To make your Dockerfile cleaner and commands shorter.

Notes:

- If the directory doesn’t exist, Docker creates it.
- You can set WORKDIR multiple times; each new one becomes the current working directory for the following instructions.

---

## 2.5 ENV

Sets environment variables that will be available **at build time and runtime**.

```
ENV SPRING_PROFILES_ACTIVE=prod
ENV JAVA_OPTS="-Xms256m -Xmx512m"
```

When to use:

- To bake **default** runtime configuration into the image.
- To set environment variables needed during build (though `ARG` is often more appropriate for build‑only values).

Containers can override ENV at runtime:

bash

`docker run -e SPRING_PROFILES_ACTIVE=stage myorg/app:1.0.0`

---

## 2.6 ARG

Defines build‑time variables available only **during build**.

```
ARG BUILD_VERSION=dev
ARG GIT_SHA

RUN echo "Building version $BUILD_VERSION from $GIT_SHA"
LABEL version="$BUILD_VERSION" git_sha="$GIT_SHA"
```

When to use:

- To pass build metadata (versions, git SHA, build date).
- To toggle build behavior (e.g., `ARG ENABLE_DEBUG_TOOLS=true` used only in build stage).

They do **not** exist in the resulting container environment unless you explicitly copy them into ENV or labels.

Build with:

```
docker build \
  --build-arg BUILD_VERSION=1.2.3 \
  --build-arg GIT_SHA=abc1234 \
  -t myorg/app:1.2.3 .
```

We explore ENV vs ARG patterns in section 4.

---

## 2.7 EXPOSE

Documents which ports the container listens on.

```
EXPOSE 8080
EXPOSE 8080 8443
```

When to use:

- As a form of documentation and metadata for tools.
- So `docker run -P` knows which ports to auto‑publish.

Important:

- EXPOSE does **not** actually open ports on the host; you still need `-p` in `docker run`.

---

## 2.8 USER

Sets which user the following instructions (and the default container process) will run as.

```
RUN addgroup -S app && adduser -S app -G app
USER app
```

When to use:

- To drop root privileges and run your app as a non‑root user.
- As part of basic container hardening.

Once you set USER, subsequent RUN instructions also run under that user unless you switch back.

We discuss security patterns more in section 6.

---

## 2.9 CMD

Defines the **default command** (and/or arguments) to run when a container starts.

Exec form (recommended):

`CMD ["java","-jar","app.jar"]`

Shell form:

`CMD java -jar app.jar`

When to use:

- To set the default command or default arguments for your container.
- Expecting that users (or orchestrators) may override it at `docker run` time.

CMD is often combined with ENTRYPOINT (see section 5).

---

## 2.10 ENTRYPOINT

Defines the **fixed executable** that will always be run for this container.

`ENTRYPOINT ["java","-jar","app.jar"]`

When to use:

- When your container is fundamentally “this binary”.
- To make sure the main process is always your app, and CLI args are treated as arguments to it.

Together with CMD, it becomes:

```
ENTRYPOINT ["java","-jar","app.jar"]
CMD ["--spring.profiles.active=prod"]
```

At runtime, Docker effectively runs:

`java -jar app.jar --spring.profiles.active=prod`

We detail CMD vs ENTRYPOINT in section 5.

---

## 2.11 HEALTHCHECK

Defines a command Docker runs periodically to verify container health.

```
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD curl -f http://localhost:8080/actuator/health || exit 1
```

When to use:

- When you want a signal beyond “process is running.”
- To help orchestrators avoid routing traffic to unhealthy containers.

Good healthchecks are **cheap** and **local**; they shouldn’t depend heavily on external systems unless that’s part of your SLA.

---

## 3. COPY vs ADD – the subtle traps

You almost always want `COPY`. The reason is simple: `ADD` does more than just copy, and that extra behavior can surprise you.

## What ADD does in addition

- If the source is a tar archive and the destination is a directory, ADD **auto‑extracts** it.
- If the source is a URL, ADD fetches it over HTTP/HTTPS.

Example:

`ADD data.tar.gz /data/   # /data contains extracted contents`

This may look convenient, but:

- It hides logic: you can’t tell from the Dockerfile alone that extraction is happening.
- You have less control over where and how it extracts.
- Using URLs in ADD can complicate caching and reproducibility (network changes vs build cache).

## Why COPY is preferred

- COPY is dumb and predictable: “copy exactly these files to exactly there.”
- It interacts clearly with `.dockerignore`.
- You can handle downloads and extractions explicitly in a RUN, where you also control cleanup.

Example with RUN instead of ADD URL:

```
RUN curl -L https://example.com/file.tar.gz -o /tmp/file.tar.gz && \
    tar xzf /tmp/file.tar.gz -C /data && \
    rm /tmp/file.tar.gz
```

You control:

- Where the file goes.
- How it’s extracted.
- That temporary artifact is cleaned up in the same layer.

**Rule of thumb:** default to COPY; reach for ADD only when you truly want its special behaviors and understand the tradeoffs.

---

## 4. ENV and ARG patterns

## Build‑time vs runtime configuration

- **ARG**: build‑time only, not available in running containers unless explicitly propagated.
- **ENV**: runtime environment variables baked into the image (and also available during build after they’re set).

Pattern: pass build metadata via ARG, then store it via LABEL or ENV if needed at runtime.

Example:

```
ARG BUILD_VERSION=dev
ARG GIT_SHA=unknown

LABEL version="$BUILD_VERSION" git_sha="$GIT_SHA"

ENV APP_VERSION=$BUILD_VERSION
```

Build:

```
docker build \
  --build-arg BUILD_VERSION=1.2.3 \
  --build-arg GIT_SHA=abc1234 \
  -t myorg/app:1.2.3 .
```

Now:

- The image has labels with version and SHA.
- The container has `APP_VERSION` at runtime.

## Runtime profiles with ENV + override

For a Spring Boot app:

text

`ENV SPRING_PROFILES_ACTIVE=prod`

You can override per environment:

```
# Staging
docker run -e SPRING_PROFILES_ACTIVE=stage myorg/app:1.2.3

# Dev
docker run -e SPRING_PROFILES_ACTIVE=dev myorg/app:1.2.3
```

Design principle:

- Don’t rebuild images just to change environment‑specific settings.
- Use ENV for defaults; override via runtime env variables in Compose/Kubernetes.

---

## 5. CMD vs ENTRYPOINT patterns

## Fixed executable vs overridable parameters

Think of:

- **ENTRYPOINT** = binary to always run.
- **CMD** = default arguments, overridable at runtime.

Canonical pattern:

```
ENTRYPOINT ["java","-jar","app.jar"]
CMD ["--spring.profiles.active=prod"]
```

Then:

```
# uses default profile=prod
docker run myorg/app:1.0.0

# override profile with CLI arg
docker run myorg/app:1.0.0 --spring.profiles.active=stage

```

Docker effectively does:
`java -jar app.jar --spring.profiles.active=stage`

## Common mistakes

1. Putting everything in CMD and then overriding the whole thing at runtime:

   `CMD ["java","-jar","app.jar","--spring.profiles.active=prod"]`

   If someone runs `docker run myorg/app:1.0.0 my-custom-command`, your app doesn’t run at all.

2. Using shell form and breaking signal handling:

   `CMD java -jar app.jar`

   PID 1 is `/bin/sh -c`, not your app; SIGTERM/SIGINT may not propagate cleanly.

**Better:** use exec form for both ENTRYPOINT and CMD.

---

## 6. Security‑aware Dockerfile writing

The Dockerfile is your first line of defense. A few simple patterns dramatically reduce risk.

## 6.1 Non‑root user

Create a dedicated user and drop root:

```
FROM eclipse-temurin:21-jre-alpine

RUN addgroup -S app && adduser -S app -G app

WORKDIR /app
COPY app.jar /app/app.jar

USER app

CMD ["java","-jar","app.jar"]
```

Benefits:

- Even if your app is compromised, the attacker has fewer privileges in the container.
- Limits damage from misconfigurations.

Remember to ensure directories your app writes to are writable by `app`.

## 6.2 No secrets in images

Never:

- `COPY .env /app/.env`
- `ENV DB_PASSWORD=supersecret` in a public or widely shared image.

Better:

- Inject secrets at runtime via environment variables, secret managers, or orchestrator mechanisms (Kubernetes Secrets, etc.).
- Restrict secrets to runtime configuration, not immutable image configuration.

## 6.3 Minimal surface area

- Use minimal base images (alpine, slim, distroless).
- Avoid unnecessary tools (curl, ping, etc.) in the **final** runtime image; keep them only in build or debug images.

The smaller and simpler your image, the fewer attack vectors and CVEs you’ll carry.

---

## 7. Example: refactoring a bad Dockerfile

## 7.1 Naïve Dockerfile

```
FROM openjdk:21

WORKDIR /app
COPY . .
RUN mvn package
CMD ["java","-jar","target/app.jar"]
```

Issues:

- Heavy base image (full OS + JDK).
- Copies entire context (including `.git`, `target`, docs, etc.).
- Poor cache usage: any code change invalidates Maven dependency downloads.
- Runs as root.
- No explicit healthcheck or environment defaults.
- Build tools (Maven, JDK) are in the same image used in production.

## 7.2 Refactored, production‑grade Dockerfile

```
# Stage 1: build
FROM eclipse-temurin:21-jdk-alpine AS build
WORKDIR /app

# Install dependencies based on pom.xml (good cache usage)
COPY pom.xml .
RUN mvn -q -B dependency:go-offline

# Copy source and build
COPY src ./src
RUN mvn -q -B package -DskipTests

# Stage 2: runtime
FROM eclipse-temurin:21-jre-alpine

# Create non-root user
RUN addgroup -S app && adduser -S app -G app

WORKDIR /app
COPY --from=build /app/target/app.jar app.jar

# Runtime defaults
ENV SPRING_PROFILES_ACTIVE=prod

USER app
EXPOSE 8080

# Healthcheck (simple example)
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD curl -f http://localhost:8080/actuator/health || exit 1

# Binary + default args pattern
ENTRYPOINT ["java","-jar","app.jar"]
CMD ["--spring.profiles.active=prod"]
```

What improved:

- **Multi‑stage build**: JDK + Maven only in build stage; final image has JRE only.
- Smaller, more secure runtime image.
- Better **cache behavior**: dependencies cached separately from source.
- Non‑root user.
- EXPOSE and HEALTHCHECK provide standard metadata and health signal.
- ENTRYPOINT/CMD split allows overriding profile without rewriting command.

This is “Dockerfile mastery”: the same basic goal (run a Spring Boot JAR) implemented in a way that respects performance, security, maintainability, and observability.
