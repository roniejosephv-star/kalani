import { randomUUID } from 'node:crypto';
import { AppError, event, iso, type FarmerState, type Improvement, type Playbook } from './domain.js';

function requireReviewer(reviewer: string) {
  if (typeof reviewer !== 'string' || !reviewer.trim() || reviewer.length > 200) throw new AppError('reviewer_required', 'A named reviewer is required.');
}

function matchingContext(state: FarmerState, playbook: Playbook) {
  return playbook.fieldId === state.fieldId && playbook.cycleId === state.cycleId && playbook.crop === state.facts.crop && Object.entries(playbook.prerequisites).every(([key, value]) => state.facts[key] === value);
}

function validEvidence(state: FarmerState, playbook: Playbook, now: number) {
  return playbook.evidenceIds.length > 0 && playbook.evidenceIds.every(id => {
    const evidence = state.evidence.find(item => item.id === id);
    if (!evidence || evidence.status !== 'current' || !evidence.validUntil || Date.parse(evidence.validUntil) <= now || !Number.isFinite(Date.parse(evidence.validUntil))) return false;
    const scope = evidence.scope;
    if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return false;
    return ['crop', 'district', 'state', 'season', 'latitude', 'longitude'].every(key => scope[key] === undefined || scope[key] === state.facts[key]);
  });
}

export function candidatePlaybook(state: FarmerState, taskId: string, now = Date.now()): Playbook {
  const task = state.tasks.find(item => item.id === taskId);
  const experiences = state.experiences.filter(item => item.taskId === taskId && item.origin === 'farmer_reported');
  if (!task || task.status !== 'completed' || !experiences.length) throw new AppError('reported_completion_required', 'A farmer-reported completed activity is required.');
  const existing = state.playbooks.find(item => item.sourceTaskId === taskId);
  if (existing) return existing;
  const context = task.fieldId === state.fieldId && task.cycleId === state.cycleId && task.contextVersion === state.version
    ? { facts: state.facts, version: state.version }
    : state.contexts[`${task.fieldId}/${task.cycleId}`];
  if (!context || context.version !== task.contextVersion || typeof context.facts.crop !== 'string' || !context.facts.crop.trim()) throw new AppError('missing_historical_context', 'Confirmed facts for this completed activity are unavailable.');
  const playbook: Playbook = {
    id: randomUUID(), version: 1, status: 'candidate', title: task.title, crop: context.facts.crop,
    fieldId: task.fieldId, cycleId: task.cycleId, prerequisites: { ...context.facts }, evidenceIds: [...task.evidenceIds], steps: [task.title],
    createdAt: iso(now), validUntil: task.validUntil, history: [{ version: 1, at: iso(now), note: 'Candidate from farmer-reported completion; not measured efficacy or agricultural causation.' }],
    origin: 'farmer_reported', experienceIds: experiences.map(item => item.id), sourceTaskId: taskId,
  };
  state.playbooks.push(playbook); event(state, 'playbook.candidate', playbook.id, now);
  return playbook;
}

export function reviewPlaybook(state: FarmerState, id: string, reviewer: string, now = Date.now()): Playbook {
  requireReviewer(reviewer);
  const playbook = state.playbooks.find(item => item.id === id);
  if (!playbook) throw new AppError('not_found', 'Playbook was not found.', 404);
  if (playbook.status === 'withdrawn') throw new AppError('withdrawn_playbook', 'Withdrawn playbooks require a new reviewed version.', 409);
  if (!matchingContext(state, playbook) || !validEvidence(state, playbook, now) || !Number.isFinite(Date.parse(playbook.validUntil)) || Date.parse(playbook.validUntil) <= now) throw new AppError('inapplicable_playbook', 'Current prerequisites and evidence must be verified before review.', 409);
  if (playbook.status === 'reviewed') return playbook;
  playbook.version++; playbook.status = 'reviewed'; playbook.reviewer = reviewer.trim();
  playbook.history.push({ version: playbook.version, at: iso(now), note: `Reviewed by ${reviewer.trim()} for the recorded prerequisites; reported outcomes remain unverified.` });
  event(state, 'playbook.reviewed', id, now); return playbook;
}

export function applicablePlaybooks(state: FarmerState, now = Date.now()): Playbook[] {
  return state.playbooks.filter(playbook => playbook.status === 'reviewed' && !!playbook.reviewer && matchingContext(state, playbook) && Date.parse(playbook.validUntil) > now && validEvidence(state, playbook, now));
}

export function proposeImprovements(state: FarmerState, now = Date.now()): Improvement[] {
  const groups: { category: Improvement['category']; types: string[]; minimum: number; proposal: string }[] = [
    { category: 'vocabulary', types: ['facts.corrected'], minimum: 1, proposal: 'Review confirmed corrections for local vocabulary and clarification improvements. Do not infer new farm facts or silently change recognition.' },
    { category: 'retrieval', types: ['source.failed', 'source.unavailable', 'source.unconfigured', 'source.provider_unavailable', 'source.not_configured'], minimum: 1, proposal: 'Review source access failures, freshness and retrieval coverage. Evaluate repaired retrieval against held-out farm scenarios.' },
    { category: 'routing', types: ['message.clarification', 'plan.clarification'], minimum: 2, proposal: 'Review repeated clarification for unnecessary questions and missing context. Preserve consequential fact confirmation and evaluate English and Tamil comprehension.' },
  ];
  const created: Improvement[] = [];
  for (const group of groups) {
    const signals = state.events.filter(item => group.types.includes(item.type));
    const eventIds = signals.map(item => item.sequence);
    if (signals.length < group.minimum || state.proposals.some(proposal => proposal.category === group.category && eventIds.every(id => proposal.evidenceEventIds.includes(id)))) continue;
    const proposal: Improvement = { id: randomUUID(), version: 1, category: group.category, proposal: group.proposal, status: 'proposed', baselineVersion: state.activeRelease, evidenceEventIds: eventIds, evaluations: [] };
    state.proposals.push(proposal); created.push(proposal); event(state, 'improvement.proposed', proposal.id, now);
  }
  return created;
}

