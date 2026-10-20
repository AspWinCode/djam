#!/usr/bin/env node
// Full cross-organization isolation check for the trainer-notification feature,
// run against a DEDICATED, DISPOSABLE PostgreSQL (docker) — never the dev/prod DB.
//
// Spins up: ephemeral postgres -> prisma migrate deploy -> the real compiled API
// (apps/api/dist/main.js, same bootstrap as production) -> seeds two organizations
// with their own trainer, a real child participant under org A -> drives the whole
// flow through real HTTP routes (real auth, real guards, real controllers).
//
// Usage: node scripts/verify-cross-org-isolation.mjs

import { spawn, execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";

const CONTAINER_NAME = "djam-crossorg-isolation-test-pg";
const PG_PORT = 55432;
const API_PORT = 44099;
const TEST_DB_URL = `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/djam_crossorg_test?schema=public`;
const API_BASE = `http://127.0.0.1:${API_PORT}/api`;

let failures = 0;
function ok(label) { console.log(`OK   ${label}`); }
function fail(label, extra) { console.log(`FAIL ${label}${extra ? ` — ${extra}` : ""}`); failures += 1; }
function assertEq(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) ok(label);
  else fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function assertTrue(value, label) {
  if (value) ok(label);
  else fail(label);
}

function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: "pipe", encoding: "utf8", ...opts });
}

async function waitForPg() {
  for (let i = 0; i < 30; i += 1) {
    try {
      run(`docker exec ${CONTAINER_NAME} pg_isready -U postgres -d djam_crossorg_test`);
      return;
    } catch {
      await sleep(1000);
    }
  }
  throw new Error("Postgres did not become ready in time");
}

