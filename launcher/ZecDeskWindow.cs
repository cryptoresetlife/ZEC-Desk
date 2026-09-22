using System;
using System.IO;
using System.Drawing;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Web.Script.Serialization;
using System.Collections.Generic;

// Own top-level window: taskbar identity and icon belong to ZEC Desk, not Edge.
class ZecDeskWindow : Form {
  const string Home="http://127.0.0.1:8793/";
  WebView2 view;
  bool checking;
  bool allowClose,closePending;
  readonly Timer timer=new Timer { Interval=3000 };
  [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
  static extern int SetCurrentProcessExplicitAppUserModelID(string appID);

  internal static bool IsHome(string value){
    Uri uri;return Uri.TryCreate(value,UriKind.Absolute,out uri)&&uri.Scheme=="http"&&uri.Host=="127.0.0.1"&&uri.Port==8793&&String.IsNullOrEmpty(uri.UserInfo);
  }
  static void External(string value){
    Uri uri;if(!Uri.TryCreate(value,UriKind.Absolute,out uri)||uri.Scheme!="https"||!String.IsNullOrEmpty(uri.UserInfo))return;
    try{Process.Start(new ProcessStartInfo(uri.AbsoluteUri){UseShellExecute=true});}catch{MessageBox.Show("无法打开链接，请在浏览器中打开对应项目页面。","ZEC Desk");}
  }
  static void OpenNoirChrome(){
    string chrome=null;
    foreach(var baseDir in new[]{Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)}){
      var candidate=Path.Combine(baseDir,"Google","Chrome","Application","chrome.exe");if(File.Exists(candidate)){chrome=candidate;break;}
    }
    if(chrome==null){MessageBox.Show("未找到 Chrome。请在安装 Noir 的 Chrome 地址栏打开 http://localhost:8793/#noirmint","ZEC Desk");return;}
    Process.Start(new ProcessStartInfo(chrome,"http://localhost:8793/#noirmint"){UseShellExecute=true});
  }
  ZecDeskWindow(){
    Text="ZEC Desk";Icon=Icon.ExtractAssociatedIcon(Application.ExecutablePath);
    Width=1380;Height=920;MinimumSize=new Size(900,650);
    StartPosition=FormStartPosition.CenterScreen;BackColor=Color.FromArgb(15,43,34);
    view=new WebView2 { Dock=DockStyle.Fill,DefaultBackgroundColor=BackColor };
    Controls.Add(view);Shown+=async(s,e)=>await Initialize();
    timer.Tick+=async(s,e)=>{
      if(checking)return;checking=true;
      try{
        int state=await Task.Run(()=>ZecDeskLauncher.Probe());
        if(IsDisposed||closePending)return;
        if(state==2||state==0){timer.Stop();allowClose=true;Close();}
      }finally{checking=false;}
    };
    FormClosing+=async(s,e)=>{
      if(allowClose)return;
      e.Cancel=true;if(closePending)return;closePending=true;timer.Stop();
      Text="ZEC Desk · 正在停止任务并退出…";Enabled=false;
      string error=await Task.Run(()=>ZecDeskLauncher.Shutdown());
      if(IsDisposed)return;
      if(error==null){allowClose=true;Close();}
      else{closePending=false;Enabled=true;Text="ZEC Desk";timer.Start();MessageBox.Show(this,error,"ZEC Desk · 退出未完成",MessageBoxButtons.OK,MessageBoxIcon.Information);}
    };
    FormClosed+=(s,e)=>{timer.Stop();timer.Dispose();view.Dispose();};
  }
  async Task Initialize(){
    try{
      var profile=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"data","webview2");
      var environment=await CoreWebView2Environment.CreateAsync(null,profile);
      if(IsDisposed)return;
      await view.EnsureCoreWebView2Async(environment);
      view.CoreWebView2.Settings.IsPasswordAutosaveEnabled=false;
      view.CoreWebView2.Settings.IsGeneralAutofillEnabled=false;
      view.CoreWebView2.Settings.AreDevToolsEnabled=false;
      view.CoreWebView2.WebMessageReceived+=(s,e)=>{
        if(!IsHome(e.Source))return;
        try{
          if(e.WebMessageAsJson.Length>8000)return;
          var message=new JavaScriptSerializer().Deserialize<Dictionary<string,string>>(e.WebMessageAsJson);
          if(message==null||!message.ContainsKey("type"))return;
          if(message["type"]=="noir.open"){OpenNoirChrome();return;}
          if(message["type"]!="project-task.open")return;
          ProjectTaskWindow.OpenTask(message["url"],message["name"],message["address"]);
          view.CoreWebView2.PostWebMessageAsJson("{\"type\":\"project-task.opened\"}");
        }catch(Exception){view.CoreWebView2.PostWebMessageAsJson("{\"type\":\"project-task.error\",\"message\":\"任务窗口未打开，请核对官网地址和钱包，或关闭多余任务窗口。\"}");}
      };
      view.CoreWebView2.NavigationStarting+=(s,e)=>{if(!IsHome(e.Uri)){e.Cancel=true;External(e.Uri);}};
      view.CoreWebView2.NewWindowRequested+=(s,e)=>{e.Handled=true;if(e.IsUserInitiated)External(e.Uri);};
      view.CoreWebView2.PermissionRequested+=(s,e)=>{e.State=CoreWebView2PermissionState.Deny;};
      view.CoreWebView2.DownloadStarting+=(s,e)=>{e.Cancel=true;};
      view.CoreWebView2.Navigate(Home);timer.Start();
    }catch(Exception){
      MessageBox.Show("独立窗口启动失败。请确认已完整解压，且电脑已安装 Microsoft Edge WebView2 Runtime。接下来会尝试正常退出当前后台。","ZEC Desk",MessageBoxButtons.OK,MessageBoxIcon.Information);
      Close();
    }
  }
  [STAThread] static void Main(){
    SetCurrentProcessExplicitAppUserModelID("ZecDesk.Desktop.V1");
    Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
    if(ZecDeskLauncher.Probe()!=1){MessageBox.Show("未找到当前文件夹的后台，请从 ZEC Desk.exe 启动。","ZEC Desk");return;}
    Application.Run(new ZecDeskWindow());
  }
}

