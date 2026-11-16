// Retry only explicit gateway JWT rejections: the RPC has not reached the database.
// Network/server errors are never replayed, especially for financial commands.
export function authIssue(error) {
  if(error?.authKind) return error.authKind;
  const message=String(error?.message??error??'');
  if(error?.code==='PGRST303' && /JWT issued (?:at|in the) future/i.test(message)) return 'clock';
  if(/^PGRST30[13]$/.test(error?.code||'') && /(?:JWT.*(?:expired|invalid)|(?:expired|invalid).*JWT)/i.test(message)) return 'session';
  if(/(?:refresh.token.*(?:invalid|expired|not found)|invalid refresh token|session.*missing)/i.test(message)) return 'session';
  return '';
}
export function authErrorMessage(error) {
  const issue=authIssue(error);
  if(issue==='clock') return 'تعذر فتح الدفتر مؤقتاً بسبب فرق توقيت في خدمة تسجيل الدخول. حاول مرة أخرى بعد قليل، أو جدّد جلسة الدخول.';
  if(issue==='session') return 'جلسة الدخول تحتاج تجديداً. اضغط تجديد الجلسة، أو ارجع لتسجيل الدخول.';
  return String(error?.message??error??'تعذر الاتصال بالخادم');
}
export async function rpcWithSessionRecovery(client,name,params={},options={}) {
  const wait=options.wait||((ms)=>new Promise(resolve=>setTimeout(resolve,ms)));
  const pauses=[1200,2500];
  let clockRetries=0, refreshed=false;
  let result=await client.rpc(name,params);
  while(result.error) {
    const issue=authIssue(result.error);
    if(issue==='clock' && clockRetries<pauses.length) {
      options.onRetry?.('clock');
      await wait(pauses[clockRetries++]);
      result=await client.rpc(name,params);
      continue;
    }
    if(issue==='session' && !refreshed) {
      refreshed=true;
      const fresh=await client.auth.refreshSession();
      if(fresh.error) return {data:null,error:fresh.error};
      if(!fresh.data?.session) return {data:null,error:{message:'Session missing',code:'session_not_found'}};
      result=await client.rpc(name,params);
      continue;
    }
    break;
  }
  return result;
}
