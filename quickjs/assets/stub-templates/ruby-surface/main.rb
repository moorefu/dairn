#!/usr/bin/env ruby
# Project-owned Ruby surface scanner, stdlib only, heuristic signatures.
require 'json'
require 'open3'
raise 'usage: analyzer REQUEST OUTPUT' unless ARGV.length == 2
r = JSON.parse(File.read(ARGV[0]))
raise 'invalid request' unless r['schema'] == 1 && r['kind'] == 'surface-analysis' && r['base_commit']
root = File.realpath(r.fetch('root'))
def git(root, *args, optional: false)
  out, err, st = Open3.capture3('git','-C',root,*args)
  raise "git failed: #{err}" unless st.success? || optional
  st.success? ? out : ''
end
def signatures(text)
  out = {}
  text.scan(/^\s*(?:(?:def|class|module)\s+)([a-zA-Z_][\w!?=]*)([^\n]*)/) do |name, tail|
    out["decl:#{name}"] = "#{name}#{tail}".strip[0,240]
  end
  out
end
files=git(root,'diff','--name-only','--diff-filter=ACDMRT',r['base_commit'],r['head_commit'],'--').lines.map(&:strip).reject(&:empty?)
raise 'too many files' if files.length > 500
changes=[]
files.each do |path|
  next unless path.end_with?('.rb') && !path.start_with?('/') && !path.split('/').include?('..')
  before=signatures(git(root,'show',"#{r['base_commit']}:#{path}",optional:true))
  full=File.expand_path(path,root)
  raise 'unsafe path' unless full.start_with?(root+'/')
  raise 'symlink refused' if File.symlink?(full)
  after=signatures(File.file?(full) ? File.read(full) : '')
  (before.keys|after.keys).sort.each do |symbol|
    next if before[symbol]==after[symbol]
    changes << {'path'=>path,'symbol'=>symbol,'change'=>!before.key?(symbol) ? 'added' : !after.key?(symbol) ? 'removed' : 'changed','before'=>before[symbol]||'','after'=>after[symbol]||''}
  end
end
File.write(ARGV[1],JSON.generate({'schema'=>1,'kind'=>r['kind'],'stub_id'=>r['stub_id'],'base_commit'=>r['base_commit'],'head_commit'=>r['head_commit'],'changes'=>changes})+"\n")
