---
title: "0. Course Overview and Index"
# tags:
#   - docker
#   - containers
#   - devops
draft: false
---

This course builds a **practical** mental model of Docker from first principles and then connects it to real-world DevOps workflows.  
Each section below links to a focused note that you can read and practice independently.

---

## 1. Docker Images – How the Lego Bricks of Containers Really Work

( See: [[Docker/1 Docker Images|Docker Images]] )

**You will learn:**

1. Image vs container vs registry
   - Image as an immutable blueprint.
   - Container as a running process plus writable layer.
   - Registry as a Git‑like store for built images.

2. Layered filesystems and why each instruction matters
   - How every Dockerfile instruction creates a new layer.
   - Why `RUN apt-get update && apt-get install ...` vs multiple `RUN`s changes cache behavior.
   - Refactoring a bad Dockerfile into a cache‑friendly one.

3. Build, tag, and push workflow
   - Mental model of `docker build`: context → Dockerfile → layers.
   - Semantic tagging strategy: `1.0.0`, `1.0.0-prod`, `latest` as a pointer, not magic.
   - End‑to‑end flow from local build to private registry push.

4. Inspecting and understanding images
   - Using `docker inspect` and `docker history` to reverse engineer an image.
   - Detecting bloated layers (large COPY, uncleaned caches, logs, temp files).
   - Comparing `openjdk` vs `temurin` vs `distroless` images.

5. Cleaning up and managing the local image store
   - Why dangling images exist and when to prune safely.
   - Safe vs dangerous cleanup commands with `docker image prune` and friends.

6. Practical image best practices
   - Prefer small, purpose‑built base images.
   - Keep Dockerfile instructions deterministic and ordered.
   - Keep secrets and credentials out of images.

---

## 2. Containers – Processes, Not Tiny VMs

( See: [[Docker/2 Docker Containers|Docker Containers]] )

**You will learn:**

1. Mental model: container = process + isolation
   - High‑level view of namespaces and cgroups.
   - Operational differences between VMs and containers.

2. Container lifecycle in five phases
   - Create → Start → Running → Stopped → Removed.
   - One‑off task containers vs long‑running service containers (e.g., `alpine` vs `nginx`).

3. Running containers in real life
   - The `docker run` flags that actually matter: `-d`, `--name`, `-p`, `-e`, `--restart`, `--rm`.
   - Running a Spring Boot service with environment variables and a restart policy.

4. Monitoring and interacting with containers
   - Using `logs`, `exec`, `inspect`, `stats` as your stethoscope toolkit.
   - A step‑by‑step checklist for “App is not responding on port 8080”.

5. Resource control
   - CPU and memory limits, and why they matter on multi‑tenant hosts.
   - Examples of over‑limiting vs giving fair resource allocations.

6. Practical rules of thumb
   - “One main process per container” and when sidecars are acceptable.
   - Sensible restart policies for APIs vs cron‑like jobs.

---

## 3. Docker Networking – Making Containers Talk Like Grown‑Ups

( See: [[Docker/3 Docker Networking|Docker Networking]] )

**You will learn:**

1. Mental model of container networking
   - Network namespaces, veth pairs, and the default bridge.
   - Why `localhost` inside a container is not your host.

2. Built‑in network drivers
   - `bridge` (default), user‑defined bridge, `host`, `none`, and a high‑level view of overlay.
   - When to use each driver and when to avoid it.

3. User‑defined bridges and Docker DNS
   - How Docker auto‑creates DNS names from container names.
   - Example: `db` and `api` on `app-net` communicating via service names.

4. Port publishing vs internal ports
   - Mental model for `-p host:container` mappings.
   - Common pitfalls: port already in use, wrong interface, host firewall issues.

5. Debugging networking issues
   - Checklist: container running, port exposed, port published, basic connectivity between containers.
   - Example: stepwise debug of “API can’t connect to DB” on the same network.

6. Production considerations
   - Why `--net=host` is usually a bad idea.
   - How these networking concepts map cleanly to Kubernetes Services.

---

## 4. Volumes – Keeping Data Alive When Containers Die

( See: [[Docker/4 Docker Volumes|Docker Volumes]] )

**You will learn:**

1. Container filesystem vs persisted data
   - Why the writable container layer is ephemeral.
   - Where databases and uploaded files should actually live.

