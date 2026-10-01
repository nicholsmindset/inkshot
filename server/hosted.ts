import {createDatabase,type Database} from './db.js';
let pending:Promise<Database>|undefined;
export function hostedDatabase(){
 if(!process.env.DATABASE_URL)throw new Error('Hosted database is not configured');
 pending ||= createDatabase().catch(error=>{pending=undefined;throw error;});
 return pending;
}
