import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProgressRepository } from '../apps/api/dist/modules/services/progress.repository.js';

const now = new Date('2026-11-02T12:00:00Z');

// Two required steps followed by two bonus steps.
function fixture({ bonus = true } = {}) {
  const steps = [
    { id: 's1', title: 'Первый', successXp: 20 },
    { id: 's2', title: 'Второй', successXp: 20 },
    ...(bonus ? [{ id: 'b1', title: 'Бонус 1', successXp: 10, isBonus: true }, { id: 'b2', title: 'Бонус 2', successXp: 10, isBonus: true }] : [])
  ];
  const required = steps.filter(step => !step.isBonus).length;
  const progress = { id: 'progress', participantId: 'child', gameVersionId: 'version', currentStepId: 's1',
    completedStepsCount: 0, totalStepsCount: required, xpTotal: 0, isCompleted: false,
    startedAt: now, completedAt: null, reviewedAt: null, reviewRequestedAt: null };
  const stepRows = steps.map((step, index) => ({ id: `row-${step.id}`, participantId: 'child', gameVersionId: 'version', stepId: step.id,
    status: index === 0 ? 'active' : 'locked', startedAt: index === 0 ? now : null, completedAt: null, hintsOpenedCount: 0,
    lastHintLevelOpened: 0, needsHelpFlag: false, needsHelpAt: null, helpResolvedAt: null }));
  const child = { id: 'child', displayName: 'Миша', jamId: 'jam', status: 'active', lastSeenAt: now };
  const prisma = {
    gameVersion: { findUnique: async () => ({ id: 'version', snapshotJson: { steps } }) },
    participantProgress: {
      findFirst: async () => ({ ...progress }),
      update: async ({ data }) => Object.assign(progress, data)
    },
    participantStepProgress: {
      findFirst: async ({ where }) => ({ ...stepRows.find(row => row.stepId === where.stepId) }),
      update: async ({ where, data }) => Object.assign(stepRows.find(row => row.id === where.id), data),
      updateMany: async ({ where, data }) => {
        const matches = stepRows.filter(row => row.stepId === where.stepId);
        matches.forEach(row => Object.assign(row, data));
        return { count: matches.length };
      }
    },
    participant: { update: async ({ data }) => Object.assign(child, data) }
  };
  prisma.$transaction = async callback => callback(prisma);
  return { repo: new ProgressRepository(prisma), progress, stepRows, child };
}

test('finishing the last required step completes the game and unlocks the first bonus step', async () => {
  const { repo, progress, stepRows, child } = fixture();
  assert.equal(progress.totalStepsCount, 2, 'bonus steps are not part of the required total');

  const first = await repo.completeStep('child', 's1');
  assert.equal(first.finishedRequired, false);
  assert.equal(first.progress.isCompleted, false);

  const second = await repo.completeStep('child', 's2');
  assert.equal(second.finishedRequired, true);
  assert.equal(second.progress.isCompleted, true);
  assert.equal(second.progress.completedStepsCount, 2);
  assert.equal(second.progress.currentStepId, 'b1');
  assert.equal(stepRows.find(row => row.stepId === 'b1').status, 'active');
  assert.equal(child.status, 'completed');
  assert.ok(progress.completedAt);
});

test('bonus steps add XP but never reopen the game or change the required counters', async () => {
  const { repo, progress, stepRows } = fixture();
  await repo.completeStep('child', 's1');
  await repo.completeStep('child', 's2');
  const completedAt = progress.completedAt;
  const reviewedAt = new Date('2026-11-02T12:30:00Z');
  progress.reviewedAt = reviewedAt;

  const bonus = await repo.completeStep('child', 'b1');
  assert.equal(bonus.finishedRequired, false, 'bonus steps do not re-trigger the completed event');
  assert.equal(bonus.progress.isCompleted, true);
  assert.equal(bonus.progress.completedStepsCount, 2);
  assert.equal(bonus.progress.xpTotal, 50);
  assert.equal(bonus.progress.currentStepId, 'b2');
  assert.equal(progress.completedAt, completedAt);
  assert.equal(progress.reviewedAt, reviewedAt, 'an earlier review is kept');
  assert.equal(stepRows.find(row => row.stepId === 'b2').status, 'active');

  const last = await repo.completeStep('child', 'b2');
  assert.equal(last.progress.xpTotal, 60);
  assert.equal(last.progress.currentStepId, 'b2');
  await assert.rejects(() => repo.completeStep('child', 'b2'), /already completed/);
  assert.equal(progress.xpTotal, 60, 'a finished step cannot be farmed for XP');
});

test('games without bonus steps behave as before', async () => {
  const { repo } = fixture({ bonus: false });
  await repo.completeStep('child', 's1');
  const done = await repo.completeStep('child', 's2');
  assert.equal(done.finishedRequired, true);
  assert.equal(done.progress.isCompleted, true);
  assert.equal(done.progress.currentStepId, 's2');
});

test('help can be requested on an active bonus step but not on a finished game step', async () => {
  const { repo, stepRows, child } = fixture();
  await repo.completeStep('child', 's1');
  await repo.completeStep('child', 's2');
  await repo.requestHelp('child', 'b1');
  assert.equal(stepRows.find(row => row.stepId === 'b1').needsHelpFlag, true);
  assert.equal(child.status, 'needs_help');
  await assert.rejects(() => repo.requestHelp('child', 's2'), /текущем этапе/);
});