2. Types of Docker storage
   - Named volumes vs bind mounts vs tmpfs.
   - Pros and cons from both development and production perspectives.

3. Named volumes in practice
   - Using named volumes for Postgres, MySQL, MongoDB, etc.
   - Demo: kill a DB container, start a new one, and show that data survives.

4. Bind mounts for fast developer feedback
   - Live‑reloading workflows for Node/React/Angular or Spring Boot dev mode.
   - Risks: permissions, line endings, OS semantics differences.

5. Inspecting and managing volumes
   - Listing volumes and finding where they live on disk.
   - Simple backup and restore flows using `tar` or similar tools.

6. Production opinions
   - “No important data in the container filesystem” rule.
   - Why arbitrary host path bind mounts are dangerous in production.

---

## 5. Dockerfile Instructions – Writing Dockerfiles Like an Engineer

(See: [[Docker/5 Dockerfile Mastery|Dockerfile Mastery]] )

**You will learn:**

1. Dockerfile as a deterministic build recipe
   - Top‑down execution, build cache, and layer invalidation.
   - Why instruction order directly affects build time and cache reuse.

2. Core instructions, with intent
   - `FROM`, `RUN`, `COPY`/`ADD`, `WORKDIR`, `ENV`, `ARG`, `EXPOSE`, `USER`, `CMD`, `ENTRYPOINT`, `HEALTHCHECK`.
   - For each: what it really means and when to use it.

3. COPY vs ADD
   - Why `COPY` is usually safer and more predictable.
   - How ADD’s extra features (remote URLs, automatic tar extract) can surprise you.

4. ENV and ARG patterns
   - Build‑time vs runtime configuration.
   - Example pattern: version as an `ARG`, runtime profile as an `ENV`.

5. CMD vs ENTRYPOINT
   - Fixed executable vs overridable parameters.
   - Pattern: `ENTRYPOINT` for the main binary, `CMD` for default arguments.

6. Security‑aware Dockerfile writing
   - Creating and switching to non‑root users.
   - Avoiding secrets and sensitive files in images.

7. Refactoring a bad Dockerfile
   - Starting from a naive Dockerfile.
   - Iteratively improving size, cache behavior, and security.

---

## 6. Multi‑Stage Builds – Shrinking Images and Attack Surface

(See: [[Docker/6 Multi‑Stage Docker Builds|Multi‑Stage Docker Builds]] )

**You will learn:**

1. The problem: fat images with build tools inside
   - Shipping JDKs, compilers, and dev dependencies to production.
   - Impact on pull time, security posture, and disk usage.

2. Concept: separate build stage from runtime stage
   - How `AS build` and `COPY --from` work.
   - Why multiple stages are cheap but powerful in Docker.

3. Language‑specific examples
   - Node: build static assets and serve from Nginx.
   - Java: JDK + Maven for build, JRE‑only or distroless image for runtime.
   - Go: build in `golang`, run in `scratch` or `distroless`.

4. Optimizing build cache in multi‑stage builds
   - Placing dependency steps before copying full source.
   - Example: separate `pom.xml` copy and `mvn dependency:go-offline`.

5. Security and compliance benefits
   - Fewer binaries in the final image → smaller attack surface.
   - Cleaner vulnerability scan reports with less noise.

6. Migration story
   - Taking a legacy single‑stage Dockerfile.
   - Converting it into a lean, multi‑stage build step by step.

---

## 7. Docker Security – Baseline Guardrails for Devs and DevOps

(See: [[Docker/7 Docker Security Essentials|Docker Security Essentials]] )

**You will learn:**

1. Threat model for containers
   - Containers share the host kernel and what that implies.
   - Why “it’s in a container” is not a security boundary by itself.

2. Users and permissions
   - Non‑root users inside containers with the `USER` instruction.
   - File ownership patterns when using volumes and bind mounts.

3. Capabilities and seccomp (conceptual)
   - Basics of Linux capabilities and the principle of least privilege.
   - Simple patterns: drop everything, then add back only what you need.

4. Image hygiene
   - Keeping base images updated and slim.
   - Installing only necessary packages and cleaning caches.

5. Runtime hardening flags
   - Read‑only root filesystems, no‑new‑privileges, and similar options.
   - Example of tightening an Nginx container with runtime flags.

6. Secrets handling basics
   - Why you never bake secrets into images.
   - High‑level overview of secret managers and runtime injection.

