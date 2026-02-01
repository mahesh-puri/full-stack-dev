---
title: "4. Docker Volumes"
# tags:
#   - docker
#   - debugging
#   - troubleshooting
draft: false
---

Containers are designed to be disposable. That’s perfect for stateless services, but terrible for things like databases, uploads, and logs. **Volumes** are how Docker decouples the lifecycle of your data from the lifecycle of your containers.

This article builds a clear mental model of volumes, compares them with bind mounts, and gives you practical patterns and a debugging playbook.

---

## 1. Mental Model: Container FS vs Volume

Inside every container you have:

- A **read‑only** image filesystem (from the image layers).
- A **writable** layer on top (container’s own changes).

When you `docker rm` a container, that writable layer (and all its changes) disappears. That’s why:

- Writing a Postgres data directory to `/var/lib/postgresql/data` inside the container without a volume means your database disappears when the container is deleted.
- Editing app code inside the container is a temporary hack; it vanishes on rebuild.

Volumes solve this by creating **separate, managed storage** that:

- Lives outside the container’s writable layer.
- Can be attached to any container.
- Survives container deletion.

So think:

- Container filesystem = ephemeral.
- **Volume** = persistent, container‑independent data.

---

## 2. Types of Storage: Named Volumes vs Bind Mounts vs Tmpfs

Docker supports three main storage concepts:

1. **Named volumes**
   - Managed by Docker.
   - Identified by name (`pgdata`, `redis-data`).
   - Stored under Docker’s data directory (path differs by OS).
   - Best choice for persistent data in most cases.

2. **Bind mounts**
   - Direct mapping of a host path into the container (`/home/user/app:/app`).
   - Great for development (live code reload), or when you explicitly want to use a host directory.
   - You manage the directory; Docker just mounts it.

3. **Tmpfs mounts**
   - In‑memory filesystem for ephemeral data.
   - Contents are never written to disk on the host.
   - Useful for sensitive or high‑churn temporary data.

High‑level rule:

- Use **named volumes** for app data (databases, queues).
- Use **bind mounts** for development workflows and special host integrations.
- Use **tmpfs** for sensitive temp data or when you really want in‑memory only.

---

## 3. Named Volumes: Your Default for Persistent Data

## 3.1 Creating and listing named volumes

```
docker volume create pgdata
docker volume ls
docker volume inspect pgdata

```

Inspect shows:

- Name.
- Driver (usually `local`).
- Mountpoint on the host (where Docker stores the data).

You typically don’t touch that path directly; you let Docker manage it.

## 3.2 Using a named volume with a database

Postgres example:

```
docker run -d --name db \
  -e POSTGRES_PASSWORD=secret \
  -v pgdata:/var/lib/postgresql/data \
  postgres:15-alpine

```

Here:

- `pgdata` is the **named volume**.
- Inside the container, Postgres writes to `/var/lib/postgresql/data`.
- On the host, Docker maps that to some internal path for `pgdata`.

Now try:

1. Insert some data into the DB.
2. Destroy the container:

   bash

   `docker rm -f db`

3. Start a new container with the same volume:

```
docker run -d --name db2 \
  -e POSTGRES_PASSWORD=secret \
  -v pgdata:/var/lib/postgresql/data \
  postgres:15-alpine
```

Your data is still there. The container is disposable; the **volume** is the durable component.

## 3.3 Sharing volumes between containers

You can attach the same volume to multiple containers:

```
docker run -d --name db-admin \
  --network app-net \
  -v pgdata:/var/lib/postgresql/data:ro \
  some/pgadmin-image

```

- `:ro` makes it read‑only for that container.
- Both DB and admin UI share the same underlying data directory.

This pattern is powerful but be careful:

- Two writers to the same data directory → potential corruption unless the app explicitly supports it.

---

## 4. Bind Mounts: Perfect for Development

Bind mounts map a host directory directly into the container.

## 4.1 Basic example: mounting source code

```
docker run -d --name web-dev \
  -p 3000:3000 \
  -v "$PWD/src:/usr/src/app" \
  node:22-alpine \
  sh -c "cd /usr/src/app && npm install && npm run dev"

```

Here:

- Host `$PWD/src` is mounted into container `/usr/src/app`.
- When you edit source files on the host, changes are instantly visible inside the container.
- Perfect for hot‑reloading dev servers (Node, React, Angular, etc.).

## 4.2 Pros and cons of bind mounts

**Pros:**

- Great developer experience (no need to rebuild images for every code change).
- You can use your host editors and tools naturally.

