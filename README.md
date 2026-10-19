# Game Game MVP

Monorepo for a mini-jam platform with three product surfaces:

- `apps/api`: NestJS backend with RBAC scaffolding, content management, session flow, and realtime events.
- `apps/web`: Next.js frontend for child, trainer, and admin experiences.
- `packages/shared`: shared domain types and API contracts.

## Run

1. Install dependencies in the workspace root:

```bash
npm install
```

2. Copy envs:

```bash
cp .env.example .env
```

For production-like S3 storage, you can also start from:

```bash
cp .env.s3.example .env
```

3. Start PostgreSQL.

If Docker is available:

```bash
docker compose up -d
```

If PostgreSQL is installed locally on Windows, point `DATABASE_URL` in `.env` to the local instance and skip Docker.

4. Generate Prisma client and run migrations:

```bash
npm --workspace @game-game/api run prisma:generate
npm --workspace @game-game/api run prisma:migrate
```

5. Seed local data into PostgreSQL:

```bash
npm --workspace @game-game/api run prisma:seed
```

6. Start the API:

```bash
npm run dev:api
```

7. Start the web app:

```bash
npm run dev:web
```

## MVP notes

- PostgreSQL via Prisma is the source of truth for content, sessions, participants, and progress.
- Domain rules, immutable version snapshots, RBAC guards, and realtime events are wired in the API layer.
- Frontend is structured around the three roles from the product specification.
- Admin and trainer routes use cookie-based sessions via `/api/auth/login`, `/api/auth/logout`, and `/api/auth/me`.
- Auth hardening supports env-driven cookie policy, session TTL, session caps, session revocation, and password change endpoints.
- Public progress actions are participant-scoped and driven by the join/select/progress flow.
- API seeds a published jam, session, trainer/admin users, and sample participants into PostgreSQL.
- Trainer live panel supports realtime updates and still keeps a fetch-based fallback path.
- Rate limiting is active on `auth/login`, public join, and child progress mutation endpoints.
- Audit logging persists auth, admin, trainer, and child mission actions in PostgreSQL.
- Request tracing and structured HTTP/error logging are active, with `x-request-id` returned on API responses.
- Admin user management now includes organizations, memberships, invite issuance, and invite acceptance endpoints.
- Tenant baseline is active: jams, sessions, and media assets are scoped by `organizationId` on the server side.

## Implemented slices

- Admin: jam CRUD skeleton, steps, hints, duplicate, archive, publish, versions.
- Trainer: sessions, attach published jam versions, participant overview, resolve help, review completed results.
- Child: join session, explicit jam chooser, mission map, real step/hint/help mutations, resume flow, and final state layout.
- Shared: domain entities, DTO contracts, realtime event shapes.
- Prisma: PostgreSQL schema, generated client setup, docker-compose and env template.
- Bootstrap: baseline Prisma migrations, local DB bootstrap script, smoke script, and `/api/health` endpoint.
- Auth: Prisma-backed `UserSession` model with cookie-session login for admin and trainer surfaces.
- Media: multipart upload pipeline with pluggable storage, supporting `local` and `s3` providers while persisting `MediaAsset` rows.
- Release: backup scripts and release-check script for repeatable pre-release verification.

## Current MVP boundaries

- Media storage now supports two modes:
  - `STORAGE_PROVIDER=local`: files are written into `uploads/`
  - `STORAGE_PROVIDER=s3`: files are uploaded to S3-compatible storage
- Realtime gateway is wired, but the web UI still retains fetch-based fallback instead of relying purely on live socket state.
- The platform now supports admin-managed users, organizations, and invites, but still relies on seeded bootstrap accounts for the initial local setup.
- Org switching UI is not implemented yet; current tenant scoping uses the active organization resolved from the authenticated user session.
- Observability, rate limiting, and production security hardening are still minimal.

## Persistence Status

- `Jam`, `JamStep`, `StepHint`, and `JamVersion` now run through Prisma repositories.
- `Session`, `SessionJam`, and `Participant` now also run through Prisma repositories.
- `ParticipantProgress` and `ParticipantStepProgress` now also run through Prisma repositories.
- Prisma seed now creates the sample jam, published version, active session, participants, and progress data in PostgreSQL.
- In-memory persistence is no longer used in the active API module graph.

## Local Bootstrap

For repeatable local setup on Windows PowerShell:

```powershell
.\scripts\bootstrap-local-db.ps1
```

Health check:

```bash
http://localhost:4000/api/health
```

Auth examples:

```bash
POST http://localhost:4000/api/auth/login
```

Body:

```json
{ "email": "trainer@example.com", "password": "trainer123" }
```

Seeded local accounts:

- `trainer@example.com / trainer123`
- `admin@example.com / admin123`

Additional auth endpoints:

- `GET /api/auth/sessions`
- `DELETE /api/auth/sessions/{id}`
- `POST /api/auth/logout-all`
- `POST /api/auth/change-password`

Origin policy note:

- `AUTH_ALLOWED_ORIGINS` must include the actual web origin used by the browser and release smoke.
- If the web app runs on a port or domain other than `http://localhost:3000`, update this env value before verification.

