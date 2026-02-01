---
title: "10. Debugging Docker"
# tags:
#   - docker
#   - debugging
#   - troubleshooting
draft: false
---

When something breaks in Docker, resist the urge to “try random commands until it works.” Containers are just Linux processes with extra plumbing, so you debug them the same way: check if they exist, if they run, what they log, what they listen on, and what they can reach.

This playbook gives you a **sequence** to follow so you don’t miss obvious issues.

---

## 1. Mindset: treat containers like Linux processes

Before touching Docker‑specific tricks, anchor this:

- A container is a **process** (or a few) on the host, with:
  - Its own filesystem view (from the image).
  - Its own network namespace (its own IP/ports).
  - Resource limits via cgroups.

So, for any problem, ask in order:

1. Does the container **exist**? (`docker ps -a`)
2. Is it **running**? (`docker ps`)
3. What is its **status and exit code**? (`docker inspect`)
4. What do the **logs** say? (`docker logs`)
5. How are **CPU, memory, ports** behaving? (`docker stats`, `ss`/`netstat`, `top` inside).

Don’t jump straight to exotic tools. 80% of issues fall into:

- Wrong command / missing binary.
- Permissions.
- Wrong ports.
- Network miswiring.
- Resource exhaustion.

---

## 2. Container won’t start

Symptom: you run `docker run ...`, it exits immediately, or `docker compose up` shows services flapping.

## 2.1 Check status and exit code

List recently exited container:

bash

`docker ps -a --latest`

Inspect its state:

bash

`docker inspect <container> --format '{{.State.Status}} {{.State.ExitCode}} {{.State.OOMKilled}} {{.State.Error}}'`

- `Status` – e.g., `exited`.
- `ExitCode` – `0` means “clean exit,” non‑zero indicates error.
- `OOMKilled` – `true` if the kernel killed it for memory.

## 2.2 Look at logs

```
docker logs <container>
# Or follow if it keeps flapping:
docker logs -f <container>
```

Common issues visible here:

- **Command not found**:
  - Error like: `executable file not found in $PATH`.
  - Your CMD/ENTRYPOINT points to a script/binary that doesn’t exist or isn’t executable.
- **Permission denied**:
  - Running a script without exec permission.
  - Writing to a path the user can’t access.
- **Missing environment/config**:
  - Application fails early because required env vars or config files aren’t set.

## 2.3 Reproduce interactively

If logs are unclear, start a container with an interactive shell using the same image:

```
docker run --rm -it <image> sh
# or bash if available
```

From there, manually run the command your Dockerfile uses as ENTRYPOINT/CMD:

```
java -jar app.jar
# or
./start.sh
```

You’ll see errors in real time and can inspect the filesystem to understand what's missing.

---

## 3. Container runs, but app is unreachable

Symptom: `docker ps` shows container as “Up”, but you can’t reach the app from host.

## 3.1 Check internal port and binding

First, exec into the container:

bash

`docker exec -it <container> sh`

Inside:

- Check if the app is listening on the expected port:
  bash
  `netstat -tulnp  # or ss -tulnp`
- Confirm address:
  - If bound to `0.0.0.0:8080`, it’s reachable from anywhere on that namespace.
  - If bound to `127.0.0.1:8080` inside the container, it’s reachable only from inside the container, which often breaks access through the Docker bridge.

Fix in app config:

- Bind your server to `0.0.0.0` inside the container (not `localhost`).

## 3.2 Check port publishing on the host

On the host:

bash

`docker ps`

Look at the `PORTS` column, e.g.:

- `0.0.0.0:8080->8080/tcp` – mapped correctly.
- Empty or just `8080/tcp` – no host port published.

If there’s no mapping, you probably forgot `-p`:

bash

`docker run -d --name api -p 8080:8080 myorg/api:1.0.0`

## 3.3 Host firewall and reachability

If mapping is correct but you still can’t reach:

1. Curl from the host:

   bash

   `curl -v http://localhost:8080/health`

2. If that fails, check:
   - Host firewall rules (iptables, ufw, firewalld, cloud security groups).
   - Docker Desktop/WSL routing on Windows/Mac if applicable.

