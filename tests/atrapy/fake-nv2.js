const http=require('http');
const DIM=parseInt(process.env.DIM||'64',10);
function vec(t,dim){const v=new Array(dim).fill(0);for(let i=0;i<t.length;i++){v[(t.charCodeAt(i)*7+i)%dim]+=1;}
 const n=Math.hypot(...v)||1;return v.map(x=>x/n);}
http.createServer((req,res)=>{let b='';req.on('data',d=>b+=d);req.on('end',()=>{
 if(req.url.endsWith('/models')){res.writeHead(200,{'Content-Type':'application/json'});return res.end('{"data":[]}');}
 if(req.url.endsWith('/embeddings')){const j=JSON.parse(b||'{}');
   res.writeHead(200,{'Content-Type':'application/json'});
   return res.end(JSON.stringify({data:(j.input||[]).map((t,i)=>({index:i,embedding:vec(t,DIM)}))}));}
 if(req.url.endsWith('/chat/completions')){res.writeHead(200,{'Content-Type':'text/event-stream'});
   res.write('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n');res.write('data: [DONE]\n\n');return res.end();}
 res.writeHead(404);res.end('{}');});}).listen(4701,()=>console.log('fake up'));
