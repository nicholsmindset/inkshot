import type {IncomingMessage,ServerResponse} from 'node:http';
import {authorizedOpsRequest, monitorStuckJobs, reportOpsAlert} from '../../server/ops.js';
import {hostedDatabase} from '../../server/hosted.js';
import {runWorkerOnce} from '../../server/worker.js';
import {assertHostedConfiguration} from '../../server/config.js';
export default async function handler(req:IncomingMessage,res:ServerResponse){
 res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
 if(!authorizedOpsRequest(req)){res.statusCode=401;res.end('{"error":"Unauthorized"}');return;}
 try {
  assertHostedConfiguration();
  const db=await hostedDatabase();let processed=0;
  const deadline=Date.now()+240_000;
  // Drain work that is available now. Pending provider requests remain in the
  // database and will be checked by the next invocation.
  while(processed<24 && Date.now()<deadline && await runWorkerOnce(db,deadline))processed++;
  await monitorStuckJobs(db);
  res.end(JSON.stringify({ok:true,processed}));
 }catch{reportOpsAlert('inkshot_worker_failed');res.statusCode=503;res.end('{"error":"Worker unavailable"}');}
}
