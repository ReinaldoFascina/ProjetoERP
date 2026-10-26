function config(){
  const endpoint=String(process.env.AZURE_OPENAI_ENDPOINT||"").replace(/\/$/,"");
  const deployment=process.env.AZURE_OPENAI_DEPLOYMENT;
  const apiVersion=process.env.AZURE_OPENAI_API_VERSION||"2024-10-21";
  const apiKey=process.env.AZURE_OPENAI_API_KEY;
  if(!endpoint||!deployment||!apiKey)throw Object.assign(new Error("Azure OpenAI não configurado."),{code:"AI_NOT_CONFIGURED"});
  return {endpoint,deployment,apiVersion,apiKey};
}
export async function callModel({messages,tools,toolChoice="auto",maxTokens=1200}){
  const c=config();
  const response=await fetch(`${c.endpoint}/openai/deployments/${encodeURIComponent(c.deployment)}/chat/completions?api-version=${encodeURIComponent(c.apiVersion)}`,{method:"POST",headers:{"content-type":"application/json","api-key":c.apiKey},body:JSON.stringify({messages,tools,tool_choice:toolChoice,temperature:0.1,max_tokens:maxTokens})});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(body?.error?.message||`Falha no modelo: HTTP ${response.status}`),{status:502,details:body});
  return body;
}
