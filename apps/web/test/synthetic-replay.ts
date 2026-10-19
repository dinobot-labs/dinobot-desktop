import type { ClientEvent } from '@dinobot/contracts';
// Hand-authored protocol examples. No captured sessions or user messages.
export function syntheticReplay(name: string): ClientEvent[] {
 const usage={input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}};
 const assistant={role:'assistant',content:[{type:'text',text:'Synthetic answer'}],api:'test',provider:'test',model:'test',usage,stopReason:'stop',timestamp:2};
 const result={id:3,kind:'pi.tool-result',model:[{role:'toolResult',toolCallId:'synthetic-call',toolName:'codemode',content:[{type:'text',text:'Synthetic result'}],details:{todos:[{id:'demo',content:'Synthetic task',status:'completed'}],subagent:{taskId:'synthetic-task',status:'completed',title:'Synthetic child'}},isError:false,timestamp:3}]};
 const snapshot={type:'snapshot',entries:[{id:1,kind:'pi.user',model:[{role:'user',content:'Synthetic request',timestamp:1}]},{id:2,kind:'pi.assistant',model:[assistant]},result],tools:[],compactions:[],inbox:[],agent:{},usage:{models:{},tools:{}},dag:{id:'synthetic-dag',revision:1,status:'succeeded',nodes:[{id:'demo',kind:'act',state:'succeeded',title:'Synthetic node',parents:[],directParents:[],level:0,attempt:1,maxAttempts:1,covers:[],critical:false}],requirements:[],levels:1,updatedAt:0}};
 if(name==='thread-dag-todo.jsonl') return [snapshot] as unknown as ClientEvent[];
 if(name==='thread-ask.jsonl') {
  const ask={id:'synthetic-ask',from:{conversationId:1},to:'human',kind:'decision',refs:[],question:'Synthetic choice?',options:['A','B'],default:'A',createdAt:0,deadlineAt:1000,state:'open'};
  return [snapshot,{type:'tool_execution_update',toolCallId:'ask-call',toolName:'codemode',details:{ask}},{type:'tool_execution_update',toolCallId:'ask-call',toolName:'codemode',details:{ask:{...ask,state:'answered',answer:'B'}}}] as unknown as ClientEvent[];
 }
 if(name==='thread-live-stream.jsonl') return [{...snapshot,run:{inputs:[1]}},{type:'message_start',message:{...assistant,content:[],stopReason:'pending'}},{type:'message_update',usage,changes:[{type:'text_start',contentIndex:0,block:{type:'text',text:''}},{type:'text_delta',contentIndex:0,delta:'Synthetic stream'}]},{type:'tool_execution_end',toolCallId:'synthetic-call',toolName:'codemode',entry:result},{type:'message_end',entry:result},{type:'entry_appended',entry:result}] as unknown as ClientEvent[];
 throw new Error('Unknown synthetic scenario: '+name);
}
