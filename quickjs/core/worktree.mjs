/* Git 工作树身份：把未提交状态纳入本地机器证据。
 *
 * 身份由四部分组成：
 *  - status：filtered `git status --porcelain -uno -z`（已跟踪变动）
 *  - diff：staged + unstaged `git diff --raw -z`（内容摘要）
 *  - untracked：每个未追踪路径 + `git hash-object` 内容摘要
 *  - identity：以上字段的确定性 JSON 摘要
 *
 * Dairn 自己写入的治理数据（.dairn/governance/evidence/、.dairn/work/ 等）以及
 * 已由任务账本按 sha256 绑定的证据文件不参与比较：它们分别由证据哈希、
 * append-only 校验和任务 revision 保护，若参与工作树身份会让“检查→记录→推进”
 * 的正常流程自我失效。真正的源码改动（已跟踪或未绑定未追踪文件）仍会被发现。
 */
import {sha256} from './sha256.mjs';

const ok=(value,message)=>{if(!value)throw Error(message);};
const MAX_UNTRACKED=5000;
const PER_FILE_TIMEOUT=30;
// 与 policy.mjs 的 dataPaths 保持同一组“Dairn 可变治理数据”前缀。
const DATA_PREFIXES=['.dairn/governance/changes/','.dairn/governance/operations/','.dairn/governance/evidence/',
  '.dairn/work/','.dairn/facts/','.dairn/cache/','.dairn/tmp/'];

function git(h,root,args,timeout){
  const result=h.run(['git',...args],root,timeout);
  ok(!result.timedOut,'Git command timed out: '+args.join(' '));
  ok(result.code===0,'Git command failed: '+args.join(' ')+(result.output?'\n'+result.output.slice(0,512):''));
  return result.output||'';
}
function safeRelativePath(path){
  return typeof path==='string'&&path.length>0&&!path.startsWith('/')&&!path.startsWith('\\')&&
    !path.split('/').some(part=>part==='..'||part==='')&&!/^[A-Za-z]:/.test(path);
}
function normalizeExclusions(exclude){
  const seen=new Set();const result=[];
  for(const raw of [...DATA_PREFIXES,...(Array.isArray(exclude)?exclude:[])]){
    if(typeof raw!=='string'||!raw)continue;
    const isDir=raw.endsWith('/');
    const value=isDir?raw.slice(0,-1):raw;
    if(!safeRelativePath(value))continue;
    const key=isDir?value+'/':value;
    if(seen.has(key))continue;
    seen.add(key);result.push(key);
  }
  return result;
}
/* 任务账本中已按 sha256 记录的证据与 session anchor 不属于工作树身份。 */
export function taskExclusions(task){
  const paths=[];
  if(!task||typeof task!=='object')return paths;
  for(const stage of task.stages||[])for(const evidence of stage?.evidence||[]){
    if(evidence&&typeof evidence.path==='string')paths.push(evidence.path);
  }
  for(const anchor of task.session_anchors||[])if(anchor&&typeof anchor.path==='string')paths.push(anchor.path);
  return paths;
}

export function captureWorktree(h,root,timeout=120,exclude=[]){
  const probeTimeout=Math.min(Math.max(1,timeout),30);
  const probe=h.run(['git','rev-parse','--is-inside-work-tree'],root,probeTimeout);
  ok(!probe.timedOut,'Git worktree probe timed out');
  const probeText=String(probe.output||'').trim();
  const inside=probe.code===0&&/^true$/i.test(probeText);
  // 只有 Git 明确回答“不是仓库”时才允许非 Git 回退；其它错误（权限、 dubious
  // ownership、超时）必须 fail closed，否则工作树身份会静默退化为空。
  const notRepo=probe.code!==0&&/not a git repository/i.test(String(probe.output||''));
  if(!inside&&!notRepo)throw Error('Cannot determine Git worktree state for evidence: '+(probeText||'git exit '+probe.code));
  if(!inside){
    // `check --all` 也支持刚初始化、尚未 git init 的项目；显式记录该限制。
    // 任务关联检查需要 HEAD，因此不会走这条分支。
    const identity={schema:1,status:'non-git',status_sha256:sha256('non-git'),
      diff_sha256:sha256('non-git'),untracked_sha256:sha256('non-git'),untracked_count:0};
    identity.identity_sha256=sha256(JSON.stringify(identity));
    return identity;
  }
  const exclusions=normalizeExclusions(exclude);
  const pathspec=exclusions.length?['--',...exclusions.map(path=>':(exclude,literal)'+path)]:[];
  const status=git(h,root,['status','--porcelain=v1','-uno','-z',...pathspec],timeout);
  const unstaged=git(h,root,['diff','--raw','-z',...pathspec],timeout);
  const staged=git(h,root,['diff','--cached','--raw','-z',...pathspec],timeout);
  // -z 输出不受 core.quotePath 影响，中文/空格文件名可安全参与摘要。
  const untracked=git(h,root,['ls-files','--others','--exclude-standard','-z',...pathspec],timeout)
    .split('\0').filter(Boolean);
  ok(untracked.every(safeRelativePath),'Unsafe untracked path in worktree evidence');
  ok(untracked.every(path=>!/[\r\n]/.test(path)),'Untracked path contains a newline');
  ok(untracked.length<=MAX_UNTRACKED,'Untracked file count exceeds evidence limit: '+untracked.length);
  const deadline=Date.now()+Math.min(Math.max(1,timeout),3600)*1000;
  // 分批调用 hash-object：git 支持一次接收多个路径并按行输出摘要，避免为每个
  // 未追踪文件启动一个子进程。批大小同时受参数个数与命令行总长度限制。
  const batches=[];let batch=[],batchBytes=0;
  for(const path of untracked){
    const size=path.length+1;
    if(batch.length>=500||batchBytes+size>16000){batches.push(batch);batch=[];batchBytes=0;}
    batch.push(path);batchBytes+=size;
  }
  if(batch.length)batches.push(batch);
  const untrackedParts=[];
  for(const paths of batches){
    ok(Date.now()<=deadline,'Worktree evidence capture timed out');
    const output=git(h,root,['hash-object','--no-filters','--',...paths],Math.max(PER_FILE_TIMEOUT,Math.min(timeout,120))).trim();
    const blobs=output?output.split(/\r?\n/):[];
    ok(blobs.length===paths.length,'Unexpected untracked hash count: '+blobs.length+' != '+paths.length);
    for(let index=0;index<paths.length;index++){
      ok(/^[0-9a-f]{40,64}$/.test(blobs[index]),'Invalid untracked blob hash: '+paths[index]);
      untrackedParts.push(paths[index]+'\0'+blobs[index]);
    }
  }
  const identity={
    schema:1,
    status:(status.length||untracked.length)?'dirty':'clean',
    status_sha256:sha256(status),
    diff_sha256:sha256(staged+'\0'+unstaged),
    untracked_sha256:sha256(untrackedParts.join('\0')),
    untracked_count:untracked.length,
  };
  identity.identity_sha256=sha256(JSON.stringify(identity));
  return identity;
}

export function sameWorktree(a,b){
  return !!a&&!!b&&['schema','status','status_sha256','diff_sha256','untracked_sha256','untracked_count','identity_sha256']
    .every(key=>a[key]===b[key]);
}
