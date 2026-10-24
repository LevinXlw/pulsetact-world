// Shared by the browser and room server so a solved lesson uses the same physics.
export const initialOpticsState = Object.freeze({ stage: 0, mirrorA: -15, mirrorB: 15, prediction: null });
export const opticsBoard = Object.freeze({ width: 640, height: 380, source: { x: 58, y: 278 }, mirrorA: { x: 270, y: 278 }, mirrorB: { x: 270, y: 108 }, mirrorHalfLength: 39, receiverRadius: 13 });

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const angle = (value, fallback) => finite(value) ? Math.round(Math.max(-80, Math.min(80, value)) * 2) / 2 : fallback;
const predictions = ['equal', 'double', 'half'];
const cross = (a, b) => a.x * b.y - a.y * b.x;
const dot = (a, b) => a.x * b.x + a.y * b.y;
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b, scale = 1) => ({ x: a.x + b.x * scale, y: a.y + b.y * scale });
const tangent = (degrees) => ({ x: Math.cos(degrees * Math.PI / 180), y: Math.sin(degrees * Math.PI / 180) });

export function sanitizeOpticsState(value) {
  const state = value && typeof value === 'object' ? value : {};
  return {
    stage: Number.isInteger(state.stage) && state.stage >= 0 && state.stage <= 3 ? state.stage : 0,
    mirrorA: angle(state.mirrorA, initialOpticsState.mirrorA),
    mirrorB: angle(state.mirrorB, initialOpticsState.mirrorB),
    prediction: predictions.includes(state.prediction) ? state.prediction : null,
  };
}

export function reflectRay(direction, mirrorDegrees) {
  const length = Math.hypot(direction.x, direction.y);
  if (!finite(length) || length === 0 || !finite(mirrorDegrees)) return { x: 0, y: 0 };
  const unit = { x: direction.x / length, y: direction.y / length };
  const mirror = tangent(mirrorDegrees);
  return add({ x: -unit.x, y: -unit.y }, mirror, 2 * dot(unit, mirror));
}

export function mirrorEndpoints(center, degrees) {
  const direction = tangent(degrees);
  return [add(center, direction, -opticsBoard.mirrorHalfLength), add(center, direction, opticsBoard.mirrorHalfLength)];
}

function segmentHit(origin, direction, start, end) {
  const segment = subtract(end, start);
  const denominator = cross(direction, segment);
  if (Math.abs(denominator) < 1e-8) return null;
  const offset = subtract(start, origin);
  const distance = cross(offset, segment) / denominator;
  const along = cross(offset, direction) / denominator;
  return distance > 1e-5 && along >= 0 && along <= 1 ? { distance, point: add(origin, direction, distance) } : null;
}

function circleHit(origin, direction, center, radius) {
  const relative = subtract(origin, center);
  const projected = dot(relative, direction);
  const discriminant = projected * projected - dot(relative, relative) + radius * radius;
  if (discriminant < 0) return null;
  const distance = -projected - Math.sqrt(discriminant);
  return distance > 1e-5 ? { distance, point: add(origin, direction, distance) } : null;
}

export function traceOptics(value) {
  const state = sanitizeOpticsState(value);
  const cooperative = state.stage >= 2;
  const receiver = cooperative ? { x: 572, y: 108 } : { x: 270, y: 62 };
  const mirrors = [{ id: 'A', center: opticsBoard.mirrorA, degrees: state.mirrorA }];
  if (cooperative) mirrors.push({ id: 'B', center: opticsBoard.mirrorB, degrees: state.mirrorB });
  const corners = [{ x: 20, y: 22 }, { x: 620, y: 22 }, { x: 620, y: 356 }, { x: 20, y: 356 }];
  const segments = [];
  const reflections = [];
  let origin = { ...opticsBoard.source };
  let direction = { x: 1, y: 0 };
  let reachedReceiver = false;
  for (let bounce = 0; bounce < 8; bounce += 1) {
    let nearest = null;
    for (let index = 0; index < corners.length; index += 1) {
      const hit = segmentHit(origin, direction, corners[index], corners[(index + 1) % corners.length]);
      if (hit && (!nearest || hit.distance < nearest.distance)) nearest = { ...hit, kind: 'wall' };
    }
    for (const mirror of mirrors) {
      const [start, end] = mirrorEndpoints(mirror.center, mirror.degrees);
      const hit = segmentHit(origin, direction, start, end);
      if (hit && (!nearest || hit.distance < nearest.distance)) nearest = { ...hit, kind: 'mirror', mirror };
    }
    const receiverHit = circleHit(origin, direction, receiver, opticsBoard.receiverRadius);
    if (receiverHit && (!nearest || receiverHit.distance < nearest.distance)) nearest = { ...receiverHit, kind: 'receiver' };
    if (!nearest) break;
    segments.push({ from: origin, to: nearest.point });
    if (nearest.kind === 'receiver') { reachedReceiver = true; break; }
    if (nearest.kind !== 'mirror') break;
    const outgoing = reflectRay(direction, nearest.mirror.degrees);
    const mirrorTangent = tangent(nearest.mirror.degrees);
    const normal = { x: -mirrorTangent.y, y: mirrorTangent.x };
    const incidence = Math.acos(Math.min(1, Math.abs(dot(direction, normal)))) * 180 / Math.PI;
    const reflection = Math.acos(Math.min(1, Math.abs(dot(outgoing, normal)))) * 180 / Math.PI;
    reflections.push({ mirrorId: nearest.mirror.id, point: nearest.point, incoming: direction, outgoing, incidence, reflection });
    origin = nearest.point;
    direction = outgoing;
  }
  const usedRequiredMirrors = reflections[0]?.mirrorId === 'A' && (!cooperative || reflections[1]?.mirrorId === 'B');
  return { segments, reflections, receiver, reachedReceiver: reachedReceiver && usedRequiredMirrors };
}

export function isOpticsSolved(value) {
  const state = sanitizeOpticsState(value);
  return traceOptics(state).reachedReceiver && (state.stage !== 1 || state.prediction === 'equal');
}

export function opticsReducer(current, patch) {
  const state = sanitizeOpticsState(current);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return state;
  if (state.stage === 3) return patch.stage === 0 ? { ...initialOpticsState } : state;
  const candidate = {
    ...state,
    mirrorA: angle(patch.mirrorA, state.mirrorA),
    mirrorB: angle(patch.mirrorB, state.mirrorB),
    prediction: patch.prediction === null || predictions.includes(patch.prediction) ? patch.prediction : state.prediction,
  };
  if (patch.stage === state.stage + 1 && isOpticsSolved(candidate)) {
    candidate.stage = patch.stage;
    if (candidate.stage === 2) { candidate.mirrorA = -25; candidate.mirrorB = 15; }
  }
  return candidate;
}
