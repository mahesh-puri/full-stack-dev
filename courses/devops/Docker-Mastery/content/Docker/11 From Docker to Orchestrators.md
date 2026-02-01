---
title: "11. From Docker to Orchestrators"
# tags:
#   - docker
#   - debugging
#   - troubleshooting
draft: false
---

All the mental models you’ve built (images, containers, networks, volumes, Compose) are the foundation of Swarm and Kubernetes. Orchestrators don’t replace Docker; they automate it at **cluster scale**: scheduling, self‑healing, service discovery, and rolling upgrades.

---

## 1. Why Docker alone isn’t enough in production

Docker on a single host is great, but production needs more:

- **Scheduling**
  - Decide *which* node runs each container.
  - Rebalance when nodes join/leave or fail.
- **Self‑healing**
  - Restart crashed containers automatically.
  - Reschedule them to another node if the current node dies.
- **Scaling**
  - Run N replicas of a service across multiple nodes.
  - Scale up/down based on traffic or SLOs.
- **Service discovery & load balancing**
  - Give clients a stable name (e.g., `orders-api`) even as containers move around.
  - Load balance across replicas.

Where orchestrators fit:

- **Docker Swarm**
  - Docker’s built‑in clustering/orchestration mode.
  - Simpler mental model, tight Docker integration.
- **Kubernetes**
  - De‑facto standard orchestrator.
  - Rich API, strong ecosystem, steeper learning curve.

Your Docker concepts (images, containers, networks, volumes, Compose) become the **building blocks** that Swarm and Kubernetes manage across many machines.

---

## 2. Concept mapping table

Here’s how your Docker knowledge maps into Kubernetes (and, conceptually, Swarm):

| Docker / Compose concept   | Kubernetes concept                        | Mental mapping                                                |
| -------------------------- | ----------------------------------------- | ------------------------------------------------------------- |
| Image                      | Image (same)                              | Same artifact; pulled by nodes, defined in Pod specs          |
| Container                  | Container inside a **Pod**                | Pod = 1+ tightly coupled containers (usually 1 for your apps) |
| `docker run`               | Pod (direct) / Deployment (managed Pods)  | Deployment continuously ensures Pods exist                    |
| Compose service            | Deployment + Service                      | Deployment: replicas; Service: stable DNS + load balancing    |
| Docker network             | Cluster network + Service + CNI           | CNI provides Pod IPs; Services provide stable virtual IPs/DNS |
| Container name DNS         | Service name / Pod DNS                    | `db` in Compose → `db` Service in k8s                         |
| Docker volume              | PersistentVolume (PV)                     | Actual storage definition                                     |
| Volume declaration in YAML | PersistentVolumeClaim (PVC)               | Pod requests storage via PVC                                  |
| Bind mount                 | hostPath volume                           | Direct host path mounting (used sparingly in k8s)             |
| Compose stack (file)       | Manifests: Deployment, Service, PVC, etc. | Same intent, more detailed resources                          |
| `docker logs` / `exec`     | `kubectl logs` / `kubectl exec`           | Same debugging pattern, different CLI                         |

If you’re comfortable with:

- Images and containers.
- Networks and DNS service names.
- Volumes and data separation.
- Compose files as multi‑service specs.

…then you already understand 70% of what Kubernetes objects are trying to express—just in a more explicit way.

---

## 3. Swarm in one page (optional, but good for intuition)

Swarm mode turns Docker into a simple orchestrator.

## Basic concepts

- **Node** – a Docker Engine participating in the swarm (manager or worker).
- **Service** – a declarative description of a set of tasks (containers) with image, replicas, ports.
- **Task** – one running container which is part of a service.
- **Overlay networks** – multi‑host networks for inter‑service communication.

## Common commands

Initialize Swarm (on manager):

`docker swarm init`

Create a service:

```
docker service create \
  --name web \
  --replicas 3 \
  -p 80:80 \
  nginx:1.25-alpine
```

Scale:

`docker service scale web=5`

Inspect:

```
docker service ls
docker service ps web
```

Takeaway:

- A **Swarm service** is to containers what `docker-compose` service is to single host—but with scheduling and replication across nodes.
- It’s simpler than Kubernetes and uses the same Docker CLI mental model, so it’s good training for thinking about clusters.

---

## 4. Kubernetes‑oriented view

Kubernetes is more verbose, but it’s still doing “Docker plus orchestration,” just with a very rich API.

## Why images, tags, and security hardening matter more

In Kubernetes:

