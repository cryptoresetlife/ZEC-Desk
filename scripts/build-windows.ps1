param([Parameter(Mandatory=$true)][string]$DependencyRoot,[Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$sourceDirectory=(Resolve-Path (Join-Path $PSScriptRoot '..\launcher')).Path
$dependencyDirectory=(Resolve-Path -LiteralPath $DependencyRoot).Path
$buildDirectory=[IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $buildDirectory -Force | Out-Null
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$launcher=Join-Path $sourceDirectory 'ZecDeskLauncher.cs'
$common=@('/nologo','/target:winexe','/platform:x64',('/win32icon:'+(Join-Path $dependencyDirectory 'ZEC Desk.ico')),'/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll')
& $compiler @common /main:ZecDeskLauncher ('/out:'+(Join-Path $buildDirectory 'ZEC Desk.exe')) $launcher
if($LASTEXITCODE -ne 0){throw 'Launcher compilation failed'}
& $compiler @common /main:ZecDeskWindow ('/out:'+(Join-Path $buildDirectory 'ZecDeskWindow.exe')) /reference:System.Web.Extensions.dll ('/reference:'+(Join-Path $dependencyDirectory 'Microsoft.Web.WebView2.Core.dll')) ('/reference:'+(Join-Path $dependencyDirectory 'Microsoft.Web.WebView2.WinForms.dll')) ('/resource:'+(Join-Path $sourceDirectory 'task-autofill.js')+',task-autofill.js') $launcher (Join-Path $sourceDirectory 'ZecDeskWindow.cs') (Join-Path $sourceDirectory 'ProjectTaskWindow.cs')
if($LASTEXITCODE -ne 0){throw 'Window compilation failed'}
