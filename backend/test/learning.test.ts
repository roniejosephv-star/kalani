import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyFarmer, event, type FarmerState } from '../src/domain.js';
import { applicablePlaybooks, candidatePlaybook, evaluateProposal, proposeImprovements, releaseProposal, reviewPlaybook, rollbackRelease, type EvaluationInput } from '../src/learning.js';

const now = Date.parse('2026-11-17T08:00:00Z');
function completedFarm(): FarmerState {
  const state = emptyFarmer(); state.owner = 'farmer-a'; state.version = 1; state.facts = { crop: 'paddy', district: 'Thanjavur', irrigation: 'canal' };
  state.evidence = [{ id: 'source-1', source: 'TNAU', url: 'https://agritech.tnau.ac.in/', retrievedAt: '2026-11-17T07:00:00Z', validUntil: '2026-11-19T08:00:00Z', status: 'current', scope: { crop: 'paddy', district: 'Thanjavur' } }];
  state.tasks = [{ id: 'task-1', version: 1, contextVersion: 1, fieldId: state.fieldId, cycleId: state.cycleId, title: 'Fixture activity only', reason: 'Fixture evidence', dueAt: '2026-11-17T09:00:00Z', validUntil: '2026-11-18T08:00:00Z', status: 'completed', evidenceIds: ['source-1'], uncertainty: [] }];
  state.experiences = [{ id: 'experience-1', taskId: 'task-1', at: '2026-11-17T07:50:00Z', origin: 'farmer_reported', text: 'I did this', fieldId: state.fieldId, cycleId: state.cycleId }];
  return state;
}

test('completed activities produce private candidates, never measured outcomes or automatic reuse', () => {
  const state = completedFarm();
  const playbook = candidatePlaybook(state, 'task-1', now);
  assert.equal(playbook.status, 'candidate');
  assert.equal(playbook.origin, 'farmer_reported');
  assert.deepEqual(playbook.experienceIds, ['experience-1']);
  assert.deepEqual(applicablePlaybooks(state, now), []);
  assert.equal(candidatePlaybook(state, 'task-1', now).id, playbook.id);
  assert.equal(state.playbooks.length, 1);
  assert.equal(state.experiences[0].origin, 'farmer_reported');
});

test('review requires evidence and context; reuse rechecks expiry and corrected facts', () => {
  const state = completedFarm(); const playbook = candidatePlaybook(state, 'task-1', now);
  assert.throws(() => reviewPlaybook(state, playbook.id, '', now), { code: 'reviewer_required' });
  reviewPlaybook(state, playbook.id, 'Agricultural reviewer', now);
  assert.equal(playbook.version, 2);
  assert.equal(applicablePlaybooks(state, now).length, 1);
  state.facts.irrigation = 'rainfed'; assert.deepEqual(applicablePlaybooks(state, now), []);
  state.facts.irrigation = 'canal'; state.cycleId = 'next-season'; assert.deepEqual(applicablePlaybooks(state, now), []);
  state.cycleId = playbook.cycleId; assert.deepEqual(applicablePlaybooks(state, Date.parse('2026-11-20')), []);
  state.evidence = []; assert.deepEqual(applicablePlaybooks(state, now), []);
});

test('missing evidence, wrong crop and missing historical context block promotion', () => {
  const state = completedFarm(); const playbook = candidatePlaybook(state, 'task-1', now);
  state.evidence[0].scope = { crop: 'cotton' };
  assert.throws(() => reviewPlaybook(state, playbook.id, 'Reviewer', now), { code: 'inapplicable_playbook' });
  state.evidence = []; assert.throws(() => reviewPlaybook(state, playbook.id, 'Reviewer', now), { code: 'inapplicable_playbook' });
  const changed = completedFarm(); changed.version++;
  assert.throws(() => candidatePlaybook(changed, 'task-1', now), { code: 'missing_historical_context' });
  const unreported = completedFarm(); unreported.experiences = [];
  assert.throws(() => candidatePlaybook(unreported, 'task-1', now), { code: 'reported_completion_required' });
});

