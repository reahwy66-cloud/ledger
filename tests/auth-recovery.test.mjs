import test from 'node:test';
import assert from 'node:assert/strict';
import {rpcWithSessionRecovery,authErrorMessage,authIssue} from '../dashboard-v2/auth-recovery.mjs';
const future={code:'PGRST303',message:'JWT issued at future'};
const expired={code:'PGRST301',message:'JWT expired'};
function mock(responses,refresh={data:{session:{present:true}},error:null}){
 const calls=[],waits=[];let refreshes=0;
 return {calls,waits,get refreshes(){return refreshes;},client:{rpc:async(name,p)=>{calls.push({name,p});const result=responses.shift();if(result instanceof Error)throw result;return result;},auth:{refreshSession:async()=>{refreshes++;return refresh;}}},options:{wait:async ms=>{waits.push(ms);}}};
}
test('future-issued JWT waits and reuses the same token and financial operation id',async()=>{const m=mock([{error:future},{data:{ok:true},error:null}]),p={p:{id:'stable-id',amount:60.74}};const r=await rpcWithSessionRecovery(m.client,'rwa2_post',p,m.options);assert.equal(r.data.ok,true);assert.deepEqual(m.waits,[1200]);assert.equal(m.refreshes,0);assert.equal(m.calls[0].p,m.calls[1].p);});
test('persistent clock rejection stops after exactly two retries',async()=>{const m=mock([{error:future},{error:future},{error:future}]);const r=await rpcWithSessionRecovery(m.client,'rwa2_snapshot',{},m.options);assert.equal(r.error,future);assert.equal(m.calls.length,3);assert.deepEqual(m.waits,[1200,2500]);assert.equal(m.refreshes,0);});
test('expired JWT refreshes once then retries',async()=>{const m=mock([{error:expired},{data:'fresh',error:null}]);assert.equal((await rpcWithSessionRecovery(m.client,'rwa2_snapshot',{},m.options)).data,'fresh');assert.equal(m.refreshes,1);});
test('refresh failure is surfaced without replaying the command',async()=>{const error={message:'Invalid refresh token'};const m=mock([{error:expired}],{data:{session:null},error});assert.equal((await rpcWithSessionRecovery(m.client,'rwa2_post',{},m.options)).error,error);assert.equal(m.calls.length,1);});
test('permission errors and server errors are not retried',async()=>{for(const error of [{code:'42501',message:'Forbidden'},{code:'P0001',message:'JWT issued at future'},{code:'XX000',message:'Server failure'}]){const m=mock([{error}]);assert.equal((await rpcWithSessionRecovery(m.client,'rwa2_post',{},m.options)).error,error);assert.equal(m.calls.length,1);assert.equal(m.refreshes,0);}});
test('ambiguous network errors are never replayed',async()=>{const m=mock([new Error('Network lost')]);await assert.rejects(rpcWithSessionRecovery(m.client,'rwa2_post',{},m.options),/Network lost/);assert.equal(m.calls.length,1);});
test('recovery never loops across repeated expiry failures',async()=>{const m=mock([{error:expired},{error:expired}]);const r=await rpcWithSessionRecovery(m.client,'rwa2_snapshot',{},m.options);assert.equal(r.error,expired);assert.equal(m.calls.length,2);assert.equal(m.refreshes,1);});
test('future-rejection UI is actionable Arabic while permission details survive',()=>{assert.equal(authIssue(future),'clock');assert(authErrorMessage(future).includes('فرق توقيت'));assert.equal(authErrorMessage({message:'Not allowed'}),'Not allowed');});
