import { initialOpticsState, sanitizeOpticsState } from './optics-model';
import type { OpticsState } from './optics-model';
import {ALL_CAMPUS_PLACES,CAMPUS_REGIONS,insideCampus,normalizeCampus,campusForPlace,campusPlaces,campusSpawn,type CampusId} from './campus-regions';
import {WORLD_DESTINATIONS} from './world-destinations';

export const SOLO_SAVE_KEY = 'pulsetact.world.solo.v1';

export type SoloProgress = {
  version: 1;
  visited: string[];
  visitedPlaces: string[];
  campus:CampusId;
  campusVisits:string[];
  campusPositions:Partial<Record<CampusId,[number,number]>>;
  photoSpots: string[];
  lesson: OpticsState;
  completedAt?: string;
  photos: number;
  position?: [number, number];
  quality: 'standard' | 'low';
  trackedId: string;
};

const pointIds = new Set(['axis', 'dome', 'optics']);
const placeIds = new Set(WORLD_DESTINATIONS.map(place=>place.id as string));
const campusPlaceIds=new Set(ALL_CAMPUS_PLACES.map(point=>point.id as string));

export function defaultSoloProgress(): SoloProgress {
  return {
    version: 1,
    visited: [],
    visitedPlaces: [],
    campus:'boston',campusVisits:[],campusPositions:{},
    photoSpots: [],
    lesson: { ...initialOpticsState },
    photos: 0,
    quality: 'standard',
    trackedId: 'axis',
  };
}

function sanitizePoints(value: unknown, knownIds=pointIds): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && knownIds.has(id)))];
}

function sanitizePosition(value: unknown,campus:CampusId): [number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const [x, z] = value;
  if (typeof x !== 'number' || typeof z !== 'number' || !Number.isFinite(x) || !Number.isFinite(z)) return undefined;
  // The scene checks terrain height and collisions after restoring these bounds.
  if (!insideCampus(campus,x,z)) return undefined;
  return [x, z];
}

export function sanitizeSoloProgress(value: unknown): SoloProgress {
  const fallback = defaultSoloProgress();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const saved = value as Record<string, unknown>;
  if (saved.version !== 1) return fallback;
  const campus=normalizeCampus(saved.campus);
  const campusPositions:SoloProgress['campusPositions']={};
  if(saved.campusPositions&&typeof saved.campusPositions==='object'&&!Array.isArray(saved.campusPositions)){
    for(const {id} of CAMPUS_REGIONS){const position=sanitizePosition((saved.campusPositions as Record<string,unknown>)[id],id);if(position)campusPositions[id]=position;}
  }
  const candidate=typeof saved.trackedId==='string'?saved.trackedId:'';
  const validTarget=campus==='boston'?(pointIds.has(candidate)||placeIds.has(candidate)):campusForPlace(candidate)===campus;
  const result: SoloProgress = {
    version: 1,
    campus,campusPositions,campusVisits:sanitizePoints(saved.campusVisits,campusPlaceIds),
    visited: sanitizePoints(saved.visited),
    visitedPlaces: sanitizePoints(saved.visitedPlaces,placeIds),
    photoSpots: sanitizePoints(saved.photoSpots),
    lesson: sanitizeOpticsState(saved.lesson),
    photos: typeof saved.photos === 'number' && Number.isSafeInteger(saved.photos) && saved.photos >= 0 ? saved.photos : 0,
    quality: saved.quality === 'low' ? 'low' : 'standard',
    trackedId:validTarget?candidate:campus==='boston'?'axis':campusPlaces(campus)[0].id,
  };
  const position = sanitizePosition(saved.position,campus);
  if (position) result.position = position;
  if (typeof saved.completedAt === 'string' && saved.completedAt.length <= 64 && Number.isFinite(Date.parse(saved.completedAt))) {
    result.completedAt = new Date(saved.completedAt).toISOString();
  }
  return result;
}

export function readSoloProgress(): SoloProgress {
  try {
    const saved = globalThis.localStorage.getItem(SOLO_SAVE_KEY);
    return saved ? sanitizeSoloProgress(JSON.parse(saved)) : defaultSoloProgress();
  } catch {
    return defaultSoloProgress();
  }
}

export function writeSoloProgress(value: SoloProgress): boolean {
  try {
    globalThis.localStorage.setItem(SOLO_SAVE_KEY, JSON.stringify(sanitizeSoloProgress(value)));
    return true;
  } catch {
    return false;
  }
}

/** Keep each region's coordinates separate; old v1 Boston saves retain meaning. */
export function changeSoloCampus(progress:SoloProgress,from:[number,number],campus:CampusId,target?:{id:string;position:[number,number]}):SoloProgress{
  const campusPositions={...progress.campusPositions};
  if(insideCampus(progress.campus,...from))campusPositions[progress.campus]=[...from];
  const position=target?.position??campusPositions[campus]??campusSpawn(campus);
  return {...progress,campus,campusPositions,position:[...position],trackedId:target?.id??(campus==='boston'?'axis':campusPlaces(campus)[0].id)};
}
