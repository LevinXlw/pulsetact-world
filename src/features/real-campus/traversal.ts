// Metres and seconds. Shared movement rules used by the controller and tests.
export const traversal={walkSpeed:3.2,runSpeed:6.8,acceleration:12,braking:20};
export function approach(current:number,target:number,amount:number){return current<target?Math.min(current+amount,target):Math.max(current-amount,target);}
export function turnTowards(current:number,target:number,dt:number){const delta=Math.atan2(Math.sin(target-current),Math.cos(target-current));return current+delta*(1-Math.exp(-14*dt));}
