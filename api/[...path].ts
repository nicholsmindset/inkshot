import type {IncomingMessage,ServerResponse} from 'node:http';
import {createApp} from '../server/app.js';
import {hostedDatabase} from '../server/hosted.js';
import {assertHostedConfiguration} from '../server/config.js';
let app:ReturnType<typeof createApp>|undefined;
export default async function handler(req:IncomingMessage,res:ServerResponse){
 try {
  assertHostedConfiguration();
  app ||= createApp(await hostedDatabase());
  return app(req,res);
 } catch {
  res.statusCode=503;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify({error:'Inkshot is completing its service setup. Please try again shortly.'}));
 }
}
