import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProgressRepository } from '../apps/api/dist/modules/services/progress.repository.js';
import { TrainerController } from '../apps/api/dist/modules/controllers/trainer.controller.js';

const now = new Date('2026-10-19T12:00:00Z');
function fixture({ completed = false } = {}) {
  const progress = { id: 'progress', participantId: 'child', gameVersionId: 'version', currentStepId: 'step',
    completedStepsCount: completed ? 1 : 0, totalStepsCount: 1, xpTotal: 10, isCompleted: completed,
    startedAt: now, completedAt: completed ? now : null, reviewedAt: null, reviewRequestedAt: null };
  const step = { id: 'step-progress', participantId: 'child', gameVersionId: 'version', stepId: 'step',
    status: 'active', startedAt: now, completedAt: null, hintsOpenedCount: 0, lastHintLevelOpened: 0,
    needsHelpFlag: false, needsHelpAt: null, helpResolvedAt: null };
  const child = { id: 'child', displayName: 'Миша', jamId: 'jam', status: 'active', lastSeenAt: now,
    jam: { id: 'jam', title: 'Джем', organizationId: 'org' } };
  const prisma = {
    participantProgress: {
      findFirst: async () => ({ ...progress }),
      findUniqueOrThrow: async () => ({ ...progress }),
      updateMany: async ({ where, data }) => {
        const matches = Object.entries(where).every(([key, value]) => progress[key] === value);
        if (matches) Object.assign(progress, data);
        return { count: Number(matches) };
      },
      update: async ({ data }) => Object.assign(progress, data)
    },
    participantStepProgress: {
      findFirst: async () => ({ ...step }),
      update: async ({ data }) => Object.assign(step, data),
      updateMany: async ({ data }) => { Object.assign(step, data); return { count: 1 }; }
    },
    participant: {
      findFirst: async ({ where }) => where.id === child.id && where.jam.organizationId === child.jam.organizationId ? child : null,
      findUnique: async ({ where }) => where.id === child.id ? { id: child.id } : null,
      update: async ({ data }) => Object.assign(child, data),
      findMany: async ({ where, include }) => {
        assert.deepEqual(where.jam.status.in, ['active', 'completed']);
        if (where.jam.organizationId !== child.jam.organizationId) return [];
        return [{ ...child, progress: [{ ...progress, gameVersion: { snapshotJson: { steps: [{ id: 'step', title: 'Первый этап' }] } } }],
          stepProgress: step.needsHelpFlag ? [{ ...step }] : [] }];
      }
    }
  };
  prisma.$transaction = async callback => callback(prisma);
  return { repo: new ProgressRepository(prisma), prisma, progress, step, child };
}

test('help persists, survives a fresh repository and disappears only after resolve', async () => {
  const { repo, prisma, step } = fixture();
  assert.deepEqual(await repo.listTrainerNotifications('org'), []);
  await repo.requestHelp('child', 'step');
  const firstRequestAt = step.needsHelpAt;
  await repo.requestHelp('child', 'step');
  assert.equal(step.needsHelpAt, firstRequestAt, 'retry preserves request timestamp');
  const notifications = await new ProgressRepository(prisma).listTrainerNotifications('org');
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].kind, 'help');
  assert.equal(notifications[0].stepTitle, 'Первый этап');
  await repo.resolveHelp('child');
  assert.deepEqual(await repo.listTrainerNotifications('org'), []);
  await repo.requestHelp('child', 'step');
  assert.equal((await repo.listTrainerNotifications('org')).length, 1, 'help can be requested again after resolution');
});

