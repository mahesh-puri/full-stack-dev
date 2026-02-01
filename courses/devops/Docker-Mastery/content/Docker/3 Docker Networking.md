---
title: "3. Docker Networking"
# tags:
#   - docker
#   - debugging
#   - troubleshooting
draft: false
---

Docker networking feels magical until something doesn’t connect—then it feels like black magic. The cure is a clear mental model: each container has its **own network stack**, and Docker wires these stacks together using Linux primitives (bridges, veth pairs, iptables, etc.). Once you understand that, service‑to‑service communication becomes predictable instead of trial‑and‑error.

This article builds that model, then walks through real commands and a practical debugging playbook.

---

## 1. Mental Model: What Happens When You `docker run -p 8080:80 nginx`

Let’s start with the most common confusion: why does `localhost` sometimes work and sometimes not?

When you run:

`docker run -d --name web -p 8080:80 nginx:1.25-alpine`

Docker does roughly this under the hood:

1. Creates a **network namespace** for the container (its own IP stack).
2. Creates a **veth pair**: one end inside the container, one end on the host bridge.
3. Connects the host end to a Linux bridge (often `docker0`) that acts like a virtual switch.
4. Assigns the container an IP on that bridge (e.g. `172.17.0.2`).
5. Sets up **NAT rules** so traffic hitting host `:8080` gets DNAT‑ed to container `172.17.0.2:80`.

Key consequences:

- Inside the container, `localhost` means “this container,” not your host.
- From the host, you normally reach containers via **published ports** (`-p`) or the container IP (bridge network).
- Containers talk to each other directly using their IPs or (on user‑defined networks) their **service names**.

---

## 2. Built‑in Network Drivers: bridge, host, none, overlay

Docker ships with several network “drivers.” You rarely need all of them, but knowing what they do matters.

## 2.1 `bridge` – the default

- Default for containers when you don’t specify `--network`.
- Single‑host, NAT‑based networking.
- Containers get IPs like `172.17.x.x` and talk to each other using those IPs.

For quick experiments, this is fine, but for anything non‑trivial you’ll prefer **user‑defined bridges** (still `bridge` driver, but created by you).

## 2.2 User‑defined bridge – **the recommended default**

`docker network create app-net`

Properties:

- Containers attached to this network get:
  - Their own IP in that network.
  - Built‑in **DNS**: container names → IPs.
- Docker does some extra isolation and better defaults than the implicit `bridge`.

Typical workflow:

```
docker run -d --name db --network app-net \
  -e POSTGRES_PASSWORD=secret \
  postgres:15-alpine

docker run -d --name api --network app-net \
  -e DB_HOST=db \
  myorg/orders-api:1.0.0

```

Now:

- `api` can reach `db` at hostname `db:5432`.
- You don’t care what the actual IPs are (Docker DNS resolves names).

## 2.3 `host` – share host network

`docker run --net=host nginx:1.25-alpine`

- Container shares the host’s network namespace.
- No port mapping needed (or possible): if Nginx listens on `:80` in container, it’s listening on host `:80`.

Pros:

- Slightly lower overhead, easier for some tools (like sniffers, some monitoring agents).

Cons:

- No isolation.
- Port conflicts with host processes.
- Not available on Docker Desktop in the same way for all OSes.

Use it sparingly, mostly for special system‑level stuff.

## 2.4 `none` – fully isolated

`docker run --network none alpine:3.19`

- Container has no network connectivity.
- Only useful for specialized isolation scenarios or when you explicitly don’t want any network.

## 2.5 `overlay` – multi‑host networks

- Used with Docker Swarm (or similar setups).
- Creates a logical network spanning multiple hosts, often via VXLAN.
- Lets services running on different nodes talk as if on the same LAN.

For now, just remember: overlay is for clustering; you’re unlikely to need it in simple, single‑host dev setups.

---

## 3. Ports: Inside vs Outside, and Why `localhost` Lies

Every networked app has two sides:

1. **Inside the container**: the port the process binds to.
2. **Outside** (host or other machines): how you expose that port.

Example:

`docker run -d --name api -p 8080:8080 myorg/orders-api:1.0.0`

- Inside container: your app binds to `8080`.
- On host: Docker publishes host `0.0.0.0:8080` → container `<container-ip>:8080`.

Common traps:

- App binds to `127.0.0.1` inside the container:
  - It’s reachable **from inside** the container, but not from the host through bridged networking.
  - You usually want it to bind to `0.0.0.0` inside the container.
- Forgot `-p` entirely:
  - Container can still serve other containers on same network.
  - But host `curl http://localhost:8080` fails, because nothing is listening on host `8080`.

Quick check:

`docker ps # Look at PORTS column: should show something like 0.0.0.0:8080->8080/tcp`

---

## 4. Docker Networking in Practice: Multi‑Container Stack

