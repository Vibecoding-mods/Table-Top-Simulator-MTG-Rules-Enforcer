@echo off
rem Builds companion\bin\MTG Companion.exe with the C# compiler that ships with Windows (.NET Framework 4.x).
rem No SDK, no NuGet. Run from anywhere:  companion\build.cmd     (then: "companion\bin\MTG Companion.exe" --selftest)
setlocal
set "HERE=%~dp0"
set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo csc.exe not found under %WINDIR%\Microsoft.NET\Framework64\v4.0.30319
  exit /b 1
)
if not exist "%HERE%bin" mkdir "%HERE%bin"
set "ICON="
if exist "%HERE%app.ico" set ICON=/win32icon:"%HERE%app.ico"
rem the release signing keys the self-update trusts (docs/companion-app-spec.md §18.7)
set "KEYS="
if exist "%HERE%release-keys.txt" set KEYS=/resource:"%HERE%release-keys.txt",release-keys.txt
"%CSC%" /nologo /target:winexe /optimize+ /langversion:5 /platform:anycpu /utf8output ^
  /out:"%HERE%bin\MTG Companion.exe" /win32manifest:"%HERE%app.manifest" %ICON% %KEYS% ^
  /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll ^
  /r:System.Management.dll /r:System.Web.Extensions.dll /r:System.Security.dll ^
  /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll ^
  "%HERE%src\*.cs"
if errorlevel 1 (
  echo build failed
  exit /b 1
)
echo built "%HERE%bin\MTG Companion.exe"
exit /b 0
