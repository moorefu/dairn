/* Capability Registry：发现项目可用的专业能力来源。
 * 只做声明索引，不启动模型、不复制 Skill 正文、不赋予任何信任。
 * 能力来源：①项目已安装 Skills 的 SKILL.md frontmatter（Harness 原生）；
 * ②Analyzer Registry 的 capabilities[]（工程分析工具能力）。 */
const assert=(v,m)=>{if(!v)throw Error('Capability: '+m);};

export function discoverCapabilities(h,root,read){
  // read(kind, relPath)→text|null：与 assets-lint 相同的受控读取协议。
  const skills=[];
  const dir=root.replace(/\/$/,'')+'/.agents/skills';
  let names=[];
  try{names=h.list(dir).sort();}catch(_){names=[];}
  for(const name of names){
    const raw=read('skills',name+'/SKILL.md');
    if(raw===null||raw===undefined)continue;
    const fm=frontmatter(raw);
    if(!fm.name&&!fm.id)continue;
    skills.push({provider:name,kind:'skill',harness:'native',
      name:fm.name||name,
      summary:typeof fm.description==='string'?fm.description.slice(0,300):'',
      source:'.agents/skills/'+name+'/SKILL.md',
      status:'declared'});
  }
  return {skills};
}
export function frontmatter(raw){
  const out={};
  if(typeof raw!=='string'||!raw.startsWith('---'))return out;
  const end=raw.indexOf('\n---',3);
  if(end<0)return out;
  for(const line of raw.slice(4,end).split('\n')){
    const m=/^([A-Za-z][\w-]*):\s*(.*)$/.exec(line.trim());
    if(m)out[m[1]]=m[2].replace(/^["']|["']$/g,'');
  }
  return out;
}

/* 确定性最小推荐（方案 §7.3）：必需保证 → 已有机器检查/分析器优先，
 * Skill 只作 advisory 补充；无合格提供者报告 GAP，不降级风险。 */
const SECURITY_PATH_HINTS=/(^|\/)(auth|login|session|token|password|secret|credential|payment|billing|crypto|tls|ssl|jwt|oauth)[^\/]*$/i;
export function buildParticipationPlan({subject,goalsDoc,registry,plan,skills}){
  assert(!subject||typeof subject==='string','invalid subject');
  const needs=[],gaps=[],notSelected=[];
  const analyzerIds=new Set((registry?.analyzers||[]).map(x=>x.id));
  const analyzerCaps=new Set();
  for(const a of registry?.analyzers||[])for(const c of a.capabilities||[])analyzerCaps.add(c);
  const findSkill=re=>(skills||[]).find(s=>re.test((s.name+' '+(s.summary||'')).toLowerCase()))||null;

  // 1) 质量目标的 producer 缺失 → GAP（必需）/needs（advisory）
  for(const goal of goalsDoc?.objectives||[]){
    const producer=goal.producer||null;
    if(producer&&analyzerIds.has(producer)){
      notSelected.push({capability:'quality.'+goal.metric,reason:'required analyzer producer "'+producer+'" is configured; deterministic tooling covers it'});
      continue;
    }
    const entry={capability:'quality.'+goal.metric,reason:(goal.type||'quality')+' goal "'+goal.id+'" has no analyzer producer',
      trigger:'quality-goal:'+goal.id,when:'before-implementation',harness:'any',mode:'advisory',
      permissions:['repo-read'],context_budget_chars:12000,
      output_contract:'dairn.agent-findings.v1'};
    if((goal.enforcement||'advisory')==='required')gaps.push({...entry,gap:'no deterministic producer for required goal; add an analyzer or adjust the trusted policy — risk is never lowered automatically'});
    else needs.push(entry);
  }
  // 2) 高风险安全敏感路径 → 建议安全审查能力（仅在无机器安全分析器时）
  const changePaths=plan?.change_paths||[];
  const securityTouched=changePaths.some(p=>SECURITY_PATH_HINTS.test(p));
  const hasSecurityAnalyzer=[...analyzerCaps].some(c=>/security/.test(c));
  if(securityTouched&&!hasSecurityAnalyzer){
    const secSkill=findSkill(/security|threat|audit/);
    const entry={capability:'security.threat-analysis',reason:'security-sensitive paths changed ('+changePaths.filter(p=>SECURITY_PATH_HINTS.test(p)).slice(0,3).join(', ')+')',
      trigger:'impact:security',when:'before-implementation',harness:'any',mode:'advisory',
      permissions:['repo-read'],context_budget_chars:12000,output_contract:'dairn.agent-findings.v1'};
    if(secSkill){needs.push({...entry,provider:secSkill.provider,provider_kind:'skill',completion:'findings-triaged-and-actionable'});}
    else gaps.push({...entry,gap:'no security skill installed and no security analyzer configured; agent advice can never replace trusted security checks'});
  }else if(!securityTouched){
    notSelected.push({capability:'security.threat-analysis',reason:'no security-sensitive surface in this change set'});
  }
  // 参与计划永不包含可提升信任的字段；只输出建议。
  return {schema:'dairn.participation-plan.v1',
    subject_commit:subject||null,
    needs,gaps,not_selected:notSelected,
    note:'advisory participation plan only: Dairn never starts models, grants permissions, or lets agent output approve anything'};
}