Let’s wire up a simple but realistic stack: `api` + `db`.

## 4.1 Create a network

`docker network create app-net`

## 4.2 Run the database

```
docker run -d --name db --network app-net \
  -e POSTGRES_PASSWORD=secret \
  -v pgdata:/var/lib/postgresql/data \
  postgres:15-alpine
```

Observations:

- `db` gets IP on `app-net` (say `172.18.0.2`).
- Docker DNS will resolve `db` to that IP for containers on `app-net`.

## 4.3 Run the API

```
docker run -d --name api --network app-net \
  -p 8080:8080 \
  -e DB_HOST=db \
  -e DB_PORT=5432 \
  myorg/orders-api:1.0.0

```

Inside the container, your Spring Boot app will connect to Postgres at host `db`, port `5432`.

You can now:

- From host: `curl http://localhost:8080/actuator/health`
- From `api` container: `ping db` or `nc -z db 5432`

---

## 5. Inspecting Networks: Seeing the Wiring

To see what’s really going on, inspect:

`docker network inspect app-net`

You’ll get:

- Subnet and gateway for the network (e.g. `172.18.0.0/16`).
- List of connected containers and their IP addresses.
- Driver (`bridge`) and some config.

This is your **source of truth** when you’re debugging connectivity:

- Is `api` actually on `app-net`?
- Is `db` actually on `app-net`?
- Are there multiple networks with similar names?

---

## 6. Debugging Connectivity: A Step‑By‑Step Playbook

When “service A can’t talk to service B,” don’t guess. Follow a consistent sequence.

## 6.1 Check containers and networks

1. Are both containers running?

   bash

   `docker ps`

2. Are they on the **same network**?

   bash

```
docker inspect api | grep -A3 Networks
docker inspect db  | grep -A3 Networks
```

If they’re not on the same user‑defined network, Docker DNS won’t resolve names across them.

---

## 6.2 Exec into the caller and test

From the `api` container:

```
docker exec -it api sh

# Inside api:
ping db           # should resolve and respond (if ping is installed)
apk add --no-cache curl
curl -v http://db:5432   # or use nc/telnet if appropriate

```

Interpretation:

- If `ping db` fails with “unknown host,” DNS is broken (wrong network, typo in name).
- If DNS works but `curl` or `nc` fails:
  - `db` might not be listening on the expected port.
  - Firewall or misconfig inside `db` container.

---

## 6.3 Host ↔ container access

If host can’t reach container:

1. Confirm port mapping:

   `

```
docker ps
# Check PORTS: 0.0.0.0:8080->8080/tcp?
```

`

2. Curl from host:

   `curl -v http://localhost:8080/health`

3. If that fails, curl from inside container:
   `docker exec -it api sh curl -v http://localhost:8080/health`

- Works inside but not from host → usually port mapping or firewall issue.
- Doesn’t even work inside → app not listening on expected port or binding to wrong interface.

---

## 7. Host Networking: When and Why (Not) to Use It

`--net=host` (or `--network host`) gives containers the host’s network stack.

Pros:

- No NAT overhead.
- Useful for network tools that need direct host access (e.g., sniffers, some monitoring agents).
- Simplifies some local dev scenarios (no `-p` needed).

Cons:

- No port isolation; a container can bind host ports directly and conflict with host services.
- Less separation in terms of firewalling and security.

Example:

`docker run --net=host --name monitor \   some/network-monitoring-tool`

For most application containers, especially in multi‑tenant or production settings, stick with bridged networks and explicit `-p` mappings.

---

## 8. From Docker Networking to Kubernetes Services

You’re ultimately heading to Kubernetes, so it’s useful to see how this mental model transfers:

- Docker **user‑defined network** → Kubernetes **cluster network** (via CNI plugin).
- Docker **container name DNS** → Kubernetes **Service name** and **Pod DNS**.
- Docker `-p host:container` → Kubernetes **Service type NodePort / LoadBalancer / Ingress**.

If you’re comfortable with:

- Creating networks,
- Attaching containers,
- Using DNS names instead of IPs,
- Debugging using `exec`, `curl`, and `network inspect`,

then Kubernetes networking will feel like a structured extension, not a totally new universe.

---

## 9. Practical Rules of Thumb

To anchor all this, here are some simple rules you can treat as defaults:

- Use **user‑defined bridge networks** for any multi‑container app, not the default `bridge`.
- Always think: “inside vs outside” ports; don’t trust `localhost` without context.
- Prefer **DNS names** (container names) over hardcoded IPs for container‑to‑container calls.
- Build a routine for debugging:
  - `docker ps`
  - `docker network ls`
  - `docker network inspect`
  - `docker logs`
  - `docker exec + curl/ping`

This turns “Docker networking is magic” into “Docker networking is just Linux networking with nicer defaults.”

---
