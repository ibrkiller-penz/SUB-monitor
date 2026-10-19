"""바로가기 패널: 자주 쓰는 프로그램을 컴퓨터에서 찾아 실행하고, 그 프로그램 본래 아이콘을 PNG 로 뽑아 쓴다 (Windows 전용).

찾는 순서 (PowerShell 한 번, 창 없이):
  ① config 의 path  ② 시작 메뉴·바탕화면 바로가기(.lnk) — 대상 exe·아이콘 위치까지 풀어 봄
  ③ 레지스트리 App Paths  ④ 레지스트리 설치 목록(Uninstall: DisplayIcon·InstallLocation)
  ⑤ Program Files·AppData 폴더 안 exe 이름 검색  ⑥ 스토어 앱(Get-StartApps / Appx 로고)
아이콘: 기본 6개는 web/apps/<id>.png 에 넣어 둔 공식 아이콘을 쓴다. 그 밖의 항목은 user32 PrivateExtractIcons 로 128px 를 뽑아 ~/.lesown_dashboard/icons2/<id>.png. 찾은 결과는 found.json 에 남긴다.
목록은 config.json > launchers 로 바꿀 수 있다 (id, name, exe[], keys[], path).
"""
import base64
import json
import os
import subprocess
import sys
import threading
from pathlib import Path

IS_WIN = sys.platform == "win32"
ICON_DIR = Path.home() / ".lesown_dashboard" / "icons2"
FOUND = ICON_DIR / "found.json"
APPS_WEB = Path(getattr(sys, "_MEIPASS", Path(__file__).parent)) / "web" / "apps"   # 프로그램에 넣어 둔 아이콘 (web/apps/<id>.png)

# 기본 바로가기 6개. exe: 실행 파일 이름, keys: 바로가기·설치 목록에서 찾을 이름(앞부분 일치)
DEFAULT_LAUNCHERS = [
    {"id": "cool", "name": "쿨메신저", "abbr": "쿨", "color": "#2b7de9", "fg": "#fff",
     "exe": ["CoolMessenger.exe", "CoolMsg.exe"], "keys": ["쿨메신저", "CoolMessenger", "Cool Messenger"]},
    {"id": "kakao", "name": "카카오톡", "abbr": "톡", "color": "#fee500", "fg": "#3a1d1d",
     "exe": ["KakaoTalk.exe"], "keys": ["카카오톡", "KakaoTalk"]},
    {"id": "claude", "name": "Claude", "abbr": "C", "color": "#d97757", "fg": "#fff",
     "exe": ["claude.exe"], "keys": ["Claude"]},
    {"id": "hwp", "name": "한글", "abbr": "한", "color": "#2a6fd6", "fg": "#fff",
     "exe": ["Hwp.exe"], "keys": ["한글", "한컴오피스 한글", "Hwp", "Hancom Office Hanword"]},
    {"id": "excel", "name": "엑셀", "abbr": "X", "color": "#1d6f42", "fg": "#fff",
     "exe": ["EXCEL.EXE"], "keys": ["Excel"]},
    {"id": "ppt", "name": "파워포인트", "abbr": "P", "color": "#c43e1c", "fg": "#fff",
     "exe": ["POWERPNT.EXE"], "keys": ["PowerPoint"]},
]

