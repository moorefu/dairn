<?php
// Project-owned PHP surface analyzer. PHP 7.4+, git. Regex is advisory, not semantic typing.
if ($argc !== 3) { fwrite(STDERR, "usage: php main.php REQUEST RESPONSE\n"); exit(2); }
$r = json_decode(file_get_contents($argv[1]), true, 512, JSON_THROW_ON_ERROR);
if (($r['schema'] ?? null) !== 'dairn.analyzer-request.v1' || ($r['domain'] ?? '') !== 'surface' || empty($r['subject']['base_commit'])) throw new RuntimeException('invalid request');
function gitrun(array $r, array $args, bool $optional=false): string {
    $cmd = array_merge(['git','-C',$r['root']],$args);
    $p = proc_open($cmd, [1=>['pipe','w'], 2=>['pipe','w']], $pipes);
    if(!is_resource($p))throw new RuntimeException('cannot start git');
    $out=stream_get_contents($pipes[1]);$err=stream_get_contents($pipes[2]);fclose($pipes[1]);fclose($pipes[2]);
    $status=proc_close($p);
    if($status!==0&&!$optional)throw new RuntimeException('git failed: '.$err);
    return $status===0?$out:'';
}
function surface(string $code): array {
    $out=[];
    // Public declarations only. Project teams may replace with token_get_all or a language server.
    preg_match_all('/^\s*(?:(?:final|abstract|public|protected|static)\s+)*(?:function|class|interface|trait)\s+([A-Za-z_][A-Za-z_0-9]*)[^\r\n]*/mi',$code,$hits,PREG_SET_ORDER);
    foreach($hits as $m)$out['decl:'.$m[1]]=substr(preg_replace('/\s+/',' ',trim($m[0])),0,240);
    return $out;
}
$names=explode("\n",trim(gitrun($r,['diff','--name-only','--diff-filter=ACDMRT',$r['subject']['base_commit'],$r['subject']['source_commit'],'--'])));
if(count($names)>500)throw new RuntimeException('too many paths');
$changes=[];$root=realpath($r['root']);
foreach($names as $path){
    if(!preg_match('/\.php$/i',$path)||strpos($path,'..')!==false||strpos($path,'\\')!==false||$path[0]==='/')continue;
    $before=surface(gitrun($r,['show',$r['subject']['base_commit'].':'.$path],true));
    $full=$root.'/'.$path;if(is_link($full))throw new RuntimeException('symlink refused');
    $after=surface(is_file($full)?file_get_contents($full):'');
    $all=array_unique(array_merge(array_keys($before),array_keys($after)));sort($all);
    foreach($all as $sym)if(($before[$sym]??null)!==($after[$sym]??null))$changes[]=['path'=>$path,'symbol'=>$sym,'change'=>!isset($before[$sym])?'added':(!isset($after[$sym])?'removed':'changed'),'before'=>$before[$sym]??'','after'=>$after[$sym]??''];
}
file_put_contents($argv[2],json_encode(['schema'=>'dairn.surface-result.v1','analyzer_id'=>$r['analyzer_id'],'domain'=>'surface','subject'=>['source_commit'=>$r['subject']['source_commit'],'base_commit'=>$r['subject']['base_commit']],'changes'=>$changes],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR)."\n");