## Media Storage

Local development keeps working with:

```env
STORAGE_PROVIDER="local"
LOCAL_UPLOADS_DIR="uploads"
LOCAL_UPLOADS_PUBLIC_PREFIX="/uploads"
```

For S3-compatible storage use:

```env
STORAGE_PROVIDER="s3"
S3_ENDPOINT="http://localhost:9000"
S3_REGION="us-east-1"
S3_BUCKET="game-game-media"
S3_ACCESS_KEY_ID="minioadmin"
S3_SECRET_ACCESS_KEY="minioadmin"
S3_FORCE_PATH_STYLE="true"
S3_PUBLIC_BASE_URL="http://localhost:9000/game-game-media"
S3_CREATE_BUCKET_IF_MISSING="true"
```

Notes:

- `S3_ENDPOINT` can point to MinIO, Cloudflare R2, DigitalOcean Spaces, AWS S3, or another compatible provider.
- `S3_PUBLIC_BASE_URL` is recommended when public file URLs differ from the raw API endpoint format.
- `S3_CREATE_BUCKET_IF_MISSING=true` is useful for local MinIO-style environments; keep it `false` for managed production buckets.

Upload policy env:

```env
UPLOAD_MAX_BYTES="26214400"
UPLOAD_ALLOWED_IMAGE_MIME_TYPES="image/png,image/jpeg,image/webp,image/gif"
UPLOAD_ALLOWED_VIDEO_MIME_TYPES="video/mp4,video/webm"
UPLOAD_ALLOWED_FILE_MIME_TYPES="application/pdf,text/plain"
```

For local MinIO with Docker:

```bash
docker compose up -d minio minio-init
npm run bootstrap:storage
```

After that:

1. restart `npm run dev:api`
2. upload a file in admin media
3. run `npm run smoke:mvp`

## Smoke Check

With API and web already running, execute:

```powershell
npm run smoke:mvp
```

The script verifies:

- web reachability
- API health
- `x-request-id` presence on API responses
- admin login
- trainer login
- real media upload into the configured storage provider (`local` or `s3`)
- admin audit endpoint visibility
- child join/select/progress
- hint open
- help request and resolve
- mission completion
- trainer review flow

## Backups

PostgreSQL backup:

```powershell
npm run backup:db
```

PostgreSQL restore:

```powershell
npm run restore:db -- -BackupFile .\backups\postgres\game_game-YYYYMMDD-HHMMSS.dump
```

Media backup:

```powershell
npm run backup:media
```

Detailed runbook:

- [BACKUPS.md](C:\Users\direc\Downloads\game_game\docs\BACKUPS.md)

## Observability

- Every API response includes `x-request-id`.
- HTTP requests and unhandled errors are logged in structured JSON from the Nest API.
- Prisma warn/error events are logged.
- Set `LOG_FILE_PATH` to mirror structured logs into a local NDJSON file for collection.
- `GET /api/health/details` now includes:
  - `env`
  - `uptimeSec`
  - `counts.auditLogs`
  - `latestAuditAt`
- Admin landing page includes an audit log surface backed by `GET /api/admin/audit-logs`.

## Release Status

Current baseline:

- PostgreSQL + Prisma are the active source of truth
- cookie-session auth is active for trainer/admin surfaces with credential login
- child, trainer, and admin flows pass the smoke script end-to-end
- media upload works in both `local` and `s3` modes via env configuration

Remaining release work:

- configure real S3-compatible credentials in the target environment
- finish production auth/user management beyond seeded local accounts
- deepen monitoring and operational logging beyond the current rate limiting baseline
- keep polishing realtime UX until trainer pages rely less on fetch refreshes

Release checklist:

- [RELEASE_CHECKLIST.md](C:\Users\direc\Downloads\game_game\docs\RELEASE_CHECKLIST.md)

Deployment runbook:

- [DEPLOY.md](C:\Users\direc\Downloads\game_game\docs\DEPLOY.md)


## Trainer notification updates

- The bell is available throughout `/trainer`. It shows outstanding help requests and explicit result-review requests for the active organization.
- Requests are server-backed. Opening a notification navigates to the participant; the request is cleared by resolving help or marking the result reviewed, rather than by opening the bell.
- The bell refreshes every 10 seconds and on window focus; live-session events trigger an immediate refresh. It retains the last successful list during connection errors.
- `Показать тренеру` now saves `ParticipantProgress.reviewRequestedAt` and keeps the child on the result screen. Repeated submissions are idempotent. A pending review can still be opened after the child selects another game.
- Before deploying this change, apply the `20261019_trainer_review_requests` migration using `npx prisma migrate deploy` in `apps/api`, then regenerate the Prisma client/build the applications.
- Step hints are hidden from the student and trainer UI by default. Existing content and authoring tools are preserved. Set `NEXT_PUBLIC_ENABLE_STEP_HINTS=true` **at web build time** to restore the hint interface.
- Run `npm run test:notifications` for the notification regression suite (repository state tests and real Nest HTTP routes using in-memory Prisma test doubles). CI runs the same suite after the API build.