async function waitForApi() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`${API_BASE}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error("API did not become ready in time");
}

let apiProcess = null;

async function teardown() {
  if (apiProcess) {
    apiProcess.kill("SIGTERM");
    await sleep(500);
  }
  try { run(`docker rm -f ${CONTAINER_NAME}`); } catch { /* already gone */ }
}

async function main() {
  console.log("\n== Cross-organization isolation (dedicated, disposable PostgreSQL) ==\n");

  // --- 1. Ephemeral Postgres, isolated from dev/prod ---
  try { run(`docker rm -f ${CONTAINER_NAME}`); } catch { /* fine if it didn't exist */ }
  run(
    `docker run -d --name ${CONTAINER_NAME} -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=djam_crossorg_test -p ${PG_PORT}:5432 postgres:16`
  );
  await waitForPg();
  console.log(`     ephemeral Postgres up on port ${PG_PORT} (container ${CONTAINER_NAME})`);

  // --- 2. Apply the real migrations from scratch ---
  run(`npx prisma migrate deploy`, {
    cwd: "apps/api",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL }
  });
  console.log("     migrations applied cleanly to the fresh test database");

  // --- 3. Start the real compiled API against the test database ---
  apiProcess = spawn(process.execPath, ["dist/main.js"], {
    cwd: "apps/api",
    env: {
      ...process.env,
      DATABASE_URL: TEST_DB_URL,
      PORT: String(API_PORT),
      STORAGE_PROVIDER: "local",
      AUTH_ALLOW_MISSING_ORIGIN: "true",
      AUTH_ALLOWED_ORIGINS: `http://127.0.0.1:${API_PORT}`,
      NODE_ENV: "test"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  apiProcess.stdout.on("data", () => {});
  apiProcess.stderr.on("data", () => {});
  await waitForApi();
  console.log(`     real API (dist/main.js) up on port ${API_PORT} against the test database\n`);

  // --- 4. Seed two organizations, one trainer each, directly via Prisma (same
  //        pattern as prisma/seed.ts) — this is setup, not part of what's tested. ---
  const prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
  const { hashPassword } = await import("../apps/api/dist/common/password.js");

  const orgA = await prisma.organization.create({ data: { name: "Org A", slug: "cross-org-a", isActive: true } });
  const orgB = await prisma.organization.create({ data: { name: "Org B", slug: "cross-org-b", isActive: true } });

  const trainerA = await prisma.user.create({
    data: { email: "trainer-a@cross-org-test.local", displayName: "Trainer A", passwordHash: hashPassword("trainerA123!"), role: "trainer", isActive: true }
  });
  const trainerB = await prisma.user.create({
    data: { email: "trainer-b@cross-org-test.local", displayName: "Trainer B", passwordHash: hashPassword("trainerB123!"), role: "trainer", isActive: true }
  });
  await prisma.userOrganizationMembership.create({ data: { userId: trainerA.id, organizationId: orgA.id, role: "trainer", isActive: true } });
  await prisma.userOrganizationMembership.create({ data: { userId: trainerB.id, organizationId: orgB.id, role: "trainer", isActive: true } });

  const game = await prisma.game.create({
    data: {
      organizationId: orgA.id, slug: "isolation-test-game", title: "Isolation Test Game",
      shortDescription: "s", fullDescription: "f", themeCode: "cyber-it", level: "beginner",
      estimatedDurationMin: 30, accentStyle: "neon-grid", accentColor: "#8B5CF6",
      status: "published", publishedAt: new Date(), createdById: trainerA.id, updatedById: trainerA.id,
      finalTitle: "Done", finalDescription: "Done", finalRewardXp: 50
    }
  });
  const step = await prisma.gameStep.create({
    data: { gameId: game.id, title: "Step 1", description: "d", goalText: "g", orderIndex: 1, successTitle: "ok", successText: "ok", successXp: 10, isActive: true }
  });
  const version = await prisma.gameVersion.create({
    data: {
      gameId: game.id, versionNumber: 1, isPublishedVersion: true, createdBy: trainerA.id,
      snapshotJson: {
        game: { id: game.id, title: game.title, finalTitle: "Done", finalDescription: "Done", finalRewardXp: 50 },
        steps: [{ id: step.id, title: step.title, description: step.description, goalText: step.goalText, orderIndex: 1, successTitle: "ok", successText: "ok", successXp: 10, hints: [] }],
        finalScreen: { title: "Done", rewardXp: 50, description: "Done" }
      }
    }
  });
  const jam = await prisma.jam.create({
    data: { organizationId: orgA.id, title: "Isolation Test Jam", joinCode: "ISOTEST", joinUrl: "/join/ISOTEST", status: "active", startedAt: new Date(), createdBy: trainerA.id }
  });
  await prisma.jamGame.create({ data: { jamId: jam.id, gameVersionId: version.id, isDefault: true, orderIndex: 1 } });

  console.log("     seeded: org A + trainer A (owns the jam/game/participant below), org B + trainer B (unrelated)\n");

  // --- 5. A real child participant joins org A's jam and asks for help + a review,
  //        all through the real public HTTP API (not direct DB writes). ---
  async function json(res) { return { status: res.status, body: await res.json().catch(() => null) }; }

  const joinRes = await json(await fetch(`${API_BASE}/public/jams/ISOTEST/join`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName: "Isolation Test Child", avatar: "robot" })
  }));
  assertEq(joinRes.status, 201, "setup: real participant joins org A's jam");
  const participantId = joinRes.body.data.id;

  await fetch(`${API_BASE}/public/participants/${participantId}/select-game`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ gameVersionId: version.id })
  });
  const needHelp = await json(await fetch(`${API_BASE}/public/steps/${step.id}/need-help`, {
    method: "POST", headers: { "x-participant-id": participantId }
  }));
  assertEq(needHelp.status, 201, "setup: the participant requests help");

  async function login(email, password) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const setCookie = res.headers.get("set-cookie");
    if (!setCookie) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(await res.json().catch(() => null))}`);
    return setCookie.split(";")[0];
  }
  const cookieA = await login("trainer-a@cross-org-test.local", "trainerA123!");
  const cookieB = await login("trainer-b@cross-org-test.local", "trainerB123!");
  ok("setup: both trainers log in successfully");

  // --- 6. Org B's trainer must see nothing of org A's participant ---
  const bellB = await json(await fetch(`${API_BASE}/trainer/notifications`, { headers: { cookie: cookieB } }));
  assertEq(bellB.status, 200, "trainer B can read their own (empty) notification bell");
  assertTrue(
    Array.isArray(bellB.body.data) && !bellB.body.data.some((n) => n.participantId === participantId),
    "trainer B's bell does not contain org A's help request"
  );

  const detailAttempt = await fetch(`${API_BASE}/trainer/participants/${participantId}`, { headers: { cookie: cookieB } });
  assertEq(detailAttempt.status, 404, "trainer B cannot read org A's participant card");

  const resolveAttempt = await fetch(`${API_BASE}/trainer/participants/${participantId}/resolve-help`, { method: "POST", headers: { cookie: cookieB } });
  assertEq(resolveAttempt.status, 404, "trainer B cannot resolve org A's help request");

  const reviewAttempt = await fetch(`${API_BASE}/trainer/participants/${participantId}/mark-reviewed`, { method: "POST", headers: { cookie: cookieB } });
  assertEq(reviewAttempt.status, 404, "trainer B cannot mark-reviewed on org A's participant");

  // --- 7. Confirm none of trainer B's forbidden attempts mutated anything ---
  const stillPending = await prisma.participantStepProgress.findFirst({ where: { participantId, stepId: step.id } });
  assertTrue(!!stillPending?.needsHelpAt && !stillPending?.helpResolvedAt, "org A's help request is untouched after trainer B's forbidden attempts");

  // --- 8. Org A's own trainer CAN do everything that was just correctly refused ---
  const bellA = await json(await fetch(`${API_BASE}/trainer/notifications`, { headers: { cookie: cookieA } }));
  assertTrue(bellA.body.data.some((n) => n.participantId === participantId && n.kind === "help"), "trainer A's bell shows their own org's help request");

  const detailA = await fetch(`${API_BASE}/trainer/participants/${participantId}`, { headers: { cookie: cookieA } });
  assertEq(detailA.status, 200, "trainer A can read their own org's participant card");

  const resolveA = await fetch(`${API_BASE}/trainer/participants/${participantId}/resolve-help`, { method: "POST", headers: { cookie: cookieA } });
  assertEq(resolveA.status, 201, "trainer A can resolve their own org's help request");

  const afterResolve = await prisma.participantStepProgress.findFirst({ where: { participantId, stepId: step.id } });
  assertTrue(!!afterResolve?.helpResolvedAt, "the help request is actually resolved by trainer A's allowed action");

  await prisma.$disconnect();

  console.log(`\n${failures === 0 ? "All cross-org isolation checks passed." : `${failures} failing check(s).`}\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error("Cross-org isolation script crashed:", error);
    process.exitCode = 1;
  })
  .finally(teardown);
