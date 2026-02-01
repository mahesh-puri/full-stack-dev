---
title: "6. Multi‑Stage Docker Builds"
# tags:
#   - docker
#   - debugging
#   - troubleshooting
draft: false
---

Multi‑stage builds exist to solve a very concrete problem: images that are huge, slow to ship, and full of compilers and dev tools that have no business being in production. You keep all the heavy build tooling in one stage, and ship only the small, clean runtime stage to prod.

---

## 1. The problem: fat images with build tools inside

In a naïve Dockerfile, you often see something like:

```
FROM node:22

WORKDIR /app
COPY . .
RUN npm install
RUN npm run build
CMD ["npm","start"]
```

or for Java:

```
FROM maven:3.9-eclipse-temurin-21

WORKDIR /app
COPY . .
RUN mvn -q -B package
CMD ["java","-jar","target/app.jar"]

```

What’s wrong here?

- **JDK, Maven, Node toolchain** are all present in the final image.
- You’re shipping:
  - Package managers (npm, apt, Maven).
  - Compilers and build tools.
  - Dev dependencies (e.g., node_modules with test tooling).
- Impact:
  - **Pull time**: every node in your cluster pulls a big image.
  - **Disk usage**: each node stores these large layers.
  - **Security**: more binaries and libraries → more potential CVEs → more noise in vulnerability scans.

The app only needs the **built artifact** (JAR, binary, static assets), not the entire toolbox used to produce it.

---

## 2. Concept: separate build stage from runtime stage

Multi‑stage builds let you define **multiple FROMs** in a single Dockerfile. Each FROM starts a new “stage” with its own filesystem. You can then selectively copy build outputs from earlier stages into a minimal final stage.

Core mechanics:

```
FROM some-builder-image AS build
# ... build commands ...

FROM small-runtime-image
# Copy artifacts from build stage
COPY --from=build /path/in/build-stage /path/in/runtime
# ... runtime config ...
```

Key elements:

- `AS build` names the stage `build`. You can choose any name (e.g., `builder`, `compile`).
- `COPY --from=build` pulls files **only** from that stage’s filesystem into the current stage.
- Earlier stages don’t exist in the final image unless you copy data explicitly.

Why it’s “cheap”:

- Docker still layers everything efficiently.
- Stages share cached layers like normal builds.
- Only the **last stage** becomes the final image that’s pushed/pulled in normal workflows.

So you get:

- Full power of a heavy build environment.
- A clean, minimal runtime image used in production.

---

## 3. Language‑specific examples

## 3.1 Node: build static assets, serve with Nginx

Goal: use Node only to build the frontend, then serve static files with Nginx.

```
# Stage 1: build
FROM node:22-alpine AS build
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Stage 2: runtime
FROM nginx:1.25-alpine

# Copy built assets from build stage
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx","-g","daemon off;"]
```

What you achieve:

- Node, npm, devDependencies stay in the `build` stage.
- Final image is just Nginx + static files.
- Image is smaller, faster to start, simpler to scan.

---

## 3.2 Java: JDK + Maven → JRE‑only final

You saw a version of this earlier; here’s a focused multi‑stage example.

```
# Stage 1: build
FROM eclipse-temurin:21-jdk-alpine AS build
WORKDIR /app

# Dependencies
COPY pom.xml .
RUN mvn -q -B dependency:go-offline

# Source and build
COPY src ./src
RUN mvn -q -B package -DskipTests

# Stage 2: runtime
FROM eclipse-temurin:21-jre-alpine

WORKDIR /app
COPY --from=build /app/target/app.jar app.jar

EXPOSE 8080
CMD ["java","-jar","app.jar"]

```

Properties:

- JDK + Maven only in `build` stage.
- Final runtime image has just a JRE and your JAR.
- Much smaller than using `maven:...` directly as the only base.

You can then further harden the runtime stage (non‑root user, healthcheck, ENV, etc.).

---

## 3.3 Go: build in `golang`, run in `scratch` or `distroless`

Go produces static binaries easily, which are perfect for tiny runtime images.

```
# Stage 1: build
FROM golang:1.23-alpine AS build
WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o app

# Stage 2: runtime (scratch)
FROM scratch

# Copy binary and (optionally) CA certs if needed
COPY --from=build /app/app /app/app

# Typically set a working dir and maybe certs or config
WORKDIR /app

ENTRYPOINT ["/app/app"]

```

Advantages:

- Final image includes only your compiled binary (and maybe CA certs).
- No shell, no package manager, no extra libs.
- Extremely small, fast, and minimal attack surface.

Alternatively, you can use a distroless base if you need some minimal runtime libs:

```
FROM gcr.io/distroless/base
COPY --from=build /app/app /app/app
WORKDIR /app
ENTRYPOINT ["/app/app"]
```

## 4. Optimizing build cache in multi‑stage builds

