---
title: "8. Docker Registries and Tagging"
# tags:
#   - docker
#   - debugging
#   - troubleshooting
draft: false
---

Containers are just a packaging format; the **real** control over what runs in each environment comes from your registry and tagging strategy. If you treat images like real versioned artifacts (not random blobs named “latest”), debugging, rollbacks, and audits become much simpler.

---

## 1. Mental model: registry as artifact repository

Think of a container registry like a **Maven repository** or **Git server**, but for images.

- **Public registries**
  - Docker Hub (`docker.io/library/nginx`).
  - Public GHCR (GitHub Container Registry), etc.
  - Great for base images and open‑source artifacts.
- **Private registries**
  - AWS ECR (`123456789012.dkr.ecr.us-east-1.amazonaws.com/myorg/api`).
  - GCP Artifact Registry, Azure ACR.
  - Self‑hosted: Harbor, GitLab Registry, etc.
  - Used for your org’s internal services.

An image name has three parts:

`[REGISTRY/]NAMESPACE/REPOSITORY:TAG`

Examples:

- `nginx:1.25-alpine`
  - Registry: default Docker Hub.
  - Namespace: `library` (implicit).
  - Repository: `nginx`.
  - Tag: `1.25-alpine`.
- `my-registry.example.com/myorg/payment-service:1.0.0`
  - Registry: `my-registry.example.com`.
  - Namespace: `myorg`.
  - Repository: `payment-service`.
  - Tag: `1.0.0`.

Namespace + repository (`myorg/service`) should reflect **ownership and purpose**, like Maven group/artifact.

---

## 2. Tagging strategies that don’t ruin your life

Tags are **labels** pointing to an image ID. They’re not immutable by themselves; you decide how to use them.

## Semantic versions and build numbers

Treat images like versioned releases:

- Semantic versions: `1.0.0`, `1.0.1`, `2.0.0`.
- Build identifiers: `1.0.0-20260201.1`, `1.0.0+build.42`.
- Git SHA tags: `app:git-abc1234`.

Common pattern after building an image from commit `abc1234`:

```
docker tag myorg/api:build \
  myorg/api:1.2.3 \
  myorg/api:1.2 \
  myorg/api:git-abc1234

```

Now you can refer to the **exact** artifact by any of these tags, but `git-abc1234` is uniquely tied to a commit.

## Using `latest` responsibly

`latest` is just another tag; Docker doesn’t treat it specially. Problems arise when:

- Different teams assume `latest` means different things.
- `latest` points to different builds across environments.

Recommended:

- In **production**, avoid using `latest` in deployments. Use explicit version tags.
- If you keep `latest` at all, treat it as “most recent successful stable build,” and be disciplined about how it’s updated.

## Mapping `dev` / `staging` / `prod` to tags

Instead of rebuilding for each environment, use **tags to represent promotion level**:

- `myorg/api:1.2.3-dev`
- `myorg/api:1.2.3-staging`
- `myorg/api:1.2.3-prod`

Or keep environment tags separate from version tags:

- `myorg/api:1.2.3` is the version.
- `myorg/api:prod` points to whatever version is currently live in production (you move the `prod` tag during promotion).

This lets you answer:

- “What version is in prod?” → inspect `myorg/api:prod`.
- “What’s running in staging?” → `myorg/api:staging`.

---

## 3. Push/pull workflow in CI/CD

A clean CI/CD flow treats image building as part of the pipeline and relies on tagging for traceability.

## Example pipeline flow

Given a commit `abc1234` for version `1.2.3`:

1. **Build image**
   `docker build -t myorg/api:build .`
2. **Tag image with metadata**

```
GIT_SHA=abc1234
VERSION=1.2.3

docker tag myorg/api:build myorg/api:${VERSION}
docker tag myorg/api:build myorg/api:${VERSION}-${GIT_SHA}
docker tag myorg/api:build myorg/api:git-${GIT_SHA}

```

3. **Push to registry**

```
docker push myorg/api:${VERSION}
docker push myorg/api:${VERSION}-${GIT_SHA}
docker push myorg/api:git-${GIT_SHA}
```

4. **Deploy by tag**
   - Dev: deploy `myorg/api:${VERSION}-${GIT_SHA}`.
   - Staging: when tests pass, deploy the **same tag**.
   - Prod: promote that tag again.

At no point do you rebuild the image for each environment; you always deploy the **same artifact**.

## Why this is powerful

- Every running container is traceable back to a Git SHA and build.
- Logs, metrics, and incidents can be tied to a specific image version.
- When a bug is found, you know exactly which version introduced it.

---

## 4. Promoting images across environments

A common anti‑pattern: build separate images for dev, staging, prod, even when code is identical.

**Better:** build once, promote via tags.

## Promotion via retagging

Start with `myorg/api:1.2.3-abc1234` as your canonical build tag.

- Dev deployment: use `myorg/api:1.2.3-abc1234`.
- Once validated, **retag** in the registry or via CI:

```
docker tag myorg/api:1.2.3-abc1234 myorg/api:staging
docker push myorg/api:staging

```

- For production, do:

```
docker tag myorg/api:1.2.3-abc1234 myorg/api:prod
docker push myorg/api:prod
```

Now:

- `prod` represents “current production image.”
- `staging` represents “current staging image.”
- Both point back to the same underlying build and Git SHA.

## Benefits for debugging and rollback

When something breaks in prod:

- You can quickly see which tag/version is running.
- To roll back, point `prod` back to a previous known-good tag:

```
docker tag myorg/api:1.2.2-xyz9876 myorg/api:prod
docker push myorg/api:prod
```

Your deployment tooling then picks up the updated `prod` tag and redeploys, without rebuilding.

This is very similar to promoting artifacts through environments in Maven or artifact repositories, but with container images.

---

## 5. Registry access and auth basics

## Logging into registries

For private registries, you authenticate before pushing or pulling:

```
docker login my-registry.example.com
# prompts for username/password or token

```

In CI:

- Use access tokens or service accounts instead of personal credentials.
- Configure credentials as pipeline secrets and inject them into the build job.

## Image names in orchestrators

When you use Docker Compose, Swarm, or Kubernetes, you reference the same image names and tags:

- Compose:

```
services:
  api:
    image: my-registry.example.com/myorg/api:1.2.3-abc1234
```

- Kubernetes Deployment:

```
spec:
  template:
    spec:
      containers:
      - name: api
        image: my-registry.example.com/myorg/api:1.2.3-abc1234
```

The orchestrator:

- Authenticates against the registry (via imagePullSecrets or node IAM roles).
- Pulls the specified image tag onto the nodes.

So your **tagging strategy** directly affects:

- Reproducibility of deployments.
- How easy it is to roll back, audit, and debug.

---

## Practical checklist for registries & tagging

When designing your registry/tagging setup, aim for:

- **Consistent naming**: `registry/namespace/service:tag` with clear org/service mapping.
- **Versioned tags**: semantic versions plus build/Git SHA tags.
- **Minimal use of `latest`**: avoid it entirely in production manifests.
- **Promotion via tags, not rebuilds**: build once, promote the same artifact through dev → staging → prod.
- **Traceability**: every running container’s image tag lets you find the exact Git commit and build.
