import 'server-only';
export interface OpenAIMessage {role:'user'|'assistant';content:string;}
export function isOpenAIConfigured(){return Boolean(process.env.OPENAI_API_KEY);}
export async function generateWithOpenAI(options:{systemPrompt:string;messages:OpenAIMessage[];temperature?:number;timeoutMs?:number}):Promise<{text:string}>{
 if(!process.env.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY is required');
 const response=await fetch('https://api.openai.com/v1/chat/completions',{
  method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},
  body:JSON.stringify({model:process.env.OPENAI_MODEL || 'gpt-4.1-mini',messages:[{role:'system',content:options.systemPrompt},...options.messages],temperature:options.temperature??0.1}),
  signal:AbortSignal.timeout(options.timeoutMs??55000),
 });
 if(!response.ok)throw new Error(`OpenAI request failed (${response.status})`);
 const data=await response.json();const text=data.choices?.[0]?.message?.content;
 if(typeof text!=='string'||!text.trim())throw new Error('OpenAI returned no text');return {text};
}
