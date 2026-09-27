import {courtPoint} from './inspection';
import type {Position} from '../../types';

export type CampusMode='orbit'|'walk'|'stroll';
export const stroll={eyeHeight:1.65,fov:48,lookSensitivity:.003,pitchLimit:Math.PI*.46};
export function strollStart(campus:string,spawn:Position,detail:boolean):Position{return campus==='mit'&&detail?courtPoint(0,110):spawn;}
export function clampPitch(pitch:number){return Math.max(-stroll.pitchLimit,Math.min(stroll.pitchLimit,pitch));}