test('request-review is idempotent and survives reload until reviewed', async () => {
  const { repo, prisma, progress } = fixture({ completed: true });
  assert.deepEqual(await repo.listTrainerNotifications('org'), [], 'completion alone does not send review notification');
  const requests = await Promise.all([repo.requestReview('child'), repo.requestReview('child')]);
  assert.equal(requests[0].reviewRequestedAt, requests[1].reviewRequestedAt);
  assert.equal((await new ProgressRepository(prisma).listTrainerNotifications('org')).length, 1);
  await repo.markReviewed('child');
  assert.ok(progress.reviewedAt);
  assert.deepEqual(await repo.listTrainerNotifications('org'), []);
  await repo.requestReview('child');
  assert.deepEqual(await repo.listTrainerNotifications('org'), [], 'retry cannot reopen a reviewed result');
});

test('unfinished or missing progress cannot request review', async () => {
  const { repo, prisma } = fixture();
  await assert.rejects(repo.requestReview('child'), error => error.getStatus() === 400);
  prisma.participantProgress.findFirst = async () => null;
  await assert.rejects(repo.requestReview('missing'), error => error.getStatus() === 404);
});

test('help only applies to the current unfinished step', async () => {
  const { repo, progress } = fixture();
  await assert.rejects(repo.requestHelp('child', 'different-step'), error => error.getStatus() === 400);
  progress.isCompleted = true;
  await assert.rejects(repo.requestHelp('child', 'step'), error => error.getStatus() === 400);
});

test('notifications and participant actions are isolated by organization', async () => {
  const { repo, prisma } = fixture({ completed: true });
  await repo.requestReview('child');
  assert.deepEqual(await repo.listTrainerNotifications('other-org'), []);
  const controller = new TrainerController({}, {}, prisma);
  const foreign = { user: { currentOrganizationId: 'other-org' } };
  for (const action of ['participant', 'resolveHelp', 'markReviewed']) {
    await assert.rejects(controller[action](foreign, 'child'), error => error.getStatus() === 404);
  }
});

test('marking reviewed without a progressId never picks a newer, unfinished game over a pending review', async () => {
  const now = new Date('2026-10-19T12:00:00Z');
  // Two attempts for the same participant: an older, completed one that still awaits review,
  // and a newer one the child started afterwards that is not finished yet. A trainer clicking
  // "mark reviewed" straight from the dashboard (no explicit progressId) must land on the old one.
  const oldCompleted = { id: 'progress-old', participantId: 'child', isCompleted: true,
    startedAt: new Date(now.getTime() - 60_000), completedAt: new Date(now.getTime() - 30_000),
    reviewRequestedAt: new Date(now.getTime() - 20_000), reviewedAt: null };
  const newUnfinished = { id: 'progress-new', participantId: 'child', isCompleted: false,
    startedAt: now, completedAt: null, reviewRequestedAt: null, reviewedAt: null };
  const rows = [oldCompleted, newUnfinished];
  const prisma = {
    participantProgress: {
      findFirst: async ({ where, orderBy }) => {
        const matches = rows.filter((row) =>
          Object.entries(where).every(([key, value]) => row[key] === value)
        );
        const sorted = [...matches].sort((a, b) => {
          const keys = Array.isArray(orderBy) ? orderBy : [orderBy];
          for (const key of keys) {
            const [field, dir] = Object.entries(key)[0];
            const diff = new Date(b[field] ?? 0) - new Date(a[field] ?? 0);
            if (diff !== 0) return dir === 'desc' ? diff : -diff;
          }
          return 0;
        });
        return sorted[0] ?? null;
      },
      update: async ({ where, data }) => {
        const row = rows.find((item) => item.id === where.id);
        Object.assign(row, data);
        return row;
      }
    }
  };
  const repo = new ProgressRepository(prisma);
  const updated = await repo.markReviewed('child');
  assert.equal(updated.id, 'progress-old', 'picks the completed, review-pending attempt, not the newer unfinished one');
  assert.ok(oldCompleted.reviewedAt, 'the old attempt is the one actually marked reviewed');
  assert.equal(newUnfinished.reviewedAt, null, 'the newer, unfinished attempt is left untouched');
});