- Your images are pulled onto **many nodes**.
- Any mistake in the image (secrets baked in, running as root, huge size) is multiplied across the cluster.
- Rolling updates, autoscaling, and chaos testing all assume images are:
  - Small (fast to pull).
  - Correctly tagged (so you know what’s running).
  - Reasonably secure (non‑root, minimal base).

Everything you did right in Docker:

- Multi‑stage builds.
- Non‑root `USER`.
- Stable tagging (`1.2.3`, `git-abc1234`).
- HEALTHCHECK endpoints.

…makes Kubernetes deployments smoother:

- Rolling updates can quickly pull new images.
- Readiness/liveness probes call your health endpoints.
- RBAC + PodSecurity settings play nicer with non‑root images.

## How Dockerfile/image choices affect rolling updates and autoscaling

- **Rolling updates**
  - Kubernetes pulls the new image on each node and starts new Pods gradually.
  - Large images → slow rollouts → longer partial deployments.
  - Misconfigured health endpoints → Pods marked not ready → failed updates.
- **Autoscaling**
  - HPA (Horizontal Pod Autoscaler) scales Pod count based on CPU, memory, or custom metrics.
  - If your image is CPU‑heavy due to debug tools or unbounded resource usage, autoscaling decisions are noisier.
  - Resource requests/limits must match realistic container behavior (the same `--cpus`, `--memory` you practiced in Docker).

In short: good Docker hygiene is a prerequisite for sane Kubernetes behavior.

---

## 5. How to practice: from Compose to k8s

The best way to internalize the mapping is to **port a real Compose stack** to Kubernetes step by step.

Assume you have a simple `docker-compose.yml`:

```
version: "3.9"

services:
  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: orders
      POSTGRES_USER: orders_user
      POSTGRES_PASSWORD: secret
    volumes:
      - pgdata:/var/lib/postgresql/data

  api:
    image: myorg/orders-api:1.0.0
    ports:
      - "8080:8080"
    environment:
      DB_HOST: db
      DB_PORT: 5432
      DB_NAME: orders
      DB_USER: orders_user
      DB_PASSWORD: secret
    depends_on:
      - db

volumes:
  pgdata:

```

## Step‑wise migration outline

**Step 1 – API Deployment + Service**

- Create a Deployment for `api`:
  - `spec.template.spec.containers[0].image = myorg/orders-api:1.0.0`.
  - Env vars copied into `env:` section.
- Create a Service for `api`:
  - Type `NodePort` or `LoadBalancer` for external access to 8080.
  - Port 8080 mapped to container port 8080.

**Step 2 – DB Deployment/StatefulSet + Service**

- Create a Deployment or StatefulSet for `db`:
  - `image: postgres:15-alpine`.
  - Env vars for DB credentials.
- Create a PVC and Volume for data:
  - `PersistentVolumeClaim` representing the `pgdata` volume.
  - Mount at `/var/lib/postgresql/data`.
- Create a ClusterIP Service `db`:
  - Port 5432.
  - DNS name: `db` in the namespace.

**Step 3 – Wire API to DB**

- In the API Deployment, set:

```
env:
  - name: DB_HOST
    value: db
  - name: DB_PORT
    value: "5432"
```

- Now `api` Pods use the Service name `db` (just like Compose uses `db` as service name).

**Step 4 – Add health probes**

- Translate your Docker HEALTHCHECK to k8s probes:

```
readinessProbe:
  httpGet:
    path: /actuator/health
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 10

livenessProbe:
  httpGet:
    path: /actuator/health
    port: 8080
  initialDelaySeconds: 30
  periodSeconds: 30

```

**Step 5 – Apply resource limits**

- Use your Docker experience with `--cpus`, `--memory` to choose:

```
resources:
  requests:
    cpu: "250m"
    memory: "256Mi"
  limits:
    cpu: "1"
    memory: "512Mi"

```

This stepwise port keeps you focused on **conceptual equivalence**, not memorizing YAML.

---

## How to build intuition, not just YAML muscle memory

- Start every k8s object by asking:
  - “What is this in Docker/Compose terms?”
  - “Which part of my Compose file is this mapping?”
- Practice debugging in k8s with the same mental sequence:
  - `kubectl get pods` (like `docker ps`).
  - `kubectl logs` (like `docker logs`).
  - `kubectl exec` (like `docker exec`).
  - `kubectl describe` (similar to `docker inspect` + events).

Your Docker‑level understanding (images, containers, networking, volumes, Compose, debugging) is not wasted; it’s the **core foundation** that makes Kubernetes feel like a natural next layer instead of a completely foreign system.
