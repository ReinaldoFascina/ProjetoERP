import { performance } from "node:perf_hooks";
import { db } from "../../database/db.js";
import { callModel } from "./model-client.js";
import { assertToolPermission } from "./permissions.js";
import { sanitizeForAudit } from "./sanitize.js";
import { SYSTEM_PROMPT } from "./system-prompt.js";
import { toolDefinitions,toolHandlers } from "./tools/operational-tools.js";

function parseArguments(value){try{return JSON.parse(value||"{}");}catch{return {};}}
function answerStructure(content,toolResults=[]){return {answer:content,severity:"INFO",confidence:toolResults.length?0.95:0.7,findings:[],sources:toolResults.flatMap(r=>r?.links||[]),actions:[]};}

export async function processMessage({conversationId,message,context,userContext}){
  const started=performance.now();
  const history=(await db.query(`SELECT role,content,structured_content FROM ai_messages WHERE conversation_id=$1 ORDER BY id DESC LIMIT 20`,[conversationId])).rows.reverse();
  const messages=[{role:"system",content:SYSTEM_PROMPT},{role:"system",content:`Contexto autorizado: ${JSON.stringify({module:context.module,page:context.page,entityType:context.entityType,entityId:context.entityId,role:userContext.role})}`}];
  history.forEach(item=>messages.push({role:item.role.toLowerCase()==="assistant"?"assistant":"user",content:item.content}));
  messages.push({role:"user",content:message});
  const first=await callModel({messages,tools:toolDefinitions});
  const assistant=first.choices?.[0]?.message||{};
  const toolCalls=assistant.tool_calls||[];
  const toolResults=[];
  let actionProposal=null;
  if(toolCalls.length){
    messages.push(assistant);
    for(const call of toolCalls){
      const toolName=call.function?.name;
      const args=parseArguments(call.function?.arguments);
      const toolStarted=performance.now();
      let auditId;
      try{
        assertToolPermission({role:userContext.role,toolName});
        auditId=(await db.query(`INSERT INTO ai_tool_executions(conversation_id,company_id,branch_id,user_id,tool_name,input_data,status) VALUES($1,$2,$3,$4,$5,$6,'STARTED') RETURNING id`,[conversationId,userContext.companyId,userContext.branchId,userContext.userId,toolName,sanitizeForAudit(args)])).rows[0].id;
        const handler=toolHandlers[toolName];
        if(!handler)throw new Error("Ferramenta não registrada.");
        const result=await handler(args,userContext);
        if(result?.actionProposal)actionProposal=result.actionProposal;
        toolResults.push(result);
        await db.query(`UPDATE ai_tool_executions SET output_data=$1,status='SUCCESS',duration_ms=$2 WHERE id=$3`,[sanitizeForAudit(result),Math.round(performance.now()-toolStarted),auditId]);
        messages.push({role:"tool",tool_call_id:call.id,content:JSON.stringify(result)});
      }catch(error){
        if(auditId)await db.query(`UPDATE ai_tool_executions SET status='ERROR',duration_ms=$1,error_message=$2 WHERE id=$3`,[Math.round(performance.now()-toolStarted),error.message,auditId]);
        messages.push({role:"tool",tool_call_id:call.id,content:JSON.stringify({error:error.message})});
      }
    }
  }
  let content=assistant.content;
  let usage=first.usage||{};
  if(toolCalls.length){
    const final=await callModel({messages,tools:toolDefinitions,toolChoice:"none"});
    content=final.choices?.[0]?.message?.content||"Consulta concluída.";
    usage={prompt_tokens:(usage.prompt_tokens||0)+(final.usage?.prompt_tokens||0),completion_tokens:(usage.completion_tokens||0)+(final.usage?.completion_tokens||0)};
  }
  const structured=answerStructure(content||"Não foi possível gerar a resposta.",toolResults);
  const saved=(await db.query(`INSERT INTO ai_messages(conversation_id,role,content,structured_content,model_name,input_tokens,output_tokens,latency_ms) VALUES($1,'ASSISTANT',$2,$3,$4,$5,$6,$7) RETURNING id`,[conversationId,structured.answer,structured,process.env.AZURE_OPENAI_DEPLOYMENT||null,usage.prompt_tokens||null,usage.completion_tokens||null,Math.round(performance.now()-started)])).rows[0];
  if(actionProposal){
    const action=(await db.query(`INSERT INTO ai_actions(conversation_id,source_message_id,company_id,branch_id,requested_by,action_type,entity_type,entity_id,title,description,payload,risk_level,status,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'PENDING',NOW()+INTERVAL '7 days') RETURNING id,status`,[conversationId,saved.id,userContext.companyId,userContext.branchId,userContext.userId,actionProposal.actionType,actionProposal.entityType,actionProposal.entityId,actionProposal.title,actionProposal.description,actionProposal.payload,actionProposal.riskLevel])).rows[0];
    structured.actions.push({type:"APPROVAL",label:"Revisar ação proposta",url:`/ai/actions/${action.id}`,actionId:action.id,status:action.status});
    await db.query(`UPDATE ai_messages SET structured_content=$1 WHERE id=$2`,[structured,saved.id]);
  }
  await db.query(`UPDATE ai_conversations SET updated_at=NOW(),title=COALESCE(title,$1) WHERE id=$2`,[message.slice(0,120),conversationId]);
  return {messageId:saved.id,...structured};
}
