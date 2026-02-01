---
title: "2. Docker Containers"
# tags:
#   - docker
#   - debugging
#   - troubleshooting
draft: false
---

Most people start by thinking of containers as “lightweight VMs.” That mental model works for a few days, then hurts you for years. A container is **just a process** (or a few) with isolation and a custom filesystem view, built from an image. Once you see it that way, a lot of “Docker magic” becomes predictable.

This article walks through container internals, lifecycle, core commands, resource limits, and a practical troubleshooting mindset.

---

## 1. Mental Model: What a Container Really Is

Under the hood, a container is:

- A **Linux process** (PID on the host)
- Running with:
  - Its own filesystem view (from an image + writable layer)
  - Its own network namespace (own IP stack)
  - Its own PID namespace (process tree inside container)
  - Resource limits enforced by **cgroups**

Key idea:  
If the container is “running,” that means there is a **process** running on the host. If the process exits, the container stops. There’s no “guest OS” like a VM.

You can prove this to yourself:

```
# Run a simple container
docker run --name demo -d alpine:3.19 sleep 1000

# On the host, find the PID
docker top demo
# or
ps aux | grep sleep

```

You’ll see the `sleep` process; that’s your container.

---

## 2. Container Lifecycle: From Image to Running Process

For a single container, the lifecycle looks like this:

1. **Create**  
   Docker allocates metadata, filesystem, network namespace, etc.  
   (You can do this explicitly with `docker create`, but `docker run` does it implicitly.)
2. **Start**  
   Docker launches the container’s main process (the ENTRYPOINT+CMD from the image).
3. **Running**  
   The process is alive. Docker tracks its stdout/stderr, resources, and exit code.
4. **Stopped**  
   The process exits. The container object + writable layer are still present on disk.
5. **Removed**  
   Docker deletes the container’s metadata and filesystem layer.

The main command you use:

```
docker run
```

is a convenience wrapper for:

1. `docker create`
2. `docker start`

Understanding that helps when you debug:

- A container that “exits immediately” is just a process that finishes quickly.
- To keep it running, you need a long‑running process (server, tail, sleep, etc.).

---

## 3. Creating and Running Containers: Core Patterns

## 3.1 One‑off interactive containers

Use these whenever you want a temporary shell:

bash

`docker run --rm -it alpine:3.19 sh`

Flags breakdown:

- `--rm` → delete container when it stops.
- `-it` → interactive TTY (so you get a shell).

Mental model: this is your “disposable debugger” or “scratch VM,” but it’s still just a process.

---

## 3.2 Long‑running services

Typical pattern for APIs, web servers, etc.:

bash

`docker run -d --name web -p 8080:80 nginx:1.25-alpine`

- `-d` → detached mode (run in background).
- `--name web` → stable name for logs, exec, etc.
- `-p 8080:80` → map host port 8080 to container port 80.

This container:

- Is backed by a main process (`nginx` master process).
- Will stop if that process crashes or exits.

If it keeps dying, don’t think “VM crashed”; think “process crashed” and check logs.

---

## 3.3 Environment variables and configuration

Pass configuration at runtime:

```
docker run -d --name orders-api \
  -p 8080:8080 \
  -e SPRING_PROFILES_ACTIVE=prod \
  -e DB_HOST=db \
  myorg/orders-api:1.0.0

```

This becomes:

- Environment variables visible to the process inside the container.
- Exactly like `export` on a normal Linux host.

This is usually the right place for non‑secret configuration (URLs, flags, modes). Secrets should be handled more carefully in real systems (secret managers, etc.).

---

## 4. Managing Containers Day‑to‑Day

Think of these as your daily driver commands.

## 4.1 Listing containers

```
docker ps        # running only
docker ps -a     # all containers (running + stopped)

```

Useful columns:

- NAMES → what to use with `logs`, `exec`, `inspect`.
- STATUS → “Up 5 minutes”, “Exited (0) 2 seconds ago”.

## 4.2 Stopping, starting, removing

```
docker stop web     # send SIGTERM, wait, then SIGKILL after timeout
docker start web    # restart a stopped container
docker rm web       # remove container (must be stopped)
```

If you want to kill and recreate:

```
docker rm -f web    # force remove (stop + rm)
```

Typical dev loop:

1. `docker rm -f web`
2. `docker build -t myorg/web:dev .`
3. `docker run ...`

---

## 4.3 Logging: stdout and stderr as your primary log sink

Docker automatically captures the main process’s stdout and stderr:

```
docker logs web          # historical logs
docker logs -f web       # follow logs (tail -f)
```

Good practice:

- Your app should log to stdout/stderr (not to local files inside the container).
- That way, orchestrators (Compose, Swarm, Kubernetes, log collectors) can pick up logs easily.

For a Spring Boot service:

- Configure logs to go to console → Docker (and later Kubernetes) can aggregate them.

---

## 4.4 Exec into containers

When something is weird, “enter” the container:

