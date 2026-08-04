const http=require('http');
function vec(t,dim){const v=new Array(dim).fill(0);for(let i=0;i<t.length;i++){v[(t.charCodeAt(i)*7+i)%dim]+=1;}
 const n=Math.hypot(...v)||1;return v.map(x=>x/n);}
let calls=[];
http.createServer((req,res)=>{let b='';req.on('data',d=>b+=d);req.on('end',()=>{
 if(req.url.endsWith('/models')){res.writeHead(200,{'Content-Type':'application/json'});return res.end('{"data":[]}');}
 if(req.url.endsWith('/embeddings')){
   const j=JSON.parse(b||'{}'); calls.push({model:j.model,input_type:j.input_type,n:(j.input||[]).length});
   const data=(j.input||[]).map((t,i)=>({index:i,embedding:vec(t,64)}));
   res.writeHead(200,{'Content-Type':'application/json'});
   return res.end(JSON.stringify({data}));}
 if(req.url.endsWith('/calls')){res.writeHead(200);return res.end(JSON.stringify(calls));}
 res.writeHead(404);res.end('{}');});}).listen(4700,()=>console.log('fake NVIDIA up'));