3. If curl on host fails but curl **inside container** works:
   - App is healthy internally; issue is port mapping or firewall.

---

## 4. App can’t reach another container (DB, cache, etc.)

Symptom: API reports “can’t connect to DB/Redis/service” even though both containers are running.

## 4.1 Verify same network

Inspect containers:

```
docker inspect api | grep -A3 Networks
docker inspect db  | grep -A3 Networks
```

Check they share a common network (e.g., `app-net` or Compose’s default).

If not:

- Attach them to the same user‑defined network:

```
docker network create app-net
docker network connect app-net api
docker network connect app-net db
```

## 4.2 Check DNS name resolution

Inside the caller container (e.g., `api`):

```
docker exec -it api sh
ping db
```

- If you get “unknown host”: the name `db` doesn’t resolve → wrong network or typo.
- On user‑defined bridge networks, service/container names become DNS names automatically.

In Compose, the name used under `services:` is the DNS name (e.g., `db`).

## 4.3 Curl/ping the dependency

Still inside `api`:

```
apk add --no-cache curl  # if minimal image
curl -v http://db:5432   # or relevant port/protocol
```

Interpretation:

- Connection refused:
  - DB is not listening on the advertised port.
  - DB is still starting; check DB logs.
- Connection timeout:
  - Network misconfig, firewall, or wrong hostname.
- Works, but app still fails:
  - App may be using wrong env vars or URL; verify its connection string.

---

## 5. Performance and resource issues

Symptom: container is “running” but slow, unresponsive, or periodically crashes.

## 5.1 Check live resource usage

On the host:

`docker stats`

See:

- CPU% per container.
- Mem usage / limit.
- Network I/O.

If one container is pegging CPU or hitting memory limits, that’s your suspect.

## 5.2 OOM kills and exit code 137

If containers mysteriously exit with status `137`, it usually means:

- Process was killed by the **OOM killer** (out of memory).
- Exit code 137 = 128 + 9 (SIGKILL) – typical for OOM conditions.

Check:

`docker inspect <container> --format '{{.State.ExitCode}} {{.State.OOMKilled}}'`

If `OOMKilled=true`:

- Increase memory limit:
  `docker run -d --memory="1g" ...`
- Or reduce app memory usage (heap size, caches, concurrency).

## 5.3 Debugging inside the container

Exec into the container and use familiar tools:

```
docker exec -it api sh
top            # or htop if installed
ps aux         # see processes
```

Check if:

- There are too many threads/connectors.
- Some background process is hogging CPU.
- Logs show frequent GC or memory issues (for JVM apps).

---

## 6. Building a personal “debug checklist”

To avoid flailing, encode this playbook as your **SOP** (Standard Operating Procedure). For any broken container:

1. **Is the container running?**
   - `docker ps -a` → status and exit code.
   - If not running:
     - `docker logs <container>`
     - `docker inspect <container> ...State.*`

2. **If running but not reachable from host:**
   - Exec in: `docker exec -it <container> sh`
   - Check app listening and bind address (0.0.0.0 vs 127.0.0.1).
   - Check `docker ps` for correct `PORTS` mapping.
   - Test with `curl` from host and inside.

3. **If app can’t reach another container:**
   - Confirm same network (`docker network inspect`).
   - Use service name as hostname (e.g., `db`).
   - Exec into caller; `ping`/`curl` to dependency.

4. **If performance issues or crashes:**
   - `docker stats` for CPU/memory.
   - Look for OOMKilled, exit code 137.
   - Use `top`, `ps` inside container to see noisy processes.

5. **If still stuck:**
   - Reproduce with a minimal image (e.g., alpine + curl) to isolate network/dns issues.
   - Simplify Dockerfile/Compose config temporarily to narrow down the culprit.

## Mapping to Kubernetes later

In Kubernetes, you’ll do the **same steps**, just with `kubectl`:

- `docker ps` → `kubectl get pods`.
- `docker logs` → `kubectl logs`.
- `docker exec` → `kubectl exec`.
- `docker inspect` → `kubectl describe pod`.
- `docker stats` → metrics via `kubectl top` or monitoring stack.

So every debugging reflex you build with Docker translates almost 1:1 to Pods and Services in k8s, just with different commands.
