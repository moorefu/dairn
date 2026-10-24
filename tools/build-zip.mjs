/* 由上游 QuickJS 自举生成嵌入运行时及 ZIP；完整源码仅用于内部暂存。 */
import * as std from 'std';
import * as os from 'os';
import {host} from '../quickjs/host/qjs.mjs';
import {sha256Bytes} from '../quickjs/core/sha256.mjs';
import {utf8,readBytes,writeBytes,zip,readZip} from './zip.mjs';

try {
  const options={root:host.cwd()};
  for(let i=1;i<scriptArgs.length;i+=2){
    const key=scriptArgs[i];if(!['--root','--out','--stage','--qjs','--version'].includes(key)||!scriptArgs[i+1])throw Error('用法：build --qjs 已校验解释器 --out 输出目录 --version 发布版本 [--stage 全新暂存目录]');
    options[key.slice(2)]=scriptArgs[i+1];
  }
  const root=host.realpath(options.root);
  // 版本以标签为准；没有标签（本地构建）时使用 package.json。
  let declared=(options.version||host.env('DAIRN_VERSION')||'').trim();
  if(!declared&&host.env('GITHUB_REF_TYPE')==='tag')declared=(host.env('GITHUB_REF_NAME')||'').trim();
  const pkg=JSON.parse(host.read(root+'/package.json'));
  const version=(declared||pkg.version).replace(/^v/,'');
  if(!/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:(?:alpha|beta|rc)\.(?:0|[1-9][0-9]*)|nightly\.[1-9][0-9]{13}))?$/.test(version))throw Error('发布版本格式无效：'+version);
  const absolute=p=>/^(?:[A-Za-z]:[\\/]|\/)/.test(p)?p:host.cwd()+'/'+p;
  const out=absolute(options.out||root+'/dist');host.mkdirs(out);
  if(!options.qjs)throw Error('缺少 --qjs，请通过 build.cmd、build.sh、Python 或 npm 入口获取 QuickJS');
  const quickjs=JSON.parse(host.read(root+'/quickjs.lock.json'));
  const input=readBytes(absolute(options.qjs));
  if(sha256Bytes(input)!==quickjs.binary_sha256)throw Error('QuickJS SHA256 与下载锁不一致');
  const release=JSON.parse(host.read(root+'/tools/release.json'));
  if(['version','npm_version','python_version'].some(key=>key in release))throw Error('版本只由标签或 package.json 的 version 决定，release.json 不得定义');
  release.version=version;
  const excluded=new Set(['dist','node_modules','__pycache__','.git','.pytest_cache']);
  const files=new Map();
  function walk(relative){
    if(relative.split('/').some(p=>excluded.has(p))||/\.(pyc|pyo)$/.test(relative))return;
    const p=root+'/'+relative,[st,err]=os.lstat(p);
    if(err)throw Error('缺少构建输入：'+relative);
    const type=st.mode&os.S_IFMT;
    if(type===os.S_IFLNK)throw Error('拒绝打包符号链接：'+relative);
    if(type===os.S_IFDIR){for(const name of host.list(p).sort())walk(relative+'/'+name);}
    else if(type===os.S_IFREG)files.set(relative,readBytes(p));
    else throw Error('构建输入不是普通文件：'+relative);
  }
  for(const p of release.source_paths){if(p.includes('..')||p.startsWith('/'))throw Error('非法构建路径');walk(p);}
  const manifest=JSON.parse(host.read(root+'/quickjs/assets/manifest.json'));
  manifest.version=release.version;
  // 资产清单从源码树自动发现：新增 Skill/Spec/Analyzer 模板无需再手工维护 manifest.assets。
  const assetTypes=['skills','specs','analyzer-templates'];
  function specId(path){ // Spec 稳定 ID 来自 frontmatter，供 `dairn docs find/show` 检索。
    const lines=host.read(root+'/'+path).split(/\r?\n/);
    if(!lines.length||lines[0].trim()!=='---')return null;
    for(let i=1;i<lines.length;i++){
      if(lines[i].trim()==='---')return null;
      const match=/^id:\s*(\S+)\s*$/.exec(lines[i]);if(match)return match[1];
    }
    return null;
  }
  const assets=[];
  for(const [path,data] of files){
    for(const type of assetTypes){
      const prefix='quickjs/assets/'+type+'/';
      if(!path.startsWith(prefix))continue;
      const rel=path.slice(prefix.length);
      // 只接纳各资产的合法文件，防止 README/图片/散落文件混入 manifest 后触发 lint 误报。
      if(type==='specs' && !rel.endsWith('.md')) break;
      if(type==='skills' && !/^[^/]+\/(?:SKILL\.md|agents\/[A-Za-z0-9._-]+\.ya?ml|references\/[^/]+\.(?:md|txt|json))$/.test(rel)) break;
      if(rel.split('/').some(part=>part.startsWith('.'))) break;
      const asset={type,path:rel,sha256:sha256Bytes(data)};
      if(type==='specs'){const id=specId(path);if(id)asset.id=id;}
      assets.push(asset);break;
    }
  }
  // 确定性顺序：type 固定顺序，再 path 字典序；保证构建字节可复现。
  assets.sort((a,b)=>assetTypes.indexOf(a.type)-assetTypes.indexOf(b.type)||(a.path<b.path?-1:a.path>b.path?1:0));
  manifest.assets=assets;
  const sources=[...files.keys()].filter(p=>p==='quickjs/main.mjs'||/^quickjs\/(core|host)\/[^/]+\.mjs$/.test(p)).sort();
  manifest.engine_sources=sources.map(path=>({path,sha256:sha256Bytes(files.get(path))}));
  files.set('quickjs/assets/manifest.json',utf8(JSON.stringify(manifest,null,2)+'\n'));
  const original=readZip(input);
  const embedded=sources.concat([...files.keys()].filter(p=>p.startsWith('quickjs/assets/'))).sort();
  const runtime=zip([
    ...original.entries.filter(e=>!e.name.startsWith('quickjs/')),
    ...embedded.map(name=>({name,data:files.get(name)}))
  ],original.prefix);
  const runtimeHash=sha256Bytes(runtime);
  files.set('dairn-embedded.com',runtime);
  files.set('runtime-integrity.json',utf8(JSON.stringify({schema:1,binary:'dairn-embedded.com',sha256:runtimeHash,engine_version:release.version,quickjs},null,2)+'\n'));
  files.set('runtime/runtime-build.json',utf8(JSON.stringify({
    description:'上游成品 QuickJS 自举嵌入与打包记录；本仓库不编译或打补丁',quickjs,
    ape_sha256:runtimeHash,native_prefix_sha256:sha256Bytes(original.prefix),
    manifest_sha256:sha256Bytes(files.get('quickjs/assets/manifest.json')),
    builder_sha256:sha256Bytes(files.get('tools/build-zip.mjs')),
    zip_helper_sha256:sha256Bytes(files.get('tools/zip.mjs'))
  },null,2)+'\n'));
  const mode=name=>/\.(sh|com)$/.test(name)||name==='dairn'||name==='bin/dairn.cjs'?0o100755:0o100644;
  const names=[...files.keys()].sort(),prefix=release.name+'-'+release.version+'/';
  const distribution=new Map([
    ['LICENSE',files.get('LICENSE')],
    ['dairn',files.get('dairn')],
    ['dairn.cmd',files.get('dairn.cmd')],
    ['.dairn/runtime/dairn-embedded.com',runtime],
    ['.dairn/runtime/runtime-integrity.json',files.get('runtime-integrity.json')],
    ...[...files].filter(([name])=>name.startsWith('licenses/'))
  ]);
  const artifact=out+'/'+release.name+'-'+release.version+'.zip';
  writeBytes(artifact,zip([...distribution.keys()].sort().map(name=>({name:prefix+name,data:distribution.get(name),mode:mode(name)}))));
  host.mkdirs(root+'/runtime');
  writeBytes(root+'/runtime/dairn-embedded.com',runtime);
  writeBytes(root+'/runtime/runtime-integrity.json',files.get('runtime-integrity.json'));
  if(options.stage){
    const stage=absolute(options.stage);if(host.exists(stage))throw Error('暂存目录必须尚不存在：'+stage);
    host.mkdirs(stage);
    // 内部暂存只传递文件内容；可执行权限由 ZIP、Wheel、sdist 和 npm 各自设置。
    for(const name of names){const path=stage+'/'+name;host.mkdirs(path.slice(0,path.lastIndexOf('/')));writeBytes(path,files.get(name));}
  }
  print(JSON.stringify({zip:artifact,files:distribution.size,ape_sha256:runtimeHash}));
  std.exit(0);
} catch(error){std.err.puts(String(error)+'\n'+(error.stack||''));std.exit(1);}