Multi‑stage doesn’t magically fix bad cache usage; you still need to order instructions smartly.

## 4.1 General pattern: dependencies first, then source

In build stages for dependency‑heavy languages (Java, Node), do:

1. Copy **dependency manifest** (pom.xml, package.json).
2. Install dependencies.
3. Copy the rest of the source.
4. Build.

Java example:

```
FROM eclipse-temurin:21-jdk-alpine AS build
WORKDIR /app

# 1. Dependencies layer
COPY pom.xml .
RUN mvn -q -B dependency:go-offline

# 2. Source layer
COPY src ./src
RUN mvn -q -B package -DskipTests
```

Node example:

```
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build
```

Why this helps:

- As long as your dependency file doesn’t change, the dependency install layer is reused.
- Small code changes only invalidate the later layers, keeping builds much faster.

## 4.2 Build‑only vs runtime files

Multi‑stage gives you a natural separation:

- **Build stage**: everything needed to compile/build (full source, tests, docs, etc.).
- **Runtime stage**: only what’s needed to run (binaries, JARs, static assets, configs).

You consciously choose what to copy with `COPY --from`, so:

- You don’t accidentally ship test files or docs.
- You don’t ship package lockfiles or build caches.

---

## 5. Security and compliance benefits

Multi‑stage builds are not just about size and speed; they directly improve security posture.

## 5.1 Smaller attack surface

- No compilers or interpreters in the runtime image.
- No build tools like Maven, npm, pip, etc.
- Fewer system libraries.

If an attacker breaks into the container, there’s **less tooling** to leverage for lateral movement or exploitation.

## 5.2 Cleaner vulnerability scans

Security tools scan all packages and libraries inside an image. If you ship a giant build image:

- You see CVEs for compilers, build tools, and things that never run in production.
- Noise makes it harder to focus on real runtime risks.

With a minimal runtime image:

- Scan results mostly reflect the libraries your app actually uses in production.
- Remediation and patching focus becomes much clearer.

## 5.3 Easier upgrades

When you separate build and runtime:

- You can update the build image (new compiler, new Maven) **without** changing the runtime image base.
- Or update runtime base (for CVE patches) without touching build toolchain right away.

This decoupling can be helpful in regulated environments where change control for build and runtime flows differ.

---

## 6. Migration story: from single‑stage to multi‑stage

Let’s take a concrete, legacy single‑stage Dockerfile and evolve it step by step.

## 6.1 Legacy single‑stage Java Dockerfile

```
FROM maven:3.9-eclipse-temurin-21

WORKDIR /app
COPY . .
RUN mvn -q -B package -DskipTests
EXPOSE 8080
CMD ["java","-jar","target/app.jar"]
```

Problems:

- Heavy image: includes Maven and full JDK in production.
- Copies entire context (including target, .git, etc.).
- Poor cache usage (COPY . . early).
- No separation of build vs runtime.

## 6.2 Step 1: introduce build and runtime stages

```
# Stage 1: build
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY . .
RUN mvn -q -B package -DskipTests

# Stage 2: runtime
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=build /app/target/app.jar app.jar
EXPOSE 8080
CMD ["java","-jar","app.jar"]
```

Now:

- Final image is based on JRE only.
- Maven & JDK live only in the build stage.

## 6.3 Step 2: improve cache usage in the build stage

Refine the build stage:

```
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app

# Dependencies first
COPY pom.xml .
RUN mvn -q -B dependency:go-offline

# Then source
COPY src ./src
RUN mvn -q -B package -DskipTests
```

This avoids re‑downloading dependencies on every code change.

## 6.4 Step 3: slim down the builder base (optional)

If you want a lighter builder:

```
FROM eclipse-temurin:21-jdk-alpine AS build
# install Maven manually OR use a Maven wrapper
WORKDIR /app

COPY mvnw pom.xml ./
COPY .mvn .mvn
RUN ./mvnw -q -B dependency:go-offline

COPY src ./src
RUN ./mvnw -q -B package -DskipTests
```

Build still happens in `build` stage, but with a smaller JDK + Maven wrapper instead of the `maven:` base.

## 6.5 Step 4: harden the runtime stage

Now secure the runtime stage as well:

```
FROM eclipse-temurin:21-jre-alpine

# Create non-root user
RUN addgroup -S app && adduser -S app -G app

WORKDIR /app
COPY --from=build /app/target/app.jar app.jar

ENV SPRING_PROFILES_ACTIVE=prod

USER app
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD curl -f http://localhost:8080/actuator/health || exit 1

ENTRYPOINT ["java","-jar","app.jar"]
CMD ["--spring.profiles.active=prod"]

```

Final result:

- Multi‑stage build.
- Optimized caching.
- Minimal runtime image.
- Non‑root user.
- Healthcheck and ENV defaults.

The **behavior** (run a Spring Boot JAR) is the same, but the image is faster, smaller, and safer.
