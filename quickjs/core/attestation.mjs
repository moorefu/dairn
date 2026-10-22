/* Signed CI evidence verification: external trust anchor only. This is a detached
 * Ed25519 signature over a canonical JSON statement, not a DSSE envelope.
 * Signing keys are NEVER stored in the project, and Dairn never self-certifies a run.
 */
import {sha256} from './sha256.mjs';
const at=(a,b)=>a.replace(/\/$/,'')+'/'+b;
const ok=(v,m)=>{if(!v)throw Error('Attestation: '+m);};
const pathOk=p=>typeof p==='string'&&p.startsWith('/')&&!p.includes('\0');
const relOk=p=>typeof p==='string'&&p&&!p.startsWith('/')&&!p.includes('\\')&&!p.split('/').some(x=>x==='..'||x==='.'||!x);
function repoFile(h,root,p){ok(relOk(p),'unsafe evidence path');let c=root;for(const x of p.split('/')){c=at(c,x);ok(!h.isSymlink(c),'symlinked evidence path');}return c;}
export function statementFor(h,root,task,link){
  ok(link?.status==='passed','cannot attest failed run');
  const file=repoFile(h,root,link.path);ok(h.exists(file),'missing run');const raw=h.read(file);
  ok(sha256(raw)===link.sha256,'run evidence hash changed');
  const run=JSON.parse(raw);ok(run.status==='passed'&&run.head===link.commit&&run.policy_sha256===link.policy_sha256,'run fields changed');
  ok(run.checks?.length>0&&run.checks.every(c=>c.status==='passed'&&c.returncode===0),'checks are not all passing');
  return {schema:1,type:'dairn.ci.evidence.v1',task_id:task.id,run_id:link.run_id,source_commit:link.commit,
    base_commit:link.base_commit,policy_sha256:link.policy_sha256,run_sha256:link.sha256,
    runtime_sha256:run.runtime?.runtime_sha256,checks_sha256:sha256(JSON.stringify(run.checks)),
    // These identifiers are claims in the signed statement; trust depends on the protected signer.
    ci_provider:h.env('DAIRN_CI_PROVIDER')||null,ci_job_id:h.env('DAIRN_CI_JOB_ID')||null,
    ci_repository:h.env('DAIRN_CI_REPOSITORY')||null,ci_ref:h.env('DAIRN_CI_REF')||null,
    ci_workflow:h.env('DAIRN_CI_WORKFLOW')||null,ci_build_job_id:h.env('DAIRN_CI_BUILD_JOB_ID')||null,
    ci_pipeline_id:h.env('DAIRN_CI_PIPELINE_ID')||null};
}
export function prepareAttestation(h,root,task,link){
  const p=statementFor(h,root,task,link);
  ok(p.runtime_sha256,'missing runtime digest');ok(p.ci_provider&&p.ci_job_id,'CI provider/job identity required');
  if(h.env('DAIRN_REQUIRE_CI_CONTEXT')==='true')ok(p.ci_repository&&p.ci_ref&&p.ci_workflow&&p.ci_build_job_id&&p.ci_pipeline_id,'trusted repository, ref, workflow and build-job context required');
  if(h.env('GITHUB_ACTIONS')==='true'||h.env('GITLAB_CI')==='true'){
    ok(h.env('DAIRN_EXPECTED_POLICY_SHA256')===p.policy_sha256,'protected CI policy pin absent/mismatched');
    ok(h.env('DAIRN_EXPECTED_RUNTIME_SHA256')===p.runtime_sha256,'protected CI runtime pin absent/mismatched');
  }
  const base='.dairn/governance/evidence/'+link.run_id+'.attestation.json';
  const file=repoFile(h,root,base);ok(!h.exists(file),'attestation already exists');
  h.writeExclusive(file,JSON.stringify(p)+'\n');
  return {payload:base,payload_sha256:sha256(h.read(file)),status:'unsigned; sign on protected CI with external key'};
}
export function verifyAttestation(h,root,task,link,payloadRel,signatureRel){
  const key=h.env('DAIRN_TRUSTED_CI_PUBLIC_KEY');ok(key&&pathOk(key),'DAIRN_TRUSTED_CI_PUBLIC_KEY must be absolute, external, protected');
  ok(!key.startsWith(root+'/'),'trusted public key must not live inside PR workspace');ok(h.exists(key)&&!h.isSymlink(key),'trusted public key is missing/unsafe');
  const payload=repoFile(h,root,payloadRel),signature=repoFile(h,root,signatureRel);
  ok(h.exists(payload)&&h.exists(signature),'missing signed payload or signature');
  const text=h.read(payload);ok(text.length<=16384,'payload too large');
  const statement=JSON.parse(text);
  const expected=statementFor(h,root,task,link);
  ok(statement.schema===1&&statement.type===expected.type,'invalid attestation type');
  for(const f of ['task_id','run_id','source_commit','base_commit','policy_sha256','run_sha256','runtime_sha256','checks_sha256'])ok(statement[f]===expected[f],'mismatch '+f);
  ok(typeof statement.ci_provider==='string'&&statement.ci_provider.length>0&&typeof statement.ci_job_id==='string'&&statement.ci_job_id.length>0,'missing CI identity');
  const expectedProvider=h.env('DAIRN_TRUSTED_CI_PROVIDER');if(expectedProvider)ok(statement.ci_provider===expectedProvider,'unexpected CI provider');
  const job=h.env('DAIRN_TRUSTED_CI_JOB_ID');if(job)ok(statement.ci_job_id===job,'unexpected CI job identity');
  const scope=[['DAIRN_TRUSTED_CI_REPOSITORY','ci_repository'],['DAIRN_TRUSTED_CI_REF','ci_ref'],['DAIRN_TRUSTED_CI_WORKFLOW','ci_workflow'],['DAIRN_TRUSTED_CI_BUILD_JOB_ID','ci_build_job_id'],['DAIRN_TRUSTED_CI_PIPELINE_ID','ci_pipeline_id']];
  if(h.env('DAIRN_REQUIRE_CI_CONTEXT')==='true')for(const [key,field] of scope)ok(h.env(key),'missing external trusted '+key);
  for(const [key,field] of scope){const expected=h.env(key);if(expected)ok(statement[field]===expected,'CI identity scope mismatch: '+field);}
  const r=h.run(['openssl','pkeyutl','-verify','-pubin','-inkey',key,'-rawin','-in',payload,'-sigfile',signature],root,15);
  ok(!r.timedOut&&r.code===0,'signature verification failed');
  return {schema:1,status:'signature-verified',task_id:task.id,run_id:link.run_id,head:link.commit,
    statement_sha256:sha256(text),key_sha256:sha256(h.read(key)),payload:payloadRel,signature:signatureRel,
    provider:statement.ci_provider,job_id:statement.ci_job_id,repository:statement.ci_repository||null,ref:statement.ci_ref||null,workflow:statement.ci_workflow||null,build_job_id:statement.ci_build_job_id||null,pipeline_id:statement.ci_pipeline_id||null,assurance:'cryptographically signed by supplied protected key; CI authorization external'};
}