---

## 8. Registries and Tagging – Versioning Containers Like Real Software

(See: [[Docker/8 Docker Registries and Tagging|Docker Registries and Tagging]] )

**You will learn:**

1. Registries as artifact repositories
   - Public registries (Docker Hub) vs private registries (ECR, GCR, Harbor, etc.).
   - Namespaces and repository naming like `myorg/service`.

2. Tagging strategies that scale
   - Semantic versions, build numbers, and Git SHA tags.
   - When and how to use `latest` safely, especially outside production.

3. Push/pull workflow in CI/CD
   - Build → tag with SHA + semantic version → push → deploy by tag.
   - Example of a simple CI pipeline from commit to running container.

4. Promoting images across environments
   - Retag and redeploy the same artifact for dev, staging, prod.
   - Why this simplifies debugging, rollback, and auditing.

5. Registry access and authentication
   - Logging in, using tokens and credentials securely.
   - High‑level view of pulling from private registries in orchestrators.

---

## 9. Docker Compose – Local Microservices Without Losing Your Mind

(See: [[Docker/9 Docker Compose|Docker Compose]] )

**You will learn:**

1. Why Docker Compose exists
   - Pain of long `docker run` commands for multi‑service stacks.
   - YAML as a declarative “docker run on steroids”.

2. Core Compose concepts
   - Services, networks, and volumes defined in YAML.
   - One Compose file as a self‑contained local environment or stack.

3. Walking through a simple stack
   - `api` + `db` example with environment variables, ports, and volumes.
   - How Compose auto‑creates networks and DNS names.

4. Developer workflows
   - Using `docker compose up -d`, `logs -f`, `ps`, `down`, `restart`.
   - Pattern: change code, rebuild image, restart only the affected service.

5. Patterns and best practices
   - Override files for local development vs CI pipelines.
   - Using healthchecks to improve startup order and reliability.

6. Bridge to Kubernetes
   - Mapping services, networks, and volumes to Deployments and Services.
   - Using Compose mental models as a stepping stone to k8s.

---

## 10. Troubleshooting and Debugging – A Systematic Playbook

(See: [[Docker/10 Debugging Docker|Debugging Docker]] )

**You will learn:**

1. Mindset: containers as Linux processes
   - Start with basics: is it running, using CPU, memory, and correct ports.
   - Avoid jumping straight to complex tools.

2. When a container will not start
   - Checking logs vs exit codes.
   - Common errors: command not found, permission denied, missing environment variables.

3. Container runs, but the app is unreachable
   - Checklist: internal port, published port, host firewall, binding to `0.0.0.0` vs `127.0.0.1`.
   - Example flow to validate each assumption.

4. App cannot reach another container
   - Verifying shared networks and DNS resolution.
   - Using `exec`, `curl`, and `ping` from inside containers.

5. Performance and resource issues
   - Using `docker stats` and tools like `top` inside containers.
   - Understanding CPU throttling and OOM kills.

6. Building your own debug checklist
   - Turning these steps into a reusable SOP.
   - How this mindset maps naturally to debugging Kubernetes Pods.

---

## 11. Orchestration Hooks – How Docker Knowledge Transfers to Swarm and Kubernetes

(See: [[Docker/11 From Docker to Orchestrators|From Docker to Orchestrators – How Your Mental Models Carry Over]] )

**You will learn:**

1. Why Docker alone is not enough in production
   - Requirements like scheduling, self‑healing, scaling, and service discovery.
   - Where Docker Swarm and Kubernetes fit into the picture.

2. Concept mapping table
   - Docker container → Kubernetes Pod.
   - Docker network → Kubernetes Service / CNI.
   - Docker volume → PersistentVolume / PersistentVolumeClaim.
   - Compose file → Kubernetes Deployments, Services, and other manifests.

3. Swarm in one page (optional)
   - Basic workflow: `swarm init`, creating services, scaling up and down.
   - When Swarm is still useful for learning or small clusters.

4. Kubernetes‑oriented view
   - Why images, tags, and security hardening matter more under an orchestrator.
   - How Dockerfile and image choices affect rolling updates and autoscaling.

5. Practice path: from Compose to Kubernetes
   - Taking a Compose stack and gradually porting it to Kubernetes YAML.
   - Focusing on building intuition instead of memorizing raw YAML.
