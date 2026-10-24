import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialOpticsState, opticsReducer } from '../src/features/world/optics-model';
import { defaultSoloProgress, readSoloProgress, sanitizeSoloProgress, SOLO_SAVE_KEY, writeSoloProgress } from '../src/features/world/solo-progress';
import {LANDMARKS,WORLD_BOUNDS,RIVER_WALK_ROUTE,isWalkableWorld,type WorldPoint} from '../src/features/world/charles-geography';
import {navigationGuide} from '../src/features/world/world-destinations';
import {createBostonUniversity} from '../src/features/world/boston-university';
import {CampusCollision} from '../src/features/real-campus/campus-collision';
import {Mesh,Vector3} from 'three';

afterEach(() => vi.unstubAllGlobals());

function memoryStorage() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  vi.stubGlobal('localStorage', storage);
  return storage;
}

describe('independent solo progress', () => {
  it('uses a fresh default for missing, malformed or incompatible saves', () => {
    const storage = memoryStorage();
    expect(readSoloProgress()).toEqual(defaultSoloProgress());
    storage.setItem(SOLO_SAVE_KEY, '{broken');
    expect(readSoloProgress()).toEqual(defaultSoloProgress());
    for (const bad of [null, [], 'saved', 23, { version: 2, visited: ['dome'] }, { visited: ['dome'] }]) {
      expect(sanitizeSoloProgress(bad)).toEqual(defaultSoloProgress());
    }
    const first = defaultSoloProgress();
    first.visited.push('axis');
    first.lesson.mirrorA = 45;
    expect(defaultSoloProgress().visited).toEqual([]);
    expect(defaultSoloProgress().lesson).toEqual(initialOpticsState);
  });

  it('restores a partially completed lesson, exploration and settings without any visitor identity', () => {
    const storage = memoryStorage();
    const first = opticsReducer(initialOpticsState, { mirrorA: -45, stage: 1 });
    const lesson = opticsReducer(first, { prediction: 'equal', stage: 2 });
    const save = {
      ...defaultSoloProgress(), lesson, visited: ['axis', 'dome'], photoSpots: ['dome'],
      photos: 2, position: [34, 5] as [number, number], quality: 'low' as const, trackedId: 'optics',
    };
    expect(writeSoloProgress(save)).toBe(true);
    expect(storage.getItem(SOLO_SAVE_KEY)).not.toBeNull();
    expect(readSoloProgress()).toEqual(save);
    const continued = opticsReducer(readSoloProgress().lesson, { mirrorA: -45, mirrorB: -45, stage: 3 });
    expect(continued.stage).toBe(3);
    const completed = { ...save, lesson: continued, completedAt: '2026-10-12T08:00:00.000Z' };
    expect(writeSoloProgress(completed)).toBe(true);
    expect(readSoloProgress()).toEqual(completed);
  });

  it('deduplicates known places and rejects unknown values without accepting malformed progress', () => {
    expect(sanitizeSoloProgress({
      version: 1, visited: ['axis', 'axis', 'elsewhere', null, 'dome', 7],
      photoSpots: ['optics', 'optics', '__proto__'], trackedId: 'elsewhere', quality: 'ultra',
      lesson: { stage: 99, mirrorA: Infinity, mirrorB: NaN, prediction: 'invalid' }, completedAt: 'not-a-date',
    })).toEqual({ ...defaultSoloProgress(), visited: ['axis', 'dome'], photoSpots: ['optics'] });
    expect(sanitizeSoloProgress({ version: 1, visited: 'axis', photoSpots: { dome: true } }).visited).toEqual([]);
  });

  it('discards unsafe positions and photo counters while preserving safe edge coordinates', () => {
    for (const position of [[Infinity, 0], [NaN, 0], [0, '1'], [WORLD_BOUNDS.minX-1,0], [0,WORLD_BOUNDS.maxZ+1], [0], [0, 0, 0], null]) {
      expect(sanitizeSoloProgress({ version: 1, position }).position).toBeUndefined();
    }
    for (const position of [[224, 5], [-156, 5], [34, -185], [34, 160], [34.25, 5.75],LANDMARKS.buBeach,LANDMARKS.buMarsh,[WORLD_BOUNDS.minX,WORLD_BOUNDS.maxZ]]) {
      expect(sanitizeSoloProgress({ version: 1, position }).position).toEqual(position);
    }
    for (const photos of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '2']) {
      expect(sanitizeSoloProgress({ version: 1, photos }).photos).toBe(0);
    }
    expect(sanitizeSoloProgress({ version: 1, photos: 3 }).photos).toBe(3);
  });

  it('keeps new place visits independent from the original three discoveries and migrates old v1 saves',()=>{
    expect(sanitizeSoloProgress({version:1,visited:['axis','dome']}).visitedPlaces).toEqual([]);
    const save=sanitizeSoloProgress({version:1,visited:['axis','charles'],visitedPlaces:['charles','bu-beach','bu-beach','bu-questrom','axis','unknown'],trackedId:'bu-questrom',position:LANDMARKS.buQuestrom});
    expect(save.visited).toEqual(['axis']);expect(save.visitedPlaces).toEqual(['charles','bu-beach','bu-questrom']);
    expect(save.trackedId).toBe('bu-questrom');expect(save.position).toEqual(LANDMARKS.buQuestrom);
    memoryStorage();expect(writeSoloProgress(save)).toBe(true);expect(readSoloProgress()).toEqual(save);
  });

  // Thousands of route samples verify geometry, not a five-second benchmark.
  it('guides both directions across the bridge and footbridge without pointing through water or roads',()=>{
    for(const [start,destination] of [[RIVER_WALK_ROUTE[0],LANDMARKS.buBeach],[LANDMARKS.buMarsh,RIVER_WALK_ROUTE[0]]] as [WorldPoint,WorldPoint][]){
      let current:WorldPoint=[...start];
      for(let step=0;step<10000&&Math.hypot(current[0]-destination[0],current[1]-destination[1])>1;step++){
        const guide=navigationGuide(current,destination),dx=guide.point[0]-current[0],dz=guide.point[1]-current[1],length=Math.hypot(dx,dz);
        expect(length).toBeGreaterThan(0);
        current=[current[0]+dx/length*Math.min(.6,length),current[1]+dz/length*Math.min(.6,length)];
        expect(isWalkableWorld(...current),`route left dry ground at ${current.join(',')}`).toBe(true);
      }
      expect(Math.hypot(current[0]-destination[0],current[1]-destination[1]),`stalled at ${current}; next ${navigationGuide(current,destination).point}`).toBeLessThanOrEqual(1);
    }
  },15000);

  it('guides from BU Beach around the actual chapel colliders to Marsh Plaza and back toward MIT',()=>{
    const bu=createBostonUniversity({wind:{value:0}}),collision=new CampusCollision();collision.rebuild(bu.ground,bu.walls);
    const origin=new Vector3(),direction=new Vector3();
    try{
      // The regression is real: a direct instruction intersects the chapel.
      origin.set(LANDMARKS.buBeach[0],6.15,LANDMARKS.buBeach[1]);
      direction.set(LANDMARKS.buMarsh[0]-origin.x,0,LANDMARKS.buMarsh[1]-origin.z).normalize();
      expect(collision.distance(origin,direction,80)).toBeDefined();
      for(const [start,destination] of [[LANDMARKS.buBeach,LANDMARKS.buMarsh],[LANDMARKS.buMarsh,LANDMARKS.buBeach],[LANDMARKS.buMarsh,RIVER_WALK_ROUTE[0]],[LANDMARKS.buMarsh,LANDMARKS.buQuestrom],[LANDMARKS.buQuestrom,LANDMARKS.buBeach]] as [WorldPoint,WorldPoint][]){
        let current:WorldPoint=[...start];
        for(let step=0;step<12000&&Math.hypot(current[0]-destination[0],current[1]-destination[1])>1;step++){
          const guide=navigationGuide(current,destination),dx=guide.point[0]-current[0],dz=guide.point[1]-current[1],length=Math.hypot(dx,dz),stride=Math.min(.25,length);
          expect(length).toBeGreaterThan(0);
          origin.set(current[0],(collision.groundHeight(...current)??5.2)+.9,current[1]);direction.set(dx,0,dz).normalize();
          expect(collision.distance(origin,direction,stride+.34),`guide hits building at ${current}, aiming at ${guide.point}`).toBeUndefined();
          current=[current[0]+dx/length*stride,current[1]+dz/length*stride];
        }
        expect(Math.hypot(current[0]-destination[0],current[1]-destination[1]),`stalled at ${current}`).toBeLessThanOrEqual(1);
      }
    }finally{
      bu.group.traverse(object=>{if(object instanceof Mesh){object.geometry.dispose();for(const material of Array.isArray(object.material)?object.material:[object.material])material.dispose();}});
    }
  },15000);

  it('keeps completion history when a player restarts the lesson', () => {
    const saved = sanitizeSoloProgress({
      ...defaultSoloProgress(), lesson: initialOpticsState, completedAt: '2026-10-12T16:00:00+08:00',
    });
    expect(saved.completedAt).toBe('2026-10-12T08:00:00.000Z');
    expect(saved.lesson.stage).toBe(0);
  });

  it('falls back safely when storage is missing, blocked or full', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(readSoloProgress()).toEqual(defaultSoloProgress());
    expect(writeSoloProgress(defaultSoloProgress())).toBe(false);
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('quota exceeded'); },
    });
    expect(readSoloProgress()).toEqual(defaultSoloProgress());
    expect(writeSoloProgress(defaultSoloProgress())).toBe(false);
  });
});
