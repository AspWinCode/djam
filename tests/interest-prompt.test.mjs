import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionRepository } from '../apps/api/dist/modules/services/session.repository.js';

function fixture() {
  const participant = { id: 'child', jamId: 'jam', displayName: 'Миша', avatar: 'robot', status: 'completed',
    joinedAt: new Date('2026-11-11T10:00:00Z'), lastSeenAt: new Date('2026-11-11T10:00:00Z'),
    interestPromptOpenedAt: null, interestResponse: null, interestRespondedAt: null };
  const prisma = {
    participant: {
      findUnique: async () => ({ ...participant }),
      update: async ({ data }) => Object.assign(participant, data)
    }
  };
  return { repo: new SessionRepository(prisma, {}), participant };
}

test('opening the prompt clears any earlier answer so the child can be re-asked', async () => {
  const { repo, participant } = fixture();
  participant.interestResponse = 'not_interested';
  participant.interestRespondedAt = new Date('2026-11-10T10:00:00Z');

  const opened = await repo.openInterestPrompt('child');
  assert.ok(opened.interestPromptOpenedAt);
  assert.equal(opened.interestResponse, undefined);
  assert.equal(opened.interestRespondedAt, undefined);
});

test('a child can only answer an open prompt, and only once', async () => {
  const { repo, participant } = fixture();

  // No prompt open yet: the answer is dropped, not recorded.
  const ignored = await repo.submitInterestResponse('child', 'continue_learning');
  assert.equal(ignored.interestResponse, undefined);

  await repo.openInterestPrompt('child');
  const first = await repo.submitInterestResponse('child', 'continue_learning');
  assert.equal(first.interestResponse, 'continue_learning');
  assert.ok(first.interestRespondedAt);

  // A slow double-tap (or a retry) must not flip an already-recorded answer.
  const second = await repo.submitInterestResponse('child', 'not_interested');
  assert.equal(second.interestResponse, 'continue_learning');
  assert.equal(second.interestRespondedAt, first.interestRespondedAt);
});
