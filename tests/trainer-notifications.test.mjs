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

test('real HTTP routes require trainer auth and keep repeated notification reads available', async () => {
  const { Module } = await import('@nestjs/common');
  const { NestFactory, APP_GUARD } = await import('@nestjs/core');
  const { ThrottlerGuard } = await import('@nestjs/throttler');
  const { AppModule } = await import('../apps/api/dist/modules/app.module.js');
  const { PublicController } = await import('../apps/api/dist/modules/controllers/public.controller.js');
  const { AppService } = await import('../apps/api/dist/modules/services/app.service.js');
  const { AuthService } = await import('../apps/api/dist/modules/services/auth.service.js');
  const { AuditLogService } = await import('../apps/api/dist/modules/services/audit-log.service.js');
  const { PrismaService } = await import('../apps/api/dist/prisma/prisma.service.js');
  const { RolesGuard } = await import('../apps/api/dist/common/roles.guard.js');
  const { repo, prisma } = fixture({ completed: true });
  const auth = {
    getSessionByToken: async token => ({ user: { id: 'trainer', role: 'trainer', currentOrganizationId: token === 'foreign' ? 'other-org' : 'org' } }),
    touchSession: async () => {}
  };
  const appService = {
    requestReview: id => repo.requestReview(id),
    listTrainerNotifications: org => repo.listTrainerNotifications(org),
    markParticipantReviewed: id => repo.markReviewed(id)
  };
  class TestModule {}
  // Use the actual application limiter configuration rather than duplicating it.
  const throttler = Reflect.getMetadata('imports', AppModule).find(item => item.module?.name === 'ThrottlerModule');
  Module({ imports: [throttler], controllers: [PublicController, TrainerController], providers: [
    { provide: AppService, useValue: appService }, { provide: AuthService, useValue: auth },
    { provide: AuditLogService, useValue: { log: async () => {}, actorFromRequest: () => ({}) } },
    { provide: PrismaService, useValue: prisma }, { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard }
  ] })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
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