const releaseSuites = ['held-out-farms', 'tamil-comprehension', 'english-comprehension'] as const;

export interface EvaluationInput {
  suite: typeof releaseSuites[number];
  suiteVersion: string;
  expectedCases: string[];
  results: { caseId: string; label: string; passed: boolean; heldOut: true }[];
  evaluator: string;
  report: string;
}

function proposalFor(state: FarmerState, id: string): Improvement {
  const proposal = state.proposals.find(item => item.id === id);
  if (!proposal) throw new AppError('not_found', 'Improvement proposal was not found.', 404);
  return proposal;
}

function validateEvaluation(input: EvaluationInput) {
  if (!input || !releaseSuites.includes(input.suite) || typeof input.suiteVersion !== 'string' || !input.suiteVersion.trim() || typeof input.report !== 'string' || !input.report.trim() || input.report.length > 4000 || !Array.isArray(input.expectedCases) || input.expectedCases.length === 0 || input.expectedCases.length > 1000 || input.expectedCases.some(id => typeof id !== 'string' || !id.trim()) || new Set(input.expectedCases).size !== input.expectedCases.length || !Array.isArray(input.results) || input.results.length !== input.expectedCases.length || new Set(input.results.map(result => result?.caseId)).size !== input.results.length || input.results.some(result => !result || !input.expectedCases.includes(result.caseId) || typeof result.label !== 'string' || !result.label.trim() || typeof result.passed !== 'boolean' || result.heldOut !== true)) throw new AppError('invalid_evaluation', 'Supply a versioned held-out suite with labelled outcomes for every declared case.');
  requireReviewer(input.evaluator);
}

export function evaluateProposal(state: FarmerState, id: string, input: EvaluationInput, now = Date.now()): Improvement {
  const proposal = proposalFor(state, id);
  if (proposal.status === 'released') throw new AppError('released_proposal', 'Released proposals are immutable. Create a new version.', 409);
  validateEvaluation(input);
  proposal.evaluations.push({ suite: input.suite, passed: input.results.every(result => result.passed), at: iso(now), report: JSON.stringify({ ...input, proposalVersion: proposal.version }) });
  proposal.evaluatedVersion = proposal.version;
  proposal.status = 'evaluated';
  event(state, 'improvement.evaluated', id, now); return proposal;
}

export function releaseProposal(state: FarmerState, id: string, reviewer: string, now = Date.now()): Improvement {
  requireReviewer(reviewer);
  const proposal = proposalFor(state, id);
  if (proposal.status !== 'evaluated' || proposal.evaluatedVersion !== proposal.version || proposal.baselineVersion !== state.activeRelease) throw new AppError('evaluation_required', 'Evaluate the current proposal against the current baseline before release.', 409);
  for (const suite of releaseSuites) {
    const evaluation = proposal.evaluations.findLast(item => item.suite === suite);
    let report: EvaluationInput & { proposalVersion: number };
    try {
      report = JSON.parse(evaluation?.report ?? 'null'); validateEvaluation(report);
    } catch { throw new AppError('evaluation_required', 'Held-out farm, English comprehension, and Tamil comprehension reports are required.', 409); }
    if (!evaluation?.passed || report.proposalVersion !== proposal.version || report.suite !== suite || !report.results.every(result => result.passed)) throw new AppError('evaluation_failed', 'All suites must pass on the exact proposal version.', 409);
  }
  (state.releaseHistory ??= []).push({ id: randomUUID(), proposalId: id, proposalVersion: proposal.version, previousRelease: state.activeRelease, reviewer: reviewer.trim(), at: iso(now), action: 'release' });
  state.activeRelease = `${id}@${proposal.version}`;
  proposal.status = 'released'; proposal.reviewer = reviewer.trim(); proposal.releasedAt = iso(now);
  event(state, 'improvement.release_approved', id, now); return proposal;
}

export function rollbackRelease(state: FarmerState, reviewer: string, now = Date.now()): string {
  requireReviewer(reviewer);
  const current = state.releaseHistory?.findLast(item => item.action === 'release' && `${item.proposalId}@${item.proposalVersion}` === state.activeRelease);
  if (!current) throw new AppError('no_release', 'No approved candidate release is available to roll back.', 409);
  state.releaseHistory!.push({ id: randomUUID(), proposalId: current.proposalId, proposalVersion: current.proposalVersion, previousRelease: state.activeRelease, reviewer: reviewer.trim(), at: iso(now), action: 'rollback' });
  state.activeRelease = current.previousRelease;
  event(state, 'improvement.rolled_back', current.proposalId, now); return state.activeRelease;
}
