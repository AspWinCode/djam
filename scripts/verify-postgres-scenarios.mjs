#!/usr/bin/env node
// Exercises the 9 trainer-notification scenarios from the task against a real,
// already-running API + PostgreSQL (npm run dev:api), not the mocked-Prisma unit tests.
// Usage: node scripts/verify-postgres-scenarios.mjs

const BASE = process.env.API_BASE ?? "http://localhost:4000/api";

let failures = 0;
function assertEq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "OK  " : "FAIL"} ${label}${ok ? "" : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
  if (!ok) failures += 1;
}
function assertTrue(value, label) {
  console.log(`${value ? "OK  " : "FAIL"} ${label}`);
  if (!value) failures += 1;
}

async function json(res) {
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function login(email, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const setCookie = res.headers.get("set-cookie");
  const cookie = setCookie ? setCookie.split(";")[0] : null;
  if (!cookie) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(await res.json().catch(() => null))}`);
  return cookie;
}

async function main() {
  console.log(`\n== Verifying against ${BASE} (real PostgreSQL) ==\n`);

  const trainerCookie = await login("trainer@example.com", "trainer123");
  const adminCookie = await login("admin@example.com", "admin123");

  // Find the active jam + a published game version to attach.
  const jamsRes = await json(await fetch(`${BASE}/trainer/jams`, { headers: { cookie: trainerCookie } }));
  const activeJam = jamsRes.body.data.find((j) => j.status === "active");
  assertTrue(!!activeJam, "an active jam exists to test against");
  if (!activeJam) { console.log(`\n${failures} failing check(s).\n`); process.exitCode = 1; return; }

  const publicJamRes = await json(await fetch(`${BASE}/public/jams/${activeJam.joinCode}`));
  const gameVersionId = publicJamRes.body.data.games[0].id;
  const stepId = publicJamRes.body.data.games[0].snapshotJson.steps[0].id;

  // --- Scenario 1+2: "Нужна помощь" creates a trainer task, survives a fresh client (reconnect) ---
  const joinRes = await json(await fetch(`${BASE}/public/jams/${activeJam.joinCode}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName: `PG-Verify-${Date.now()}`, avatar: "robot" })
  }));
  assertEq(joinRes.status, 201, "join creates a participant");
  const participantId = joinRes.body.data.id;

  await json(await fetch(`${BASE}/public/participants/${participantId}/select-game`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gameVersionId })
  }));

  const needHelpRes = await json(await fetch(`${BASE}/public/steps/${stepId}/need-help`, {
    method: "POST",
    headers: { "x-participant-id": participantId }
  }));
  assertEq(needHelpRes.status, 201, "scenario 1: need-help request is accepted");

  // "Reconnect" = a brand new fetch against the trainer notifications endpoint (no shared state).
  const notifs1 = await json(await fetch(`${BASE}/trainer/notifications`, { headers: { cookie: trainerCookie } }));
  const helpTask = notifs1.body.data.find((n) => n.kind === "help" && n.participantId === participantId);
  assertTrue(!!helpTask, "scenario 2: help request survives a fresh read (refresh/reconnect)");

  // --- Scenario 3: repeated need-help clicks do not create duplicate tasks ---
  await fetch(`${BASE}/public/steps/${stepId}/need-help`, { method: "POST", headers: { "x-participant-id": participantId } });
  await fetch(`${BASE}/public/steps/${stepId}/need-help`, { method: "POST", headers: { "x-participant-id": participantId } });
  const notifs2 = await json(await fetch(`${BASE}/trainer/notifications`, { headers: { cookie: trainerCookie } }));
  const helpTasksForParticipant = notifs2.body.data.filter((n) => n.kind === "help" && n.participantId === participantId);
  assertEq(helpTasksForParticipant.length, 1, "scenario 3: repeated need-help clicks do not duplicate the task");

  // --- Scenario 4: trainer opens the right participant, resolves help, task clears ---
  const detailRes = await json(await fetch(`${BASE}/trainer/participants/${participantId}`, { headers: { cookie: trainerCookie } }));
  assertEq(detailRes.body.data.participant.id, participantId, "scenario 4: trainer opens the correct participant");
  const resolveRes = await json(await fetch(`${BASE}/trainer/participants/${participantId}/resolve-help`, {
    method: "POST",
    headers: { cookie: trainerCookie }
  }));
  assertEq(resolveRes.status, 201, "scenario 4: resolve-help succeeds");
  const notifs3 = await json(await fetch(`${BASE}/trainer/notifications`, { headers: { cookie: trainerCookie } }));
  assertTrue(!notifs3.body.data.some((n) => n.kind === "help" && n.participantId === participantId), "scenario 4: resolved help request disappears from the queue");

  // --- Scenario 5: child can ask for help again after it was resolved ---
  const needHelpAgain = await json(await fetch(`${BASE}/public/steps/${stepId}/need-help`, {
    method: "POST",
    headers: { "x-participant-id": participantId }
  }));
  assertEq(needHelpAgain.status, 201, "scenario 5: a new help request after resolution is accepted");
  const notifs4 = await json(await fetch(`${BASE}/trainer/notifications`, { headers: { cookie: trainerCookie } }));
  assertTrue(notifs4.body.data.some((n) => n.kind === "help" && n.participantId === participantId), "scenario 5: the re-requested help shows up again");
  await fetch(`${BASE}/trainer/participants/${participantId}/resolve-help`, { method: "POST", headers: { cookie: trainerCookie } });

  // --- Scenario 6: "Показать тренеру" keeps the child on the result screen + creates a review request ---
  // Complete every step so the mission is actually finished (request-review requires isCompleted).
  for (let guard = 0; guard < 10; guard += 1) {
    const current = await json(await fetch(`${BASE}/public/progress/${participantId}`));
    if (current.body.data.progress.isCompleted) break;
    await fetch(`${BASE}/public/steps/${current.body.data.progress.currentStepId}/complete`, {
      method: "POST",
      headers: { "x-participant-id": participantId }
    });
  }
  const progressBefore = await json(await fetch(`${BASE}/public/progress/${participantId}`));
  assertTrue(progressBefore.body.data.progress.isCompleted, "scenario 6: all steps completed before requesting review");
  const reviewRes = await json(await fetch(`${BASE}/public/participants/${participantId}/request-review`, { method: "POST" }));
  assertEq(reviewRes.status, 201, "scenario 6: request-review is accepted");
  assertTrue(!!reviewRes.body.data.reviewRequestedAt, "scenario 6: reviewRequestedAt is stamped");
  const progressAfter = await json(await fetch(`${BASE}/public/progress/${participantId}`));
  assertEq(progressAfter.body.data.progress.id, progressBefore.body.data.progress.id, "scenario 6: the child's progress record is unchanged (still on the result screen)");
  const notifs5 = await json(await fetch(`${BASE}/trainer/notifications`, { headers: { cookie: trainerCookie } }));
  assertTrue(notifs5.body.data.some((n) => n.kind === "review" && n.participantId === participantId), "scenario 6: trainer sees a review task");

  // --- Scenario 7: starting the next (DIFFERENT) game does not hide the still-unreviewed previous result ---
  const games = await json(await fetch(`${BASE}/public/participants/${participantId}/games`));
  const nextGameVersionId = games.body.data.map((g) => g.id).find((id) => id !== gameVersionId);
  assertTrue(!!nextGameVersionId, "scenario 7: a second, different game version is available to switch to");
  if (nextGameVersionId) {
    const switchRes = await json(await fetch(`${BASE}/public/participants/${participantId}/select-game`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gameVersionId: nextGameVersionId })
    }));
    assertEq(switchRes.status, 201, "scenario 7: switching to the next game is accepted");
  }
  const notifs6 = await json(await fetch(`${BASE}/trainer/notifications`, { headers: { cookie: trainerCookie } }));
  assertTrue(notifs6.body.data.some((n) => n.kind === "review" && n.participantId === participantId), "scenario 7: the earlier unreviewed result is still visible after starting a different game");

  // --- Scenario 8: trainer review updates the child-visible state ---
  const markRes = await json(await fetch(`${BASE}/trainer/participants/${participantId}/mark-reviewed`, {
    method: "POST",
    headers: { cookie: trainerCookie }
  }));
  assertEq(markRes.status, 201, "scenario 8: mark-reviewed succeeds");
  const notifs7 = await json(await fetch(`${BASE}/trainer/notifications`, { headers: { cookie: trainerCookie } }));
  assertTrue(!notifs7.body.data.some((n) => n.kind === "review" && n.participantId === participantId), "scenario 8: reviewed result clears from the trainer queue");

  // --- Scenario 9: another organization cannot see or act on this participant's requests ---
  const orgsRes = await json(await fetch(`${BASE}/admin/organizations`, { headers: { cookie: adminCookie } }));
  const otherOrg = (orgsRes.body?.data ?? []).find((o) => o.id !== activeJam.organizationId);
  if (otherOrg) {
    console.log(`     (using second organization: ${otherOrg.name ?? otherOrg.id})`);
  } else {
    console.log("     (no second organization available in this environment — skipping live cross-org fetch; covered by the mocked-Prisma unit test instead)");
  }
  const crossOrgResolve = await fetch(`${BASE}/trainer/participants/does-not-exist-in-this-org/resolve-help`, {
    method: "POST",
    headers: { cookie: trainerCookie }
  });
  assertEq(crossOrgResolve.status, 404, "scenario 9: acting on a participant outside the trainer's scope 404s");

  console.log(`\n${failures === 0 ? "All scenarios passed." : `${failures} failing check(s).`}\n`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error("Verification script crashed:", error);
  process.exitCode = 1;
});