test('improvement proposals cite observed events and never auto-activate', () => {
  const state = emptyFarmer();
  assert.deepEqual(proposeImprovements(state, now), []);
  event(state, 'facts.corrected', undefined, now); event(state, 'source.failed', undefined, now); event(state, 'plan.clarification', undefined, now);
  assert.equal(proposeImprovements(state, now).length, 2);
  assert.equal(state.activeRelease, 'farm-v1');
  assert.deepEqual(proposeImprovements(state, now), []);
  event(state, 'plan.clarification', undefined, now);
  assert.equal(proposeImprovements(state, now)[0].category, 'routing');
  assert.deepEqual(state.proposals[0].evidenceEventIds, [1]);
});

function evaluation(suite: EvaluationInput['suite'], passed = true): EvaluationInput {
  return { suite, suiteVersion: 'suite-v1', expectedCases: ['case-a', 'case-b'], results: [{ caseId: 'case-a', label: 'Explicit held-out fixture A', passed: true, heldOut: true }, { caseId: 'case-b', label: 'Explicit held-out fixture B', passed, heldOut: true }], evaluator: 'Test evaluator', report: 'Fixture report; not native-speaker field validation.' };
}
function proposalState() {
  const state = emptyFarmer(); event(state, 'facts.corrected', undefined, now);
  const proposal = proposeImprovements(state, now)[0];
  return { state, proposal };
}

test('incomplete held-out outcomes, missing Tamil suite and failed outcomes cannot release', () => {
  const { state, proposal } = proposalState();
  const missing = evaluation('held-out-farms'); missing.results.pop();
  assert.throws(() => evaluateProposal(state, proposal.id, missing, now), { code: 'invalid_evaluation' });
  const inSample = evaluation('held-out-farms'); (inSample.results[0] as { heldOut: boolean }).heldOut = false;
  assert.throws(() => evaluateProposal(state, proposal.id, inSample, now), { code: 'invalid_evaluation' });
  evaluateProposal(state, proposal.id, evaluation('held-out-farms'), now);
  assert.throws(() => releaseProposal(state, proposal.id, 'Reviewer', now), { code: 'evaluation_required' });
  evaluateProposal(state, proposal.id, evaluation('tamil-comprehension', false), now);
  assert.throws(() => releaseProposal(state, proposal.id, 'Reviewer', now), { code: 'evaluation_failed' });
  assert.equal(state.activeRelease, 'farm-v1');
});

test('reviewed candidate releases preserve rollback history without changing production config', () => {
  const { state, proposal } = proposalState();
  evaluateProposal(state, proposal.id, evaluation('held-out-farms'), now);
  evaluateProposal(state, proposal.id, evaluation('tamil-comprehension'), now);
  assert.throws(() => releaseProposal(state, proposal.id, '', now), { code: 'reviewer_required' });
  releaseProposal(state, proposal.id, 'Named reviewer', now);
  assert.equal(state.activeRelease, `${proposal.id}@1`);
  assert.equal(state.releaseHistory![0].previousRelease, 'farm-v1');
  assert.equal(rollbackRelease(state, 'Named reviewer', now), 'farm-v1');
  assert.equal(state.releaseHistory!.length, 2);
  assert.equal(state.releaseHistory![1].action, 'rollback');
  assert.equal(state.proposals[0].status, 'released');
  assert.throws(() => rollbackRelease(state, 'Named reviewer', now), { code: 'no_release' });
});

test('editing proposal version or changing baseline invalidates old evaluations', () => {
  const { state, proposal } = proposalState();
  evaluateProposal(state, proposal.id, evaluation('held-out-farms'), now);
  evaluateProposal(state, proposal.id, evaluation('tamil-comprehension'), now);
  proposal.version++;
  assert.throws(() => releaseProposal(state, proposal.id, 'Reviewer', now), { code: 'evaluation_required' });
  evaluateProposal(state, proposal.id, evaluation('held-out-farms'), now);
  assert.throws(() => releaseProposal(state, proposal.id, 'Reviewer', now), { code: 'evaluation_failed' });
  evaluateProposal(state, proposal.id, evaluation('tamil-comprehension'), now);
  state.activeRelease = 'changed-baseline';
  assert.throws(() => releaseProposal(state, proposal.id, 'Reviewer', now), { code: 'evaluation_required' });
});
