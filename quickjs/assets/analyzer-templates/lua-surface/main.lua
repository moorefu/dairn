-- Project-owned LuaJIT/OpenResty scanner. Requires lua-cjson, Git; heuristic only.
local json = require('cjson.safe')
local function read(path) local f=assert(io.open(path,'rb'));local s=f:read('*a');f:close();return s end
local function write(path,data) local f=assert(io.open(path,'wb'));f:write(data);f:close() end
local function quote(s) return "'"..s:gsub("'","'\\''").."'" end
-- Input commits and paths are never interpreted as shell fragments; each value must be strictly vetted.
local function git(r,cmd,optional)
  local args={'git','-C',quote(r.root)}
  for _,x in ipairs(cmd) do assert(not x:find("[\r\n]"),'unsupported shell characters');table.insert(args,quote(x)) end
  local handle=assert(io.popen(table.concat(args,' ')..' 2>/dev/null','r'));local out=handle:read('*a');local ok=handle:close()
  if not ok and not optional then error('git command failed') end
  return ok and out or ''
end
local function surface(src)
 local ret={}
 for line in src:gmatch('[^\r\n]+') do
   local name=line:match('^%s*function%s+([%w_%.:]+)%s*%(') or line:match('^%s*([%w_%.]+)%s*=%s*function%s*%(')
   if name then ret['function:'..name]=line:gsub('%s+',' '):sub(1,200) end
 end
 return ret
end
local function main()
 assert(#arg==2,'usage: luajit main.lua REQUEST OUTPUT')
 local r=assert(json.decode(read(arg[1])));assert(r.schema=='dairn.analyzer-request.v1' and r.domain=='surface' and r.subject and r.subject.base_commit,'invalid request')
 assert(r.root:match('^/') and not r.root:find("['\r\n]"),'unsafe root')
 local out={schema='dairn.surface-result.v1',analyzer_id=r.analyzer_id,domain='surface',subject={source_commit=r.subject.source_commit,base_commit=r.subject.base_commit},changes={}}
 local names=git(r,{'diff','--name-only','--diff-filter=ACDMRT',r.subject.base_commit,r.subject.source_commit,'--'})
 local count=0
 for path in names:gmatch('[^\r\n]+') do
  count=count+1;assert(count<501,'too many paths')
  if path:match('%.lua$') and not path:find('%.%.',1,true) and not path:find("['\r\n]") then
   local before=surface(git(r,{'show',r.subject.base_commit..':'..path},true))
   local f=io.open(r.root..'/'..path,'rb');local code='';if f then code=f:read('*a');f:close() end
   local after=surface(code);local seen={};for k in pairs(before) do seen[k]=true end;for k in pairs(after) do seen[k]=true end
   for sym in pairs(seen) do if before[sym]~=after[sym] then table.insert(out.changes,{path=path,symbol=sym,change=not before[sym] and 'added' or not after[sym] and 'removed' or 'changed',before=before[sym] or '',after=after[sym] or ''}) end end
  end
 end
 write(arg[2],assert(json.encode(out))..'\n')
end
local ok,err=pcall(main);if not ok then io.stderr:write(tostring(err)..'\n');os.exit(2) end