test('a pending review remains visible after the child starts another game', async () => {
  const { repo, prisma, progress, child } = fixture({ completed: true });
  await repo.requestReview('child');
  const olderResult = { ...progress, gameVersion: { snapshotJson: { steps: [] } } };
  prisma.participant.findMany = async () => [{ ...child, stepProgress: [], progress: [
    { ...progress, id: 'new-progress', isCompleted: false, reviewRequestedAt: null, gameVersion: { snapshotJson: { steps: [] } } }, olderResult
  ] }];
  const tasks = await repo.listTrainerNotifications('org');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].progressId, olderResult.id);
});

async function buildTestApp() {
  const { Module } = await import('@nestjs/common');
  const { NestFactory, APP_GUARD } = await import('@nestjs/core');
  const { AppModule } = await import('../apps/api/dist/modules/app.module.js');
  const { AppThrottlerGuard } = await import('../apps/api/dist/common/app-throttler.guard.js');
  const { PublicController } = await import('../apps/api/dist/modules/controllers/public.controller.js');
  const { AuthController } = await import('../apps/api/dist/modules/controllers/auth.controller.js');
  const { AppService } = await import('../apps/api/dist/modules/services/app.service.js');
  const { AuthService } = await import('../apps/api/dist/modules/services/auth.service.js');
  const { AuditLogService } = await import('../apps/api/dist/modules/services/audit-log.service.js');
  const { PrismaService } = await import('../apps/api/dist/prisma/prisma.service.js');
  const { RolesGuard } = await import('../apps/api/dist/common/roles.guard.js');
  const { UnauthorizedException } = await import('@nestjs/common');
  const { repo, prisma } = fixture({ completed: true });
  // A second real participant, so tests can prove distinct real identities behind one IP
  // get independent buckets, and that neither can be used to bypass pre-auth (login) limits.
  prisma.participant.findUnique = async ({ where }) => (['child', 'sibling'].includes(where.id) ? { id: where.id } : null);
  const auth = {
    getSessionByToken: async token => ({ user: { id: 'trainer', role: 'trainer', currentOrganizationId: token === 'foreign' ? 'other-org' : 'org' } }),
    touchSession: async () => {},
    // Simulates a wrong-password attempt every time, so repeated calls exercise the login limiter.
    createSession: async () => { throw new UnauthorizedException('Invalid credentials'); }
  };
  const appService = {
    requestReview: id => repo.requestReview(id),
    listTrainerNotifications: org => repo.listTrainerNotifications(org),
    markParticipantReviewed: id => repo.markReviewed(id)
  };
  class TestModule {}
  // Use the actual application limiter configuration rather than duplicating it.
  const throttler = Reflect.getMetadata('imports', AppModule).find(item => item.module?.name === 'ThrottlerModule');
  Module({ imports: [throttler], controllers: [PublicController, TrainerController, AuthController], providers: [
    { provide: AppService, useValue: appService }, { provide: AuthService, useValue: auth },
    { provide: AuditLogService, useValue: { log: async () => {}, actorFromRequest: () => ({}) } },
    { provide: PrismaService, useValue: prisma }, { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard }
  ] })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  return { app, base: await app.getUrl(), repo, prisma };
}

test('real HTTP routes require trainer auth and keep repeated notification reads available', async () => {
  const { app, base } = await buildTestApp();
  try {
    assert.equal((await fetch(`${base}/api/trainer/notifications`)).status, 401);
    const sent = await fetch(`${base}/api/public/participants/child/request-review`, { method: 'POST' });
    assert.equal(sent.status, 201);
    const confirmed = (await sent.json()).data;
    assert.ok(confirmed.reviewRequestedAt);
    for (let index = 0; index < 15; index++) {
      const response = await fetch(`${base}/api/trainer/notifications`, { headers: { cookie: 'gg_session=trainer' } });
      assert.equal(response.status, 200, 'reading notifications must not use join/login limits');
      assert.equal((await response.json()).data.length, 1);
    }
    const foreign = await fetch(`${base}/api/trainer/participants/child/mark-reviewed`, { method: 'POST', headers: { cookie: 'gg_session=foreign' } });
    assert.equal(foreign.status, 404);
    const own = await fetch(`${base}/api/trainer/participants/child/mark-reviewed`, { method: 'POST', headers: { cookie: 'gg_session=trainer' } });
    assert.equal(own.status, 201);
    const after = await fetch(`${base}/api/trainer/notifications`, { headers: { cookie: 'gg_session=trainer' } });
    assert.deepEqual((await after.json()).data, []);
  } finally { await app.close(); }
});

