---
title: "7. Docker Security Essentials"
# tags:
#   - docker
#   - debugging
#   - troubleshooting
draft: false
---

Containers make deployment easier, but they don’t magically make things safe. A container is just a process on a shared kernel with some isolation. Security comes from how you **build** images and how you **run** containers, not from Docker’s existence alone.

---

## 1. Threat model for containers

## Shared kernel: what it implies

- Containers are **not** VMs: there is no separate kernel per container.
- All containers and the host share the **same Linux kernel**, using:
  - Namespaces for isolation (PID, network, mount, etc.).
  - cgroups for resource limits.

Implications:

- A kernel bug or misconfiguration can potentially be exploited from inside a container.
- If a container breaks out of its namespaces, it may affect other containers or the host.

## “It’s in a container” is not a magic boundary

Common misconceptions:

- “If it’s in a container, it’s safe even if running as root.”
- “We can just mount anything from the host; Docker will protect us.”

Reality:

- Root inside a container can often do dangerous things if the container is misconfigured (e.g., privileged mode, host mounts).
- Volumes and bind mounts can expose sensitive host paths directly.
- Docker is a **convenience**, not a security sandbox; treat containers as apps running on the host, with extra isolation but not perfect.

Mindset:  
Assume an attacker can get **code execution inside the container**. Your job is to limit what they can do **from there**.

---

## 2. User and permissions

## Non‑root users inside containers

By default, many base images run as `root`. If your app is compromised, the attacker gets root inside the container.

Better pattern:

1. Create a dedicated user in the Dockerfile.
2. Switch to it with `USER`.

Example:

```
FROM eclipse-temurin:21-jre-alpine

# Create group and user
RUN addgroup -S app && adduser -S app -G app

WORKDIR /app
COPY app.jar /app/app.jar

USER app

CMD ["java","-jar","app.jar"]

```

Benefits:

- The app runs with limited privileges.
- Even if an exploit lands, it can’t directly perform many root‑level operations.

## File ownership with volumes and bind mounts

Volumes and bind mounts introduce another dimension: **who owns the files**.

Typical issues:

- Host directory owned by a user with UID/GID that doesn’t match the container’s user.
- Container process gets “permission denied” when trying to write.

Patterns:

- Align UIDs: run container with a user whose UID/GID matches host directory owner, or adjust host directory permissions.
- Let the container initialize its own volume:
  - First run as root to set ownership, then drop to non‑root, or
  - Use an init container step (in orchestration) to prepare permissions.

Example volume pattern:

```
docker run -d --name db \
  -e POSTGRES_PASSWORD=secret \
  -v pgdata:/var/lib/postgresql/data \
  postgres:15-alpine
```

Here, Postgres image is usually prepared to manage its own data directory permissions. For your custom images, make sure the `USER` has write permission to any mounted paths.

---

## 3. Capabilities and seccomp (conceptual)

## Linux capabilities: fine‑grained root

In Linux, “root” privileges are split into **capabilities** (e.g., `NET_ADMIN`, `SYS_ADMIN`). Docker containers get a **reduced set** of capabilities by default, but often more than they strictly need.

Instead of all‑or‑nothing root, you can drop capabilities and only add back what’s required.

Example pattern:

```
docker run -d --name web \
  --cap-drop=ALL \
  --cap-add=NET_BIND_SERVICE \
  -p 80:80 \
  nginx:1.25-alpine

```

- `--cap-drop=ALL` removes all capabilities.
- `--cap-add=NET_BIND_SERVICE` permits binding to low ports (<1024) without full root.

This is a powerful “least privilege” control.

## Seccomp (high level)

Seccomp (secure computing mode) lets you filter which **syscalls** a process can make. Docker ships with a default seccomp profile that blocks some risky syscalls.

You rarely write seccomp profiles by hand at first, but you should **know** that:

- Docker can block dangerous syscalls by default.
- You can opt into different profiles or, in rare cases, relax them if your app needs unusual syscalls.

Basic principle:  
Don’t disable the default seccomp profile unless you really know what you’re doing.

---

## 4. Image hygiene

Security also comes from **what’s inside your image**.

## Keep base images updated

