import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import type {Plugin} from 'vite';
import {createAppService} from './server/app-service.mjs';

function worldService():Plugin{
 const lifecycle=globalThis as typeof globalThis & {__pulsetactWorldClosing?:Promise<void>};
 return {
  name:'pulsetact-world-service',
  async configureServer(server){
   await lifecycle.__pulsetactWorldClosing;
   const service=createAppService({storagePath:process.env.WORLD_STORAGE_PATH||`.world-data/dev-${server.config.server.port||5173}.json`});
   server.middlewares.use(service.handler);
   server.httpServer?.once('close',()=>{lifecycle.__pulsetactWorldClosing=service.close().catch(error=>console.error('Campus storage close failed:',error.message));});
  },
  async configurePreviewServer(server){
   await lifecycle.__pulsetactWorldClosing;
   const service=createAppService({storagePath:process.env.WORLD_STORAGE_PATH||`.world-data/preview-${server.config.preview.port||4173}.json`});
   server.middlewares.use(service.handler);
   server.httpServer.once('close',()=>{lifecycle.__pulsetactWorldClosing=service.close().catch(error=>console.error('Campus storage close failed:',error.message));});
  },
 };
}
export default defineConfig({plugins:[react(),worldService()],server:{watch:{ignored:['**/assets-source/**']},fs:{deny:['.env','.env.*','*.{crt,pem}','**/.git/**','**/server/**','**/worker/**','**/.vite-temp/**','**/.world-data/**']}},build:{rollupOptions:{output:{manualChunks:{three:['three','@react-three/fiber']}}}}});
