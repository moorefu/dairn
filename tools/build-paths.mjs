/* 构建输出统一使用正斜杠；盘符路径不能被当作相对路径或截错父目录。 */
export function absoluteBuildPath(path,cwd){
  const normalized=path.replace(/\\/g,'/');
  return /^(?:[A-Za-z]:\/|\/)/.test(normalized)?normalized:cwd.replace(/\\/g,'/').replace(/\/$/,'')+'/'+normalized;
}
