import assert from 'node:assert/strict';
import test from 'node:test';
import {runWorkerCycle} from '../server/worker-cycle.js';
test('continuous deletion backlog advances creative work and only one deletion phase per invocation',async()=>{
  let jobs=6,deletions=0;const order:string[]=[];
  const result=await runWorkerCycle(async()=>{if(!jobs)return false;jobs--;order.push('job');return true;},async()=>{deletions++;order.push('deletion');return true;});
  assert.equal(jobs,0);assert.equal(deletions,1);assert.equal(order[0],'job');assert.deepEqual(result,{processed:6,deletionProcessed:true});
});
test('slow creative work defers deletion rather than starting without its bounded runtime budget',async()=>{
  let time=0,calls=0,deletions=0;
  const result=await runWorkerCycle(async()=>{calls++;time+=200_000;return calls===1;},async()=>{deletions++;return true;},()=>time);
  assert.equal(result.processed,1);assert.equal(deletions,0);
});
