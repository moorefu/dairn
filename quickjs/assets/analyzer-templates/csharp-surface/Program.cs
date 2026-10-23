// Project-owned C# surface analyzer. .NET SDK 8+, Git. Regex is advisory; prefer Roslyn for production.
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Diagnostics;
using System.Text;
record Change(string path,string symbol,string change,string before,string after);
class Program {
 static string Git(string root,bool optional,params string[] args){
  var psi=new ProcessStartInfo("git"){RedirectStandardOutput=true,RedirectStandardError=true,UseShellExecute=false};
  psi.ArgumentList.Add("-C");psi.ArgumentList.Add(root);foreach(var x in args)psi.ArgumentList.Add(x);
  using var p=Process.Start(psi) ?? throw new Exception("git start failed");
  string stdout=p.StandardOutput.ReadToEnd();string stderr=p.StandardError.ReadToEnd();p.WaitForExit();
  if(p.ExitCode!=0&&!optional)throw new Exception("git failed: "+stderr);
  return p.ExitCode==0?stdout:"";
 }
 static Dictionary<string,string> Surface(string code){
  var found=new Dictionary<string,string>();
  foreach(Match m in Regex.Matches(code,@"(?m)^\s*public\s+(?:(?:static|async|abstract|sealed|virtual|override|partial)\s+)*(?:(?:class|record|interface|struct|enum)\s+\w+|[\w<>,?\[\]]+\s+\w+\s*\([^\r\n]*)")){
   string signature=Regex.Replace(m.Value.Trim(),@"\s+"," ");
   var parts=Regex.Matches(signature,@"[\w]+\b").Select(x=>x.Value).ToList();
   string name=parts.Count>0?parts.Last():"unknown";
   var paren=signature.IndexOf('(');if(paren>0){var before=signature.Substring(0,paren);name=Regex.Matches(before,@"\w+").Last().Value;}
   if(name.Length>0) found["public:"+name]=signature[..Math.Min(240,signature.Length)];
  }
  return found;
 }
 static int Main(string[] args){
  try{
   if(args.Length!=2)throw new Exception("usage: Surface REQUEST.json OUTPUT.json");
   using var doc=JsonDocument.Parse(File.ReadAllText(args[0]));var r=doc.RootElement;
   if(r.GetProperty("schema").GetString()!="dairn.analyzer-request.v1"||r.GetProperty("domain").GetString()!="surface")throw new Exception("invalid request");
   var root=r.GetProperty("root").GetString()!;var baseline=r.GetProperty("subject").GetProperty("base_commit").GetString();
   var head=r.GetProperty("subject").GetProperty("source_commit").GetString()!;if(string.IsNullOrEmpty(baseline))throw new Exception("base_commit required");
   var id=r.GetProperty("analyzer_id").GetString()!;
   var files=Git(root,false,"diff","--name-only","--diff-filter=ACDMRT",baseline,head,"--").Split('\n',StringSplitOptions.RemoveEmptyEntries);
   if(files.Length>500)throw new Exception("too many files");var changes=new List<Change>();
   foreach(var path in files){if(!path.EndsWith(".cs")||path.StartsWith('/')||path.Split('/').Contains(".."))continue;
    var old=Surface(Git(root,true,"show",baseline+":"+path));var filename=Path.Combine(root,path);
    if(File.Exists(filename)&&File.GetAttributes(filename).HasFlag(FileAttributes.ReparsePoint))throw new Exception("symlink refused");
    var updated=Surface(File.Exists(filename)?File.ReadAllText(filename):"");
    foreach(var sym in old.Keys.Union(updated.Keys).OrderBy(x=>x)){
     old.TryGetValue(sym,out var before);updated.TryGetValue(sym,out var after);
     if(before==after)continue;
     changes.Add(new Change(path,sym,before==null?"added":after==null?"removed":"changed",before??"",after??""));
    }
   }
   var payload=new{schema="dairn.surface-result.v1",analyzer_id=id,domain="surface",subject=new{source_commit=head,base_commit=baseline},changes};
   File.WriteAllText(args[1],JsonSerializer.Serialize(payload)+"\n");return 0;
  }catch(Exception ex){Console.Error.WriteLine(ex.Message);return 2;}
 }
}
