using System;
using System.IO;
using System.Net;
using System.Diagnostics;
using System.Threading;
using System.Windows.Forms;
using System.Drawing;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Net.NetworkInformation;
using System.Threading.Tasks;
class ZecDeskLauncher {
  static string Root=AppDomain.CurrentDomain.BaseDirectory;
  static string Url="http://127.0.0.1:8793/";
  static Process Child;
  static string InstanceFor(string root){using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar,Path.AltDirectorySeparatorChar).ToLowerInvariant()))).Replace("-","").ToLowerInvariant();}
  static int Classify(string body){return Regex.IsMatch(body,"\"app\"\\s*:\\s*\"zec-desk\"")&&Regex.IsMatch(body,"\"instanceId\"\\s*:\\s*\""+InstanceFor(Root)+"\"")?1:2;}
  // 0 = no listener, 1 = this folder, 2 = another service, 3 = unverified. Never open
  // another copy's in-memory wallets just because its app name matches.
  internal static int Probe(){
    try{
      int port=new Uri(Url).Port;bool listening=false;
      foreach(var endpoint in IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners()){
        if(endpoint.Port==port&&(IPAddress.IsLoopback(endpoint.Address)||endpoint.Address.Equals(IPAddress.Any)||endpoint.Address.Equals(IPAddress.IPv6Any))){listening=true;break;}
      }
      // A refused loopback connection can take longer than 800 ms on Windows.
      // Check the OS listener table instead of interpreting HTTP timeout as use.
      if(!listening)return 0;
      var r=(HttpWebRequest)WebRequest.Create(Url+"health");r.Proxy=null;r.Timeout=3000;r.ReadWriteTimeout=3000;r.AllowAutoRedirect=false;
      using(var response=r.GetResponse())using(var s=new StreamReader(response.GetResponseStream()))return Classify(s.ReadToEnd());
    }catch(WebException e){return e.Status==WebExceptionStatus.ConnectFailure?0:e.Status==WebExceptionStatus.ProtocolError?2:3;}catch{return 3;}
  }
  // Use the same authenticated graceful-exit route as the page. Never kill a
  // process by port or shut down a backend belonging to another installation.
  internal static string Shutdown(){
    try{
      int state=Probe();if(state==0)return null;
      if(state!=1)return "后台不属于当前文件夹或暂时无法核实，未关闭其他程序。请稍后重试。";
      var page=(HttpWebRequest)WebRequest.Create(Url);page.Proxy=null;page.Timeout=5000;page.ReadWriteTimeout=5000;page.AllowAutoRedirect=false;
      string html;using(var response=page.GetResponse())using(var reader=new StreamReader(response.GetResponseStream()))html=reader.ReadToEnd();
      var match=Regex.Match(html,"name=\"session-token\" content=\"([a-f0-9]{64})\"");
      if(!match.Success||Probe()!=1)return "无法核实退出凭据，请在软件左下角点击停止并退出。";
      var request=(HttpWebRequest)WebRequest.Create(Url+"api/exit");request.Proxy=null;request.Timeout=75000;request.ReadWriteTimeout=75000;request.AllowAutoRedirect=false;
      request.Method="POST";request.ContentType="application/json";request.Headers["x-zec-desk"]=match.Groups[1].Value;request.Headers["Origin"]=new Uri(Url).GetLeftPart(UriPartial.Authority);
      byte[] payload=Encoding.UTF8.GetBytes("{}");request.ContentLength=payload.Length;
      using(var stream=request.GetRequestStream())stream.Write(payload,0,payload.Length);
      using(var response=request.GetResponse())using(var reader=new StreamReader(response.GetResponseStream())){
        if(!Regex.IsMatch(reader.ReadToEnd(),"\"ok\"\\s*:\\s*true"))return "后台尚未确认退出，请稍后重试。";
      }
      for(int i=0;i<40;i++){if(Probe()==0)return null;Thread.Sleep(250);}
      return "正在等待后台释放端口。请稍后再关闭窗口；不会强行结束钱包。";
    }catch(WebException e){
      if(Probe()==0)return null;
      var response=e.Response as HttpWebResponse;
      if(response!=null&&response.StatusCode==HttpStatusCode.BadRequest)return "正在启动钱包、核对或发送交易，暂时不能退出。请等待当前操作结束后再关闭。";
      return "后台尚未完成退出，请稍后重试或使用左下角停止并退出。钱包进程未被强行结束。";
    }catch{return "无法完成正常退出，请稍后重试；没有强行结束钱包。";}
  }
  static void Open(){
    var window=Path.Combine(Root,"ZecDeskWindow.exe");
    if(!File.Exists(window))throw new Exception("缺少 ZecDeskWindow.exe，请完整解压新版安装包。");
    Process.Start(new ProcessStartInfo(window){WorkingDirectory=Root,UseShellExecute=true});
  }
  [STAThread] static void Main(){
    Application.EnableVisualStyles();
    int existing=Probe();
    if(existing==1){Open();return;}
    if(existing==2){MessageBox.Show("8793 端口已有另一份 ZEC Desk、旧版后台或其他服务。为避免显示另一文件夹的 任务记录和钱包，本次没有打开它。\n\n请先在原软件左下角点击“停止任务并退出软件”，等后台退出后，再打开这份 ZEC Desk.exe。退出后需要重新连接独立钱包；正在运行的任务请先自行处理。","ZEC Desk · 后台冲突",MessageBoxButtons.OK,MessageBoxIcon.Information);return;}
    if(existing==3){MessageBox.Show("无法核实本机 8793 端口上的服务，可能是服务正在启动或响应超时。本次没有打开其他后台。请稍后重试。","ZEC Desk · 后台检查未完成",MessageBoxButtons.OK,MessageBoxIcon.Information);return;}
    var exe=Path.Combine(Root,"runtime","node.exe");var entry=Path.Combine(Root,"server.mjs");
    if(!File.Exists(exe)||!File.Exists(entry)){MessageBox.Show("请先完整解压 ZIP，再打开 ZEC Desk.exe。","ZEC Desk");return;}
    try{
      Child=Process.Start(new ProcessStartInfo(exe,"\""+entry+"\""){WorkingDirectory=Root,UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden});
      for(int i=0;i<60&&Probe()!=1;i++){if(Child.HasExited)throw new Exception("软件服务启动失败，请确认已完整解压，并检查是否已有旧版后台占用 8793 端口。");Thread.Sleep(250);}
      if(Probe()!=1)throw new Exception("本机服务未就绪或后台不属于当前文件夹，请检查 8793 端口。");
      Open();
      var tray=new NotifyIcon{Icon=Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application,Text="ZEC Desk · 双击打开",Visible=true};
      tray.DoubleClick+=(s,e)=>Open();var menu=new ContextMenu();menu.MenuItems.Add("打开 ZEC Desk",(s,e)=>Open());
      var quit=new MenuItem("停止任务并退出 ZEC Desk");quit.Click+=async(s,e)=>{quit.Enabled=false;string error=await Task.Run(()=>Shutdown());if(error!=null){MessageBox.Show(error,"ZEC Desk · 退出未完成",MessageBoxButtons.OK,MessageBoxIcon.Information);quit.Enabled=true;}else{tray.Visible=false;Application.Exit();}};menu.MenuItems.Add(quit);tray.ContextMenu=menu;
      var timer=new System.Windows.Forms.Timer{Interval=1000};timer.Tick+=(s,e)=>{if(Child.HasExited){tray.Visible=false;Application.Exit();}};timer.Start();Application.Run();tray.Dispose();
    }catch(Exception e){MessageBox.Show(e.Message,"ZEC Desk",MessageBoxButtons.OK,MessageBoxIcon.Error);}
  }
}

