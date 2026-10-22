/* 自举构建所需的 ZIP32 存储写入器；读取时保留 APE 原有压缩资源。 */
import * as std from 'std';
export function utf8(text) {
  const result=[];
  for (const char of text) {
    const c=char.codePointAt(0);
    if(c<128)result.push(c);
    else if(c<2048)result.push(192|(c>>6),128|(c&63));
    else if(c<65536)result.push(224|(c>>12),128|((c>>6)&63),128|(c&63));
    else result.push(240|(c>>18),128|((c>>12)&63),128|((c>>6)&63),128|(c&63));
  }
  return new Uint8Array(result);
}
export function readBytes(path) {
  const f=std.open(path,'rb'); if(!f)throw Error('无法读取：'+path);
  try {
    if(f.seek(0,std.SEEK_END)!==0)throw Error('无法定位文件：'+path);
    const size=f.tell(); if(size<0 || size>0x7fffffff)throw Error('文件过大：'+path);
    f.seek(0,std.SEEK_SET);
    const data=new Uint8Array(size);
    if(f.read(data.buffer,0,size)!==size)throw Error('文件读取不完整：'+path);
    return data;
  } finally {f.close();}
}
export function writeBytes(path,data) {
  const f=std.open(path,'wb');if(!f)throw Error('无法写入：'+path);
  try {if(f.write(data.buffer,data.byteOffset,data.byteLength)!==data.length)throw Error('文件写入不完整：'+path);}
  finally {if(f.close()!==0)throw Error('文件关闭失败：'+path);}
}
const crcTable=new Uint32Array(256);
for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;crcTable[n]=c>>>0;}
function crc32(data){let c=0xffffffff;for(const x of data)c=crcTable[(c^x)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function join(chunks){const size=chunks.reduce((s,c)=>s+c.length,0);if(size>0xffffffff)throw Error('不支持 ZIP64');const out=new Uint8Array(size);let offset=0;for(const c of chunks){out.set(c,offset);offset+=c.length;}return out;}
function header(size){const data=new Uint8Array(size);return[data,new DataView(data.buffer)];}
export function zip(entries,prefix=new Uint8Array()) {
  if(entries.length>65535)throw Error('ZIP 条目过多');
  const chunks=[prefix], central=[];let offset=prefix.length;
  for(const entry of entries){
    const name=entry.nameBytes||utf8(entry.name),data=entry.data;
    if(name.length>65535)throw Error('ZIP 路径过长');
    const crc=entry.crc??crc32(data),size=entry.size??data.length,method=entry.method??0;
    const [local,l]=header(30);l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);
    l.setUint16(6,0x800,true);l.setUint16(8,method,true);l.setUint16(12,0x5d56,true);
    l.setUint32(14,crc,true);l.setUint32(18,data.length,true);l.setUint32(22,size,true);l.setUint16(26,name.length,true);
    chunks.push(local,name,data);
    const [record,c]=header(46);c.setUint32(0,0x02014b50,true);c.setUint16(4,0x314,true);c.setUint16(6,20,true);
    c.setUint16(8,0x800,true);c.setUint16(10,method,true);c.setUint16(14,0x5d56,true);
    c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,size,true);c.setUint16(28,name.length,true);
    c.setUint32(38,((entry.mode??0o100644)<<16)>>>0,true);c.setUint32(42,offset,true);
    central.push(record,name);offset+=local.length+name.length+data.length;
  }
  const directory=join(central),[end,e]=header(22);
  e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);
  e.setUint32(12,directory.length,true);e.setUint32(16,offset,true);
  return join([...chunks,directory,end]);
}
export function readZip(data){
  const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
  let end=data.length-22;
  for(;end>=Math.max(0,data.length-65557);end--)if(view.getUint32(end,true)===0x06054b50 && end+22+view.getUint16(end+20,true)===data.length)break;
  if(end<Math.max(0,data.length-65557))throw Error('找不到 ZIP 目录');
  if(view.getUint16(end+4,true)||view.getUint16(end+6,true))throw Error('不支持分卷 ZIP');
  const count=view.getUint16(end+10,true),directorySize=view.getUint32(end+12,true);
  if(count===65535||directorySize===0xffffffff)throw Error('不支持 ZIP64');
  let position=end-directorySize;const bias=position-view.getUint32(end+16,true),entries=[];
  let prefix=position;
  for(let i=0;i<count;i++){
    if(view.getUint32(position,true)!==0x02014b50)throw Error('ZIP 目录损坏');
    const flags=view.getUint16(position+8,true),method=view.getUint16(position+10,true);
    if(flags&1||![0,8].includes(method))throw Error('不支持此 ZIP 压缩格式');
    const packed=view.getUint32(position+20,true),size=view.getUint32(position+24,true);
    const n=view.getUint16(position+28,true),extra=view.getUint16(position+30,true),comment=view.getUint16(position+32,true);
    const start=view.getUint32(position+42,true)+bias;
    if(view.getUint32(start,true)!==0x04034b50)throw Error('ZIP 条目损坏');
    const content=start+30+view.getUint16(start+26,true)+view.getUint16(start+28,true);
    if(content+packed>position||size===0xffffffff)throw Error('ZIP 条目范围错误');
    const nameBytes=data.slice(position+46,position+46+n);
    const name=String.fromCharCode(...nameBytes); // APE 保留资源路径均为 ASCII。
    entries.push({name,nameBytes,data:data.slice(content,content+packed),size,method,crc:view.getUint32(position+16,true),mode:view.getUint32(position+38,true)>>>16});
    prefix=Math.min(prefix,start);position+=46+n+extra+comment;
  }
  if(position!==end)throw Error('ZIP 目录长度错误');
  return {prefix:data.slice(0,prefix),entries};
}
