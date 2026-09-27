export interface DialogueRequest {campusId:string;npcId:string;messages:{role:'user'|'assistant';content:string}[];context:{interests:string[];selectedPoiId?:string}}
export interface DialogueResponse {text:string;sourceIds:string[];suggestedReplies:string[];mode:'live'|'fallback'}
export interface DialogueProvider {reply(input:DialogueRequest,signal?:AbortSignal):Promise<DialogueResponse>}
// P1 adapter boundary. P0 uses the deterministic dialogue trees directly.