- Base images inherit vulnerabilities from the underlying OS and libraries.
- You should periodically:
  - Rebuild images from updated base tags.
  - Track upstream base image changelogs and security advisories.

Using versioned tags like `eclipse-temurin:21-jre-alpine` is good, but you still need to **pull updated variants** as they are released and rebuild your images.

## Install only what you need, clean up after

Every extra package:

- Increases attack surface.
- Increases the number of things scanners will flag.

Patterns:

- Avoid “kitchen sink” installs (`apt-get install -y nano vim curl wget net-tools ...`) in runtime images.
- Use minimal installs and remove package caches.

Example for Debian/Ubuntu based images:

```
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*
```

For Alpine:

`RUN apk add --no-cache curl`

Combine install and cleanup in one `RUN` so caches don’t remain in previous layers.

---

## 5. Runtime hardening flags

Beyond the Dockerfile, **run‑time options** give you strong guardrails.

## Read‑only root filesystem

If your app doesn’t need to write to the root filesystem, you can mount it read‑only and use volumes for writable paths.

```
docker run -d --name api \
  --read-only \
  -v app-tmp:/tmp \
  myorg/api:1.0.0

```

Effects:

- The container’s root filesystem is read‑only.
- App can still write to `/tmp` (a dedicated volume).
- Attacks that try to drop binaries or modify configuration files on root FS are harder.

## No new privileges

`--security-opt no-new-privileges` prevents processes from gaining more privileges (e.g., via setuid binaries).

```
docker run -d --name api \
  --security-opt no-new-privileges \
  myorg/api:1.0.0

```

This enforces a strong “no escalation” rule even if some binaries have setuid bits.

## Tightening Nginx as an example

Putting it together:

```
docker run -d --name web \
  -p 80:80 \
  --read-only \
  -v web-logs:/var/log/nginx \
  --cap-drop=ALL \
  --cap-add=NET_BIND_SERVICE \
  --security-opt no-new-privileges \
  nginx:1.25-alpine
```

We’ve:

- Dropped all capabilities except what’s needed to bind port 80.
- Made filesystem read‑only except for logs.
- Prevented privilege escalation.

This is a realistic baseline for a simple web server.

---

## 6. Secrets handling basics

## Why not bake secrets into images

Bad patterns:

- `ENV DB_PASSWORD=supersecret` in the Dockerfile.
- Copying `.env` or config with credentials into the image.
- Checking these files into source control.

Problems:

- Secret is now in every environment where the image lands.
- Anyone with access to the image registry can potentially read it.
- Rotating the secret requires rebuilding images.

## Better approaches (high‑level)

The principle: **inject secrets at runtime**, not build time.

Common patterns:

- Runtime environment variables:
  - `docker run -e DB_PASSWORD=...`
  - But still sensitive; use restricted environment (orchestrator secrets) rather than plain text in scripts.
- Orchestrator secret mechanisms:
  - Docker Swarm secrets.
  - Kubernetes Secrets (mounted as files or env vars).
  - Cloud provider secret managers (AWS Secrets Manager, GCP Secret Manager, Vault, etc.).

In all cases:

- The Dockerfile should **never** hardcode secrets.
- Images should be reusable across environments; secrets are part of **deployment configuration**, not the artifact itself.

---

## Putting it all together: baseline security checklist

When you design Docker images and containers, treat this as your default checklist:

- Threat model:
  - Remember containers share the host kernel; don’t assume perfect containment.
- Users & permissions:
  - Create a non‑root user in Dockerfile, `USER` to it.
  - Ensure volumes and bind mounts respect that user’s permissions.
- Capabilities & seccomp:
  - Drop capabilities by default, add only what you need.
  - Don’t casually disable Docker’s default seccomp profile.
- Image hygiene:
  - Use minimal, versioned base images.
  - Install only necessary packages; clean caches.
  - Rebuild on base image updates.
- Runtime hardening:
  - Use `--read-only` and dedicated writable volumes where possible.
  - Apply `--security-opt no-new-privileges`.
  - Avoid unnecessary privileged containers and host mounts.
- Secrets:
  - Never bake secrets into the image.
  - Use runtime injection and secret management systems.

Once this baseline becomes automatic, you’ll naturally design Docker setups that are much closer to what SREs and security teams expect in real production environments.
