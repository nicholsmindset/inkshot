import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import type { DeletionAdapters } from './account-deletion.js';

function storageClient(){
  if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SECRET_KEY)throw new Error('Deletion credentials unavailable');
  return createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(30000)})}});
}
export const deletionAdapters:DeletionAdapters={
  async deleteProviderRequest(id){
    if(!config.hfKey||!config.hfSecret||!id)throw new Error('Deletion credentials unavailable');
    const response=await fetch(`https://api.higgsfield.ai/requests/${encodeURIComponent(id)}`,{method:'DELETE',headers:{Authorization:`Key ${config.hfKey}:${config.hfSecret}`},signal:AbortSignal.timeout(30000)});
    // 404 can mean a different provider account: do not mistake it for proven deletion.
    if(response.status!==200)throw new Error('Provider deletion unconfirmed');
    const body=await response.json();if(body.request_id!==id||body.status!=='deleted')throw new Error('Provider deletion unconfirmed');
  },
  async deleteWorkspaceStorage(workspaceId){
    // Hosted deletion deliberately refuses local media: local fixtures use injected adapters.
    if(process.env.STORAGE_PROVIDER!=='supabase'||!/^[-a-zA-Z0-9_]+$/.test(workspaceId))throw new Error('Storage deletion unavailable');
    const supabase=storageClient();
    for(const bucket of ['brand-uploads','generated-media']){
      const storage=supabase.storage.from(bucket);
      // Remove pages from offset zero; deleting advances the remaining objects.
      for(let page=0;page<1;page++){
        const {data,error}=await storage.list(workspaceId,{limit:100,offset:0,sortBy:{column:'name',order:'asc'}});
        if(error||!data)throw new Error('Storage listing failed');
        if(data.length===0)break;
        if(data.some(file=>!file.id||!/^[-a-zA-Z0-9_][-.a-zA-Z0-9_]*$/.test(file.name)))throw new Error('Unexpected storage layout');
        const removed=await storage.remove(data.map(file=>`${workspaceId}/${file.name}`));
        if(removed.error)throw new Error('Storage deletion failed');
        const remaining=await storage.list(workspaceId,{limit:1,offset:0});
        if(remaining.error||remaining.data?.length)throw new Error('Storage deletion requires another pass');
      }
    }
  },
  async deleteAuthUser(id){
    const {error}=await storageClient().auth.admin.deleteUser(id,false);
    if(error && error.code!=='user_not_found')throw new Error('Identity deletion unconfirmed');
  },
};