test('login brute-force limiter ignores x-participant-id entirely, real or fake', async () => {
  const { app, base } = await buildTestApp();
  try {
    // /auth/login is not @ParticipantScoped(), so AppThrottlerGuard must fall back to IP
    // tracking regardless of what x-participant-id claims — a made-up id, or (the easy-to-miss
    // case) a genuinely real participant id that has nothing to do with authentication. Both
    // used to mint a fresh limiter bucket per request and fully dodge the brute-force limit.
    const attempt = (participantHeader) =>
      fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(participantHeader ? { 'x-participant-id': participantHeader } : {})
        },
        body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong' })
      });

    // First 6 attempts (the configured limit) are rejected on credentials, not on rate —
    // each one claiming a DIFFERENT REAL existing participant id (child, then sibling,
    // alternating). If the header were honored here, these two real identities would each
    // get their own 6-request budget and never trip the limiter.
    const realIds = ['child', 'sibling'];
    for (let index = 0; index < 6; index += 1) {
      const response = await attempt(realIds[index % realIds.length]);
      assert.equal(response.status, 401, `attempt ${index} (real id "${realIds[index % realIds.length]}") should fail on bad credentials, not be pre-emptively throttled`);
    }

    // The 7th attempt, still claiming a real participant id, must be throttled — proves real
    // ids are not honored on this route at all, closing the exact bypass that was reported.
    const throttledRealId = await attempt('child');
    assert.equal(throttledRealId.status, 429, 'a real participant id must not reset or bypass the login limiter');
    assert.ok(Number(throttledRealId.headers.get('Retry-After')) > 0, '429 carries a usable Retry-After');

    // Reset with a fresh app/IP-equivalent bucket to also confirm the made-up-id case in isolation.
    await app.close();
  } finally {
    // no-op: app already closed above
  }

  const second = await buildTestApp();
  try {
    const attempt = (participantHeader) =>
      fetch(`${second.base}/api/auth/login`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(participantHeader ? { 'x-participant-id': participantHeader } : {})
        },
        body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong' })
      });

    for (let index = 0; index < 6; index += 1) {
      const response = await attempt(`spoofed-${index}-${Math.random()}`);
      assert.equal(response.status, 401, `attempt ${index} (made-up id) should fail on bad credentials, not be pre-emptively throttled`);
    }
    const throttledFake = await attempt(`spoofed-final-${Math.random()}`);
    assert.equal(throttledFake.status, 429, 'a made-up participant id must not reset the login limiter');

    const throttledNoHeader = await attempt(undefined);
    assert.equal(throttledNoHeader.status, 429, 'plain IP tracking (no header at all) remains throttled too');
  } finally { await second.app.close(); }
});

