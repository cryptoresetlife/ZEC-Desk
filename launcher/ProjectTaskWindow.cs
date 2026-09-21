using System;
using System.IO;
using System.Drawing;
using System.Diagnostics;
using System.Net;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

// Untrusted websites live in a separate WebView/profile with no host bridge.
class ProjectTaskWindow : Form {
  readonly WebView2 web=new WebView2 { Dock=DockStyle.Fill };
  readonly TextBox locationBox=new TextBox { Dock=DockStyle.Fill,ReadOnly=true };
  readonly Label status=new Label { Dock=DockStyle.Bottom,Height=52,Padding=new Padding(8),ForeColor=Color.FromArgb(222,231,181) };
  readonly CheckBox automatic=new CheckBox { Text="自动填写此官网的空地址栏",AutoSize=true,Checked=true,ForeColor=Color.White };
  readonly Timer fillTimer=new Timer { Interval=1800 };
  readonly string original,allowedOrigin,address;
  readonly JavaScriptSerializer json=new JavaScriptSerializer();
  CoreWebView2Environment environment;
  readonly TaskCompletionSource<bool> ready=new TaskCompletionSource<bool>();
  readonly bool isPopup;
  bool filling;
  string script;
  static int openCount;
  internal static bool PublicPage(string value){
    Uri u;IPAddress ip;
    return value!=null&&value.Length<=2000&&Uri.TryCreate(value,UriKind.Absolute,out u)&&u.Scheme=="https"&&u.IsDefaultPort&&String.IsNullOrEmpty(u.UserInfo)&&!u.IsLoopback&&!IPAddress.TryParse(u.Host,out ip)&&u.Host.Contains(".")&&!Regex.IsMatch(u.Host,@"(^|\.)(localhost|local|internal|test|invalid)$",RegexOptions.IgnoreCase);
  }
  internal static bool PublicAddress(string value){return value!=null&&Regex.IsMatch(value,@"^(u1[023456789acdefghjklmnpqrstuvwxyz]{50,500}|zs[023456789acdefghjklmnpqrstuvwxyz]{50,150}|t[13][1-9A-HJ-NP-Za-km-z]{33})$");}
  internal static void OpenTask(string url,string name,string wallet){
    if(!PublicPage(url)||(!String.IsNullOrEmpty(wallet)&&!PublicAddress(wallet)))throw new Exception("请核对 HTTPS 官网和 Zcash 收款地址。");
    if(openCount>=6)throw new Exception("最多同时打开 6 个任务窗口，请先关闭不用的窗口。");
    var form=new ProjectTaskWindow(url,name,wallet);form.Show();
  }
  ProjectTaskWindow(string url,string name,string wallet,CoreWebView2Environment shared=null){
    environment=shared;isPopup=shared!=null;
    original=url;allowedOrigin=new Uri(url).GetLeftPart(UriPartial.Authority);address=wallet??"";openCount++;
    Text="项目任务 · "+(String.IsNullOrWhiteSpace(name)?new Uri(url).Host:name.Substring(0,Math.Min(name.Length,100)));
    Icon=Icon.ExtractAssociatedIcon(Application.ExecutablePath);Width=1200;Height=880;MinimumSize=new Size(900,650);BackColor=Color.FromArgb(15,43,34);
    var toolbar=new FlowLayoutPanel { Dock=DockStyle.Top,Height=76,Padding=new Padding(8),AutoScroll=true };
    Button back=ButtonOf("后退"),reload=ButtonOf("刷新"),home=ButtonOf("项目首页"),copy=ButtonOf("复制钱包地址"),fill=ButtonOf("填写钱包"),external=ButtonOf("在浏览器打开");
    toolbar.Controls.AddRange(new Control[]{back,reload,home,copy,fill,external,automatic});
    back.Click+=(s,e)=>{if(web.CoreWebView2!=null&&web.CoreWebView2.CanGoBack)web.CoreWebView2.GoBack();};
    reload.Click+=(s,e)=>{if(web.CoreWebView2!=null)web.Reload();};
    home.Click+=(s,e)=>{if(web.CoreWebView2!=null)web.CoreWebView2.Navigate(original);};
    copy.Enabled=fill.Enabled=automatic.Enabled=address.Length>0;automatic.Checked=address.Length>0;
    copy.Click+=(s,e)=>{Clipboard.SetText(address);status.Text="已复制所选公开地址。请核对页面用途后粘贴；提交不会由软件代点。";};
    fill.Click+=async(s,e)=>await Fill();
    external.Click+=(s,e)=>{var target=web.Source==null?original:web.Source.AbsoluteUri;if(PublicPage(target))Process.Start(new ProcessStartInfo(target){UseShellExecute=true});};
    var addressLabel=new Label { Dock=DockStyle.Top,Height=44,Padding=new Padding(8),ForeColor=Color.FromArgb(222,231,181),AutoEllipsis=true,Text="填写授权网站："+allowedOrigin+"   钱包："+(address.Length>0?address:"未选择（仅浏览）") };
    var urlPanel=new Panel { Dock=DockStyle.Top,Height=30,Padding=new Padding(8,2,8,2) };urlPanel.Controls.Add(locationBox);
    Controls.Add(web);Controls.Add(status);Controls.Add(addressLabel);Controls.Add(urlPanel);Controls.Add(toolbar);
    status.Text="任务请在网页内操作。内置页面不提供 Noir 插件；需要插件连接或签名时请在浏览器打开。";
    fillTimer.Tick+=async(s,e)=>{if(automatic.Checked&&Visible)await Fill();};
    Shown+=async(s,e)=>await Initialize();FormClosed+=(s,e)=>{ready.TrySetResult(false);fillTimer.Stop();fillTimer.Dispose();web.Dispose();openCount--;};
  }
  static Button ButtonOf(string text){return new Button {Text=text,AutoSize=true,Height=30,BackColor=Color.FromArgb(191,205,145),ForeColor=Color.FromArgb(15,43,34)};}
  async Task Initialize(){
    try{
      using(var stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("task-autofill.js"))using(var reader=new StreamReader(stream))script=await reader.ReadToEndAsync();
      if(environment==null)environment=await CoreWebView2Environment.CreateAsync(null,Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"data","task-webview2"));
      if(IsDisposed)return;await web.EnsureCoreWebView2Async(environment);
      var core=web.CoreWebView2;core.Settings.IsPasswordAutosaveEnabled=false;core.Settings.IsGeneralAutofillEnabled=false;core.Settings.AreDevToolsEnabled=false;core.Settings.IsWebMessageEnabled=false;core.Settings.AreHostObjectsAllowed=false;
      core.PermissionRequested+=(s,e)=>{e.State=CoreWebView2PermissionState.Deny;};core.DownloadStarting+=(s,e)=>{e.Cancel=true;status.Text="内置任务窗口不下载文件；如确有需要，请在浏览器核对来源后操作。";};
      core.NavigationStarting+=(s,e)=>{if(!PublicPage(e.Uri)){e.Cancel=true;status.Text="仅允许公开 HTTPS 页面，已阻止本机地址或自定义协议。";}};
      core.SourceChanged+=(s,e)=>{locationBox.Text=core.Source;};
      core.NewWindowRequested+=async(s,e)=>{
        e.Handled=true;if(!e.IsUserInitiated||!PublicPage(e.Uri))return;
        var deferral=e.GetDeferral();
        try{
          // OAuth popups retain their opener but receive no wallet autofill or host APIs.
          if(openCount>=6){status.Text="请先关闭不用的任务窗口再打开登录页。";return;}
          var popup=new ProjectTaskWindow(e.Uri,"登录 / 项目链接","",environment);
          popup.Show();
          if(!await popup.ready.Task)throw new Exception("popup unavailable");
          e.NewWindow=popup.web.CoreWebView2;
          popup.web.CoreWebView2.WindowCloseRequested+=(a,b)=>popup.Close();
        }catch{status.Text="此登录弹窗无法在内置页打开，请改用外部浏览器。";}finally{deferral.Complete();}
      };
      core.NavigationCompleted+=async(s,e)=>{if(!e.IsSuccess){status.Text="网页未加载成功，可刷新或在浏览器打开。";return;}if(automatic.Checked)await Fill();};
      ready.TrySetResult(true);if(!isPopup)core.Navigate(original);fillTimer.Start();
    }catch{ready.TrySetResult(false);if(!IsDisposed)status.Text="任务窗口初始化失败，请确认 WebView2 Runtime 已安装，或使用外部浏览器。";}
  }
  async Task Fill(){
    if(filling||String.IsNullOrEmpty(address)||web.CoreWebView2==null||String.IsNullOrEmpty(script)||IsDisposed)return;
    Uri current;if(!Uri.TryCreate(web.CoreWebView2.Source,UriKind.Absolute,out current)||current.GetLeftPart(UriPartial.Authority)!=allowedOrigin){status.Text="已跳转到其他网站，自动填写已暂停；返回授权官网后恢复。";return;}
    filling=true;
    try{
      var raw=await web.CoreWebView2.ExecuteScriptAsync(script+"("+json.Serialize(allowedOrigin)+","+json.Serialize(address)+")");
      if(IsDisposed)return;var result=json.Deserialize<System.Collections.Generic.Dictionary<string,object>>(raw);string kind=result.ContainsKey("status")?Convert.ToString(result["status"]):"";
      status.Text=kind=="filled"||kind=="present"?"已填写所选钱包地址。请核对完整地址并自行提交，软件没有点击提交或完成社交任务。":kind=="occupied"?"地址栏已有内容，未覆盖。请自行核对；需要更换时先清空地址栏。":kind=="ambiguous"?"发现多个地址栏，未自动填写。请复制钱包地址并选择正确栏位。":kind=="too-long"?"此栏位长度不足，可能不支持当前地址类型。请查看项目要求。":kind=="not-found"?"尚未出现明确的地址栏。你完成前置任务后会继续检查；也可复制地址手动填写。":"地址未填写，请检查页面要求或手动粘贴。";
    }catch{if(!IsDisposed)status.Text="页面暂时无法自动填写，可复制地址后手动粘贴。";}finally{filling=false;}
  }
}