# 찾기·아이콘 뽑기 스크립트. 인자: spec.json 경로, 아이콘 폴더, 결과 json 경로
PS_SCRIPT = r'''
param([string]$SpecPath, [string]$OutDir, [string]$ResultPath)
$ErrorActionPreference = 'SilentlyContinue'
$spec = Get-Content -Raw -Encoding UTF8 $SpecPath | ConvertFrom-Json
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class IconX {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern uint PrivateExtractIcons(string f, int idx, int cx, int cy, IntPtr[] h, uint[] id, uint n, uint flags);
  [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr h);
}
"@
$wsh = New-Object -ComObject WScript.Shell
$BAD = @('uninstall','제거','삭제','viewer','뷰어','help','도움말','readme','설정','setting','update','업데이트','manual','설명서','web','웹')

function Save-Icon([string]$file, [int]$idx, [string]$png) {
  if (-not $file -or -not (Test-Path -LiteralPath $file)) { return $false }
  if ($file -match '\.(png|jpg)$') { Copy-Item -LiteralPath $file $png -Force; return (Test-Path $png) }
  $h = New-Object IntPtr[] 1; $ids = New-Object uint32[] 1
  $n = [IconX]::PrivateExtractIcons($file, $idx, 128, 128, $h, $ids, 1, 0)
  if ($n -ge 1 -and $n -ne 0xFFFFFFFF -and $h[0] -ne [IntPtr]::Zero) {
    $ic = [System.Drawing.Icon]::FromHandle($h[0]); $b = $ic.ToBitmap()
    $b.Save($png, [System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose(); [IconX]::DestroyIcon($h[0]) | Out-Null
    return $true
  }
  try { $b = ([System.Drawing.Icon]::ExtractAssociatedIcon($file)).ToBitmap(); $b.Save($png, [System.Drawing.Imaging.ImageFormat]::Png); return $true } catch {}
  return $false
}
function Split-IconLoc([string]$s) {
  if (-not $s) { return $null }
  $s = [Environment]::ExpandEnvironmentVariables($s.Trim().Trim('"'))
  $idx = 0
  if ($s -match '^(.*),\s*(-?\d+)$') { $s = $Matches[1].Trim().Trim('"'); $idx = [int]$Matches[2] }
  if ($s -and (Test-Path -LiteralPath $s)) { return @($s, $idx) }
  return $null
}
function Name-Ok([string]$stem, $keys) {
  $l = $stem.ToLower()
  foreach ($b in $BAD) { if ($l.Contains($b)) { return $false } }
  foreach ($k in $keys) { $k = $k.ToLower(); if ($l -eq $k -or $l.StartsWith($k + ' ') -or $l.StartsWith($k)) { return $true } }
  return $false
}
function Find-Exe([string]$dir, $exes, [int]$depth) {
  if (-not $dir -or -not (Test-Path -LiteralPath $dir)) { return $null }
  foreach ($e in $exes) {
    $hit = Get-ChildItem -LiteralPath $dir -Filter $e -Recurse -Depth $depth -File -ErrorAction SilentlyContinue |
           Where-Object { $_.FullName -notmatch '\\(WindowsApps|Installer|\$Recycle)' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($hit) { return $hit.FullName }
  }
  return $null
}

$lnkRoots = @([Environment]::GetFolderPath('StartMenu'), [Environment]::GetFolderPath('CommonStartMenu'),
              [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDesktopDirectory'),
              "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar")
$lnks = @(); foreach ($r in $lnkRoots) { if ($r -and (Test-Path $r)) { $lnks += Get-ChildItem -LiteralPath $r -Filter *.lnk -Recurse -File -ErrorAction SilentlyContinue } }
$uninst = @()
foreach ($k in 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*') {
  $uninst += Get-ItemProperty $k -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName }
}
$startApps = @(); try { $startApps = @(Get-StartApps) } catch {}
$scanRoots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, "$env:LOCALAPPDATA\Programs", $env:LOCALAPPDATA, $env:APPDATA, 'C:\')

$out = @{}
foreach ($it in $spec) {
  $r = @{ path = $null; launch = $null; icon = $false; how = '' }
  $png = Join-Path $OutDir ($it.id + '.png')
  $iconSrc = $null
  # ① 지정 경로
  if ($it.path) { $p = [Environment]::ExpandEnvironmentVariables($it.path); if (Test-Path -LiteralPath $p) { $r.path = $p; $r.how = 'config' } }
  # ② 바로가기(.lnk) — 이름이 짧은 것(가장 기본 항목) 우선
  if (-not $r.path) {
    $best = $lnks | Where-Object { Name-Ok $_.BaseName $it.keys } | Sort-Object { $_.BaseName.Length } | Select-Object -First 1
    if ($best) {
      $s = $wsh.CreateShortcut($best.FullName)
      $r.path = $best.FullName; $r.how = 'lnk'
      $iconSrc = Split-IconLoc $s.IconLocation
      $tgt = $s.TargetPath
      if (-not $iconSrc -and $tgt -and (Test-Path -LiteralPath $tgt)) {
        if ((Split-Path $tgt -Leaf) -match '^update\.exe$') { $x = Find-Exe (Split-Path $tgt) $it.exe 3; if ($x) { $iconSrc = @($x, 0) } }
        else { $iconSrc = @($tgt, 0) }
      }
      if (-not $iconSrc) { $iconSrc = @($best.FullName, 0) }
    }
  }
  # ③ App Paths
  if (-not $r.path) {
    foreach ($e in $it.exe) { foreach ($h in 'HKLM:','HKCU:') {
      $v = (Get-ItemProperty "$h\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$e" -ErrorAction SilentlyContinue).'(default)'
      if ($v) { $v = [Environment]::ExpandEnvironmentVariables($v.Trim('"')); if (Test-Path -LiteralPath $v) { $r.path = $v; $r.how = 'apppaths'; break } }
    } if ($r.path) { break } }
  }
  # ④ 설치 목록
  if (-not $r.path) {
    foreach ($u in ($uninst | Where-Object { Name-Ok $_.DisplayName $it.keys } | Sort-Object { $_.DisplayName.Length })) {
      $x = $null
      if ($u.InstallLocation) { $x = Find-Exe $u.InstallLocation.Trim('"') $it.exe 4 }
      if (-not $x -and $u.DisplayIcon) { $di = Split-IconLoc $u.DisplayIcon; if ($di -and ($it.exe -contains (Split-Path $di[0] -Leaf))) { $x = $di[0] } elseif ($di) { $x = Find-Exe (Split-Path $di[0]) $it.exe 3; if (-not $iconSrc) { $iconSrc = $di } } }
      if ($x) { $r.path = $x; $r.how = 'uninstall'; break }
    }
  }
  # ⑤ 폴더 검색
  if (-not $r.path) {
    foreach ($root in $scanRoots) { $d = 5; if ($root -eq 'C:\') { $d = 3 }; $x = Find-Exe $root $it.exe $d; if ($x) { $r.path = $x; $r.how = 'scan'; break } }
  }
  # ⑥ 스토어 앱
  if (-not $r.path) {
    $sa = $startApps | Where-Object { Name-Ok $_.Name $it.keys } | Sort-Object { $_.Name.Length } | Select-Object -First 1
    if ($sa) {
      $r.launch = 'shell:AppsFolder\' + $sa.AppID; $r.how = 'startapps'
      if ($sa.AppID -match '^([^!]+)!') {
        $fam = $Matches[1]; $pkg = Get-AppxPackage | Where-Object { $_.PackageFamilyName -eq $fam } | Select-Object -First 1
        if ($pkg) {
          [xml]$m = Get-Content -Raw -LiteralPath (Join-Path $pkg.InstallLocation 'AppxManifest.xml')
          $logo = $m.Package.Properties.Logo
          $ve = $m.Package.Applications.Application | Select-Object -First 1
          if ($ve.VisualElements.Square44x44Logo) { $logo = $ve.VisualElements.Square44x44Logo }
          if ($logo) {
            $lp = Join-Path $pkg.InstallLocation $logo; $base = [IO.Path]::GetFileNameWithoutExtension($lp); $dir = Split-Path $lp
            $cand = Get-ChildItem -LiteralPath $dir -Filter "$base*.png" -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch 'contrast' } | Sort-Object Length -Descending | Select-Object -First 1
            if ($cand) { $iconSrc = @($cand.FullName, 0) } elseif (Test-Path $lp) { $iconSrc = @($lp, 0) }
          }
          $x = Find-Exe $pkg.InstallLocation $it.exe 3; if ($x -and -not $iconSrc) { $iconSrc = @($x, 0) }
        }
      }
    }
  }
  if (-not $iconSrc -and $r.path) { $iconSrc = @($r.path, 0) }
  if ($iconSrc) { $r.icon = Save-Icon $iconSrc[0] $iconSrc[1] $png; $r.iconsrc = $iconSrc[0] }
  $out[$it.id] = $r
}
$out | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 $ResultPath
'''