test('different participants behind one IP get independent limits on their own participant-scoped actions', async () => {
  const { app, base } = await buildTestApp();
  try {
    // request-review is @ParticipantScoped() and limited to 40/60s. Exhausting participant
    // "child"'s own budget must not affect "sibling" — they're different real identities,
    // same simulated IP (both requests come from this same test process/socket).
    const forChild = () => fetch(`${base}/api/public/participants/child/request-review`, {
      method: 'POST', headers: { 'x-participant-id': 'child' }
    });
    const first = await forChild();
    assert.equal(first.status, 201);
    // Re-requesting an already-requested review is still accepted (idempotent), so we can
    // cheaply burn through child's budget without needing 40 distinct completed progresses.
    let childThrottled = false;
    for (let index = 0; index < 45 && !childThrottled; index += 1) {
      const response = await forChild();
      if (response.status === 429) childThrottled = true;
    }
    assert.ok(childThrottled, 'child\'s own budget does get exhausted (sanity check on the test itself)');

    const forSibling = await fetch(`${base}/api/public/participants/sibling/request-review`, {
      method: 'POST', headers: { 'x-participant-id': 'sibling' }
    });
    // sibling has no progress in this fixture, so the real app logic 400s/404s on it — the
    // point is it must NOT be 429. A 429 here would mean sibling shared child's bucket.
    assert.notEqual(forSibling.status, 429, "sibling must not inherit child's exhausted bucket");
  } finally { await app.close(); }
});

test('AppThrottlerGuard only trusts x-participant-id on @ParticipantScoped() routes, and only for real ids', async () => {
  const { AppThrottlerGuard } = await import('../apps/api/dist/common/app-throttler.guard.js');
  const { Reflector } = await import('@nestjs/core');
  const { PublicController } = await import('../apps/api/dist/modules/controllers/public.controller.js');
  const { AuthController } = await import('../apps/api/dist/modules/controllers/auth.controller.js');
  const { prisma } = fixture();
  prisma.participant.findUnique = async ({ where }) => (['child', 'sibling'].includes(where.id) ? { id: where.id } : null);
  const authStub = { getSessionByToken: async () => null };
  const guard = new AppThrottlerGuard({}, {}, new Reflector(), authStub, prisma);

  const scopedContext = { getHandler: () => PublicController.prototype.requestReview, getClass: () => PublicController };
  const unscopedContext = { getHandler: () => AuthController.prototype.login, getClass: () => AuthController };
  const sameIp = { ip: '10.0.0.5' };

  const trackerForChild = await guard.getTracker({ ...sameIp, headers: { 'x-participant-id': 'child' } }, scopedContext);
  assert.equal(trackerForChild, 'participant:child', 'a real participant id is trusted on a @ParticipantScoped() route');

  // A second, equally real participant behind the SAME classroom IP must get its own bucket.
  const trackerForSibling = await guard.getTracker({ ...sameIp, headers: { 'x-participant-id': 'sibling' } }, scopedContext);
  assert.equal(trackerForSibling, 'participant:sibling');
  assert.notEqual(trackerForChild, trackerForSibling, 'two real participants behind one IP must not share a limiter bucket');

  // An id nobody issued (spoofed) must NOT be trusted as an identity — falls back to IP.
  const trackerForGhost = await guard.getTracker({ ...sameIp, headers: { 'x-participant-id': 'ghost-does-not-exist' } }, scopedContext);
  assert.equal(trackerForGhost, '10.0.0.5', 'an unknown participant id must fall back to IP tracking, not grant a fresh bucket');

  // No header and no cookie: plain IP fallback, used for login/join before any identity exists.
  const trackerPreAuth = await guard.getTracker({ ...sameIp, headers: {} }, scopedContext);
  assert.equal(trackerPreAuth, '10.0.0.5');

  // The critical case: on a route NOT marked @ParticipantScoped() (e.g. login), even a
  // genuinely real participant id must be ignored entirely — falls straight to IP.
  const trackerOnLoginWithRealId = await guard.getTracker({ ...sameIp, headers: { 'x-participant-id': 'child' } }, unscopedContext);
  assert.equal(trackerOnLoginWithRealId, '10.0.0.5', 'a real participant id must be ignored on a non-participant-scoped route like login');

  // And with no context at all (defensive default for any caller that forgets to pass one).
  const trackerNoContext = await guard.getTracker({ ...sameIp, headers: { 'x-participant-id': 'child' } });
  assert.equal(trackerNoContext, '10.0.0.5', 'without route context, the header is never trusted — safe default');
});
