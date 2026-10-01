import type {IncomingMessage,ServerResponse} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {hostedDatabase} from '../../server/hosted.js';
import {runWorkerOnce} from '../../server/worker.js';
export default async function handler(req:IncomingMessage,res:ServerResponse){
 const expected=process.env.CRON_SECRET?Buffer.from(`Bearer ${process.env.CRON_SECRET}`):null;
 const supplied=Buffer.from(req.headers.authorization||'');
 res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET'||!expected||supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){res.statusCode=401;res.end('{"error":"Unauthorized"}');return;}
 try {
  const db=await hostedDatabase();let processed=0;
  const deadline=Date.now()+240_000;
  // Drain work that is available now. Pending provider requests remain in the
  // database and will be checked by the next invocation.
  while(processed<24 && Date.now()<deadline && await runWorkerOnce(db))processed++;
  res.end(JSON.stringify({ok:true,processed}));
 }catch{res.statusCode=503;res.end('{"error":"Worker unavailable"}');}
}
