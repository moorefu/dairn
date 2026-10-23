// Project-owned Java public surface scanner. JDK 11+ source-file launch; heuristic, no type resolution.
import java.nio.file.*;
import java.util.*;
import java.util.regex.*;
import java.io.*;
public class Main {
  static String parse(String json,String key) {
    Matcher m=Pattern.compile("\""+Pattern.quote(key)+"\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"").matcher(json);
    if(!m.find())throw new IllegalArgumentException("missing "+key);
    return m.group(1).replace("\\/","/").replace("\\","\\");
  }
  static String escape(String s) { return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t") + "\""; }
  static String git(String root,boolean optional,String...args)throws Exception {
    List<String> cmd=new ArrayList<>(Arrays.asList("git","-C",root));Collections.addAll(cmd,args);
    Process p=new ProcessBuilder(cmd).redirectErrorStream(true).start();byte[] buf=p.getInputStream().readAllBytes();int code=p.waitFor();
    if(code!=0&&!optional)throw new IOException("git failure "+new String(buf));return code==0?new String(buf):"";
  }
  static Map<String,String> surface(String src){
    Map<String,String> out=new TreeMap<>();Matcher m=Pattern.compile("(?m)^\\s*public\\s+(?:(?:static|final|abstract|synchronized)\\s+)*(?:[\\w<>\\[\\], ?]+\\s+)?([\\w]+)\\s*(\\([^\\n]*|extends[^\\n]*|implements[^\\n]*|\\{)").matcher(src);
    while(m.find())out.put("public:"+m.group(1),m.group().trim().replaceAll("\\s+"," ").substring(0,Math.min(240,m.group().trim().replaceAll("\\s+"," ").length())));
    return out;
  }
  public static void main(String[] args)throws Exception {
    if(args.length!=2)throw new IllegalArgumentException("usage: Main REQUEST.json OUTPUT.json");
    String raw=Files.readString(Path.of(args[0])); if(!raw.contains("dairn.analyzer-request.v1"))throw new IllegalArgumentException("bad schema");
    String root=parse(raw,"root"),base=parse(raw,"base_commit"),head=parse(raw,"source_commit"),id=parse(raw,"analyzer_id"),domain=parse(raw,"domain");
    if(!domain.equals("surface")||base.isBlank())throw new IllegalArgumentException("bad request");
    String[] paths=git(root,false,"diff","--name-only","--diff-filter=ACDMRT",base,head,"--").split("\\R");
    if(paths.length>500)throw new IllegalArgumentException("too many files");List<String> changes=new ArrayList<>();
    Path project=Path.of(root).toRealPath();
    for(String rel:paths){if(!rel.endsWith(".java")||rel.startsWith("/")||rel.contains(".."))continue;
      Path file=project.resolve(rel).normalize();if(!file.startsWith(project)||Files.isSymbolicLink(file))throw new IllegalArgumentException("unsafe path");
      Map<String,String> before=surface(git(root,true,"show",base+":"+rel));
      Map<String,String> after=surface(Files.isRegularFile(file)?Files.readString(file):"");
      Set<String> syms=new TreeSet<>();syms.addAll(before.keySet());syms.addAll(after.keySet());
      for(String sym:syms){String a=before.get(sym),b=after.get(sym);if(Objects.equals(a,b))continue;
        String type=a==null?"added":b==null?"removed":"changed";
        changes.add("{\"path\":"+escape(rel)+",\"symbol\":"+escape(sym)+",\"change\":"+escape(type)+",\"before\":"+escape(a==null?"":a)+",\"after\":"+escape(b==null?"":b)+"}");
      }
    }
    String body="{\"schema\":\"dairn.surface-result-v1\",\"analyzer_id\":"+escape(id)+",\"domain\":\"surface\",\"subject\":{\"source_commit\":"+escape(head)+",\"base_commit\":"+escape(base)+"},\"changes\":["+String.join(",",changes)+"]}\n";
    Files.writeString(Path.of(args[1]),body);
  }
}