def _no_window():
    if not IS_WIN:
        return {}
    si = subprocess.STARTUPINFO()
    si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    return dict(startupinfo=si, creationflags=subprocess.CREATE_NO_WINDOW)


class Launchers:
    def __init__(self, cfg_list=None, log=print):
        self.items = cfg_list or DEFAULT_LAUNCHERS
        self.log = log
        self.found = {}
        self._busy = False
        try:
            self.found = json.loads(FOUND.read_text(encoding="utf-8-sig"))
        except Exception:
            pass

    def refresh(self, force=False):
        """컴퓨터를 뒤져 경로·아이콘을 찾는다 (뒤에서). 아이콘이 다 있으면 건너뜀, force 면 다시."""
        if not IS_WIN or self._busy:
            return
        if not force and all((ICON_DIR / f"{it['id']}.png").exists() and (self.found.get(it["id"]) or {}).get("how") for it in self.items):
            return
        self._busy = True

        def work():
            try:
                ICON_DIR.mkdir(parents=True, exist_ok=True)
                if force:
                    for it in self.items:
                        (ICON_DIR / f"{it['id']}.png").unlink(missing_ok=True)
                spec = [{"id": it["id"], "exe": it.get("exe", []), "keys": it.get("keys", [it["name"]]), "path": it.get("path", "")} for it in self.items]
                sp, ps, rp = ICON_DIR / "spec.json", ICON_DIR / "find.ps1", ICON_DIR / "result.json"
                sp.write_text(json.dumps(spec, ensure_ascii=False), encoding="utf-8")
                ps.write_text(PS_SCRIPT, encoding="utf-8-sig")              # PowerShell 5.1 은 BOM 있어야 한글을 읽음
                rp.unlink(missing_ok=True)
                res = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
                                      "-File", str(ps), str(sp), str(ICON_DIR), str(rp)], capture_output=True, timeout=180, **_no_window())
                err = (res.stderr or b"").decode("utf-8", "replace").strip()
                if err:
                    self.log(f"launchers ps stderr: {err[:800]}")
                self.found = json.loads(rp.read_text(encoding="utf-8-sig"))
                FOUND.write_text(json.dumps(self.found, ensure_ascii=False, indent=1), encoding="utf-8")
                self.log("launchers: " + "; ".join(f"{k}={v.get('how') or '없음'} icon={v.get('icon')} {v.get('path') or v.get('launch') or ''}" for k, v in self.found.items()))
            except Exception as e:
                self.log(f"launchers refresh failed: {e}")
            finally:
                self._busy = False
        threading.Thread(target=work, daemon=True).start()

    def list(self):
        out = []
        for it in self.items:
            png = ICON_DIR / f"{it['id']}.png"
            icon = ""
            if (APPS_WEB / f"{it['id']}.png").exists():                   # 넣어 둔 아이콘이 우선
                icon = f"apps/{it['id']}.png"
            elif png.exists():
                try:
                    icon = "data:image/png;base64," + base64.b64encode(png.read_bytes()).decode()
                except Exception:
                    pass
            f = self.found.get(it["id"]) or {}
            out.append({"id": it["id"], "name": it["name"], "abbr": it.get("abbr", it["name"][:1]), "color": it.get("color", "#555"),
                        "fg": it.get("fg", "#fff"), "icon": icon, "found": bool(f.get("path") or f.get("launch")), "busy": self._busy})
        return out

    def launch(self, lid):
        it = next((x for x in self.items if x["id"] == lid), None)
        if not it or not IS_WIN:
            return {"ok": False, "error": "알 수 없는 프로그램"}
        f = self.found.get(lid) or {}
        try:
            if f.get("path") and os.path.exists(f["path"]):
                os.startfile(f["path"])                                   # exe 든 .lnk 든 그대로 실행
            elif f.get("launch"):
                subprocess.Popen(["explorer.exe", f["launch"]], **_no_window())   # 스토어 앱
            else:
                self.refresh(force=True)
                return {"ok": False, "error": f"{it['name']}을(를) 컴퓨터에서 찾는 중입니다. 잠시 뒤 다시 눌러 주세요"}
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}