```
docker exec -it web sh
# or for Debian/Ubuntu based images:
docker exec -it web bash

```

Use this to:

- Inspect filesystem.
- Run curl, ping, or app‑specific debug commands.
- Quickly check config files and environment vars (`env`).

It’s equivalent to SSHing into a VM, but you’re really just attaching to a process’s namespace.

---

## 5. Resources: Making Sure Containers Don’t Eat the Host

Because containers share the host kernel, they can starve each other if you don’t set limits.

## 5.1 CPU limits

bash

`docker run -d --name cpu-demo --cpus="1.0" myorg/task:1.0.0`

This roughly constrains the container to 1 CPU core worth of time. Without limits, one container can saturate the host CPU, especially on dev machines.

## 5.2 Memory limits

bash

`docker run -d --name mem-demo --memory="512m" myorg/task:1.0.0`

- If the process allocates more than that, the kernel may kill it with OOM (Out Of Memory).
- You’ll see exit code 137 (killed) or similar in Docker.

Combine:

```
docker run -d --name api \
  -p 8080:8080 \
  --cpus="1" \
  --memory="512m" \
  myorg/orders-api:1.0.0

```

This is closer to how you’d run things in production.

## 5.3 Checking usage: `docker stats`

`docker stats`

Gives live CPU, memory, network, I/O usage per container.  
If one service is misbehaving, this is your quick “top” for containers.

---

## 6. Restart Policies: Making Containers Survive Crashes

In pure Docker (without an orchestrator), restart policies give minimal self‑healing:

```
docker run -d --name api \
  --restart=on-failure \
  -p 8080:8080 \
  myorg/orders-api:1.0.0

```

Common policies:

- `no` (default): never restart automatically.
- `on-failure`: restart only if exit code ≠ 0.
- `always`: always restart if stopped.
- `unless-stopped`: restart unless you manually stopped it.

Use cases:

- `on-failure` for tasks that might crash but shouldn’t be resurrected if cleanly completed.
- `always` / `unless-stopped` for long‑running services on standalone hosts.

Later, in Kubernetes, this concept maps to Pod restart behavior controlled by the controller (Deployment, etc.).

---

## 7. Containers vs Images vs Volumes: How Changes Persist

A common confusion: “I edited a file inside the container, but when I recreate it, my changes are gone.”

Key rules:

- **Images** are immutable.
- **Container writable layer** is ephemeral:
  - If you `docker rm` the container, changes in that layer vanish.
- **Volumes** are persistent:
  - They outlive containers and can be attached to new ones.

Workflow implication:

- To **change the app code or binaries**, you usually:
  - Change source.
  - Rebuild image.
  - Start new container from new image.
- To **persist data** (database, uploads):
  - Use volumes, not the container’s writable layer.

---

## 8. Debugging Containers: A Practical Playbook

When something “doesn’t work,” follow a steady sequence.

## 8.1 Container exits immediately

- Check status:
  bash
  `docker ps -a`
- Inspect exit code and logs:
  bash
  `docker logs my-container`

Common causes:

- Wrong command in `CMD` / `ENTRYPOINT` (executable not found).
- Main process completes and exits (e.g., script finishing).
- Crash due to missing config/env.

Fix: make sure the main process is long‑running and configured correctly.

---

## 8.2 Container running, but port not accessible

Checklist:

1. Is the container **running**?

   bash

   `docker ps`

1. Is the app actually listening on the right port inside the container?
   `docker exec -it api sh`
   `# inside container:`
   `netstat -tulnp  # or ss -tulnp`

   Many apps bind to `127.0.0.1`; inside a container, that’s still the container only.  
   You usually want to bind to `0.0.0.0`.

1. Is the port mapped on the host?
   `docker ps # look at PORTS column, e.g. 0.0.0.0:8080->8080/tcp`
1. Can you curl from the host?
   `curl http://localhost:8080/health`

If it works inside the container but not outside:

- The app might only listen on localhost inside the container.
- Or the port mapping (`-p`) is wrong/missing.

---

## 8.3 Container can’t reach another container (DB, cache, etc.)

Checklist:

1. Are they on the same Docker network?
2. Is the dependency container running?
3. Is your app using the **container name** as hostname (on user‑defined networks)?

Debug:

```
docker exec -it api sh
# inside api container:
ping db
apk add --no-cache curl
curl http://db:5432  # or appropriate protocol/port

```

If DNS name doesn’t resolve, check that both are attached to the same user‑defined network and not using the default bridge incorrectly.

---

## 9. Containers in the Bigger Picture: Why This Mental Model Matters

Once you internalize:

- Container = process with isolation.
- Image = filesystem + metadata.
- Volume = persistent data.

then:

- Debugging Docker is just debugging Linux processes with extra tooling.
- Moving to Kubernetes is easier because Pods are also just wrapper abstractions around containers/processes.
- You stop expecting “VM‑like” behaviors (like “I changed a file and it should persist forever”) and design images + volumes properly.
