import type {IncomingMessage,ServerResponse} from 'node:http';
import {createApp} from '../server/app';
import {hostedDatabase} from '../server/hosted';
let app:ReturnType<typeof createApp>|undefined;
export default async function handler(req:IncomingMessage,res:ServerResponse){
 try {
  if(process.env.AUTH_PROVIDER!=='supabase'||process.env.STORAGE_PROVIDER!=='supabase')throw new Error('Managed services are required');
  app ||= createApp(await hostedDatabase());
  return app(req,res);
 } catch {
  res.statusCode=503;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify({error:'Inkshot is completing its service setup. Please try again shortly.'}));
 }
}
