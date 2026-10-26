/* 普通检查与独立治理执行共用同一内置执行器，不启动 PATH 中的 Dairn。 */
import {invariant} from './policy.mjs';
const join=(a,b)=>b==='.'?a:a.replace(/\/$/,'')+'/'+b;
const within=(root,path)=>path===root||path.startsWith(root.replace(/\/$/,'')+'/');
const safeRelative=p=>typeof p==='string'&&p.length>0&&!p.startsWith('/')&&!p.includes('\\')&&!/^[A-Za-z]:/.test(p)&&!p.split('/').some(x=>x==='..'||x===''||x==='.');
function command(h,argv,cwd,timeout){
  const result=h.run(argv,cwd,timeout);
  if(result.timedOut||result.code!==0){
    const error=Error(result.timedOut?'Command timeout '+timeout+'s: '+argv[0]:'Command failed ('+result.code+'): '+argv.join(' ')+'\n'+String(result.output||'').slice(0,1024));
    error.checkResult=result;throw error;
  }
  return result.output;
}
function runStackCheck(h,stack,step,cwd,timeout) {
  if(stack==='go' && step==='lint') {
    const repo=h.run(['git','rev-parse','--is-inside-work-tree'],cwd,timeout);
    // `git rev-parse --is-inside-work-tree` 在仓库外也会以 0 退出并打印 false，
    // 必须看输出；只有 Git 明确回答“不是仓库”时才允许文件系统回退。权限、
    // dubious ownership、超时等其它错误必须 fail closed，不能静默退化为扫描。
    invariant(!repo.timedOut,'Go lint Git worktree probe timed out');
    const probe=String(repo.output||'').trim();
    const inRepo=repo.code===0 && /^true$/i.test(probe);
    const notRepo=repo.code!==0 && /not a git repository/i.test(String(repo.output||''));
    invariant(inRepo||notRepo,'Cannot determine Git worktree for Go lint: '+(probe||'git exit '+repo.code));
    let goFiles=[];
    if(inRepo) {
      // Git 工程必须尊重 .gitignore；空列表不能退化成文件系统扫描，否则
      // 会把被忽略的文件或工程外链接目标带入门禁。
      goFiles=command(h,['git','ls-files','-z','--cached','--others','--exclude-standard','--','*.go'],cwd,timeout).split('\0').filter(Boolean);
      invariant(goFiles.length>0,'No Go files available in Git for gofmt');
      invariant(goFiles.length<=20000,'Go lint file list exceeds limit');
      for(const file of goFiles) {
        invariant(safeRelative(file),'Unsafe Go file path from Git: '+JSON.stringify(file));
        invariant(!h.isSymlink(join(cwd,file)),'Go lint refuses symlink path: '+file);
      }
    } else {
      const repoRoot=h.realpath(cwd);
      const maxDepth=8,maxFiles=20000,maxDirs=5000,deadline=Date.now()+timeout*1000;
      let dirs=0;
      const walk=(d,prefix,depth)=>{
        invariant(Date.now()<=deadline,'Go lint file discovery timed out');
        invariant(depth<=maxDepth,'Go lint directory depth exceeded '+maxDepth);
        invariant(!h.isSymlink(d),'Go lint refuses symlink directory: '+prefix);
        const canonical=h.realpath(d);
        invariant(within(repoRoot,canonical),'Go lint path escapes repository: '+prefix);
        invariant(++dirs<=maxDirs,'Go lint directory limit exceeded');
        for(const name of h.list(d)){
          if(name.startsWith('.')||['vendor','node_modules','target','dist'].includes(name))continue;
          const abs=join(d,name),rel=prefix+name;
          invariant(!h.isSymlink(abs),'Go lint refuses symlink path: '+rel);
          const resolved=h.realpath(abs);
          invariant(within(repoRoot,resolved),'Go lint path escapes repository: '+rel);
          if(h.isDirectory(abs)) walk(abs,rel+'/',depth+1);
          else if(name.endsWith('.go')) { invariant(goFiles.length<maxFiles,'Go lint file limit exceeded'); goFiles.push(rel); }
        }
      };
      walk(cwd,'',0);
    }
    invariant(goFiles.length>0,'No Go files available for gofmt');
    // 拆分批次，避免参数列表超过平台命令行长度上限；`--` 防止文件名被当作
    // gofmt 选项（例如被跟踪的 `-e.go`）。
    const invalid=[];
    for(let i=0;i<goFiles.length;i+=500){
      const output=command(h,['gofmt','-l','--',...goFiles.slice(i,i+500)],cwd,timeout).trim();
      if(output)invalid.push(output);
    }
    invariant(!invalid.length,'gofmt found unformatted files: '+invalid.join('\n'));
    command(h,['go','vet','./...'],cwd,timeout);
    return {code:0,output:'gofmt and go vet passed',duration_sec:0};
  }
  if(stack==='rust'&&step==='lint') {
    command(h,['cargo','fmt','--all','--','--check'],cwd,timeout);
    command(h,['cargo','clippy','--all-targets','--','-D','warnings'],cwd,timeout);
    return {code:0,output:'cargo fmt and clippy passed',duration_sec:0};
  }
  if(stack==='python'&&step==='lint') {
    command(h,['ruff','check','.'],cwd,timeout);
    command(h,['ruff','format','--check','.'],cwd,timeout);
    return {code:0,output:'ruff check and format passed',duration_sec:0};
  }
  throw new Error('Unsupported internal stack-check: '+stack+' '+step+' (fail closed)');
}

export function executeCheck(h,argv,cwd,timeout){
  if(argv[0]!=='dairn'||argv[1]!=='stack-check')return h.run(argv,cwd,timeout);
  try{return runStackCheck(h,argv[2],argv[3],cwd,timeout);}
  catch(error){
    if(error.checkResult)return {...error.checkResult,output:String(error.message||error)};
    return {code:null,error:true,timedOut:false,output:String(error.message||error),duration_sec:null};
  }
}