**Cons:**

- Behavior differs by OS; Docker Desktop uses a VM and can have performance quirks.
- Permissions can be tricky (UID/GID mismatches).
- In production, you often don’t want arbitrary host directories exposed to containers.

Rule of thumb:

- Bind mounts: local dev, debugging, special host integration.
- Named volumes: production‑oriented persistent data and portable stacks.

---

## 5. Tmpfs Mounts: In‑Memory Storage for Sensitive or Ephemeral Data

Tmpfs mounts keep data in RAM, never on disk.

Example:

```
docker run -d --name cache \
  --tmpfs /var/cache/app \
  myorg/cache-heavy-app:1.0.0
```

Use cases:

- Sensitive temporary data that you do not want persisted.
- High‑churn temporary caches where disk I/O would be a bottleneck.

But remember:

- Data disappears when container stops.
- It consumes RAM, so monitor memory usage.

---

## 6. Managing Volumes Over Time

Volumes can accumulate just like images. You want a basic hygiene routine.

## 6.1 Listing and inspecting

```
docker volume ls
docker volume inspect some-volume
```

Find:

- Which volumes exist.
- Where they live on disk.
- Which containers are using them (via inspect/Docker metadata or by cross‑checking containers).

## 6.2 Pruning unused volumes

```
docker volume prune
# Add -f if you want to skip confirmation
```

This removes volumes that are **not** used by any container.

Be careful:

- If you have stopped containers that you think you might restart, removing volumes can destroy their data.
- In dev environments, regular prune is fine if you treat data as disposable.

---

## 7. Backups and Migration: Treat Volumes as Data Stores

Since a volume is just a filesystem path on the host, you can back it up using standard tools. A common pattern is to run a temporary helper container that mounts the volume.

For example, to tar a Postgres data volume:

```
docker run --rm \
  -v pgdata:/data \
  -v "$PWD:/backup" \
  alpine:3.19 \
  sh -c "cd /data && tar czf /backup/pgdata-backup.tgz ."
```

- `pgdata` is mounted at `/data` inside the helper container.
- Host current directory is mounted at `/backup`.
- You create an archive in the host current directory.

To restore, you’d reverse the process (carefully, ideally when DB is stopped).

This approach works for any volume‑backed data:

- Message broker data.
- File uploads.
- Anything that lives in a volume.

---

## 8. Permission & Ownership Gotchas

Containers run processes as some user (often `root` by default, but ideally a non‑root user you create). When you mount volumes or bind mounts, **file ownership matters**.

Typical problems:

- Host path is owned by `user:group` that doesn’t match container user.
- Container user cannot read/write the mounted directory.

Patterns to avoid pain:

1. **Align UIDs/GIDs**
   - Run container with a specific UID that matches host directory owner.
   - Or create the user in the Dockerfile with the right UID.

2. **Initialize volume from container**
   - Let the container create and own its data directories on first run.
   - Avoid pre‑creating them on host with mismatched ownership.

Example in Dockerfile:

```
RUN addgroup -S app && adduser -S app -G app
USER app
```

Then ensure that the volume mount point inside the container is writable by `app`.

If you see permission denied errors on mounted paths, think: “Which user am I inside the container, and who owns this directory?”

---

## 9. Volumes in Orchestrated Environments (Preview)

In basic Docker, volumes are relatively simple:

- Named volume → some directory on the host.
- Bind mount → exactly the host path you specify.

In Kubernetes and other orchestrators, these concepts grow into:

- **PersistentVolumes (PV)** and **PersistentVolumeClaims (PVC)**.
- Dynamic provisioning from storage classes (EBS, GCE PD, NFS, Ceph, etc.).
- Volume plugins for cloud, network storage, etc.

Your Docker mental model still holds:

- Pods mount volumes for persistence.
- Containers inside Pods see those volumes as directories, just like your Docker containers.
- The orchestrator manages lifecycle, scheduling, and attachment across nodes.

So the core idea—_data lives outside disposable containers_—remains exactly the same.

---

## 10. Practical Rules of Thumb for Volumes

To wrap this into actionable habits:

- **Never** rely on the container’s writable layer for important data; it dies with the container.
- Use **named volumes** for databases and anything you want to survive container recreation.
- Use **bind mounts** mainly for development or when you explicitly want host‑side control.
- Regularly inspect and prune unused volumes in dev environments.
- Always think about **ownership and permissions** when mounting directories.
- Practice backup/restore with at least one real service (e.g., Postgres) so it’s muscle memory.
