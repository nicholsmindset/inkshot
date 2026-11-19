import type {IncomingMessage,ServerResponse} from 'node:http';
import {authorizedOpsRequest, monitorStuckJobs, reportOpsAlert} from '../../server/ops.js';
import {hostedDatabase} from '../../server/hosted.js';
import {runDeletionOnce} from '../../server/account-deletion.js';
import {deletionAdapters} from '../../server/deletion-adapters.js';
import {runWorkerCycle} from '../../server/worker-cycle.js';
import {runWorkerOnce} from '../../server/worker.js';
import {assertHostedConfiguration} from '../../server/config.js';
export default async function handler(req:IncomingMessage,res:ServerResponse){
 res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
 if(!authorizedOpsRequest(req)){res.statusCode=401;res.end('{"error":"Unauthorized"}');return;}
 try {
  assertHostedConfiguration();
  const db=await hostedDatabase();
  const {processed,deletionProcessed}=await runWorkerCycle(deadline=>runWorkerOnce(db,deadline),()=>runDeletionOnce(db,deletionAdapters));
  await monitorStuckJobs(db);
  res.end(JSON.stringify({ok:true,processed,deletionProcessed}));
 }catch{reportOpsAlert('inkshot_worker_failed');res.statusCode=503;res.end('{"error":"Worker unavailable"}');}
}
