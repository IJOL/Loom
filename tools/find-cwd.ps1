# Find which processes have their current directory inside a given path.
#
# Windows refuses to delete a directory that any process holds as its working
# directory, and the error names neither the process nor the path. Task Manager
# does not show a working directory either, and WMI's Win32_Process has no such
# field. This reads it where it actually lives: the process's PEB.
#
# Typical use - a worktree that will not delete:
#   powershell -File tools/find-cwd.ps1 my-worktree-name
#   powershell -File tools/find-cwd.ps1 .claude/worktrees
#
# Matches are substring, case-insensitive, against the full cwd. Processes owned
# by other users (or elevated ones) are skipped silently: opening them fails and
# they simply do not appear.

param([Parameter(Position = 0)][string]$Needle)

if (-not $Needle) {
  Write-Output "usage: find-cwd.ps1 <substring of the path>"
  exit 2
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Peb {
  [StructLayout(LayoutKind.Sequential)]
  public struct PROCESS_BASIC_INFORMATION { public IntPtr Reserved1; public IntPtr PebBaseAddress; public IntPtr R2; public IntPtr R3; public IntPtr UniqueProcessId; public IntPtr R4; }
  [DllImport("ntdll.dll")] public static extern int NtQueryInformationProcess(IntPtr h, int cls, ref PROCESS_BASIC_INFORMATION pbi, int len, out int ret);
  [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(int access, bool inherit, int pid);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] public static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, int size, out IntPtr read);

  public static string GetCwd(int pid) {
    IntPtr h = OpenProcess(0x0400 | 0x0010, false, pid); // QUERY_INFORMATION | VM_READ
    if (h == IntPtr.Zero) return null;
    try {
      var pbi = new PROCESS_BASIC_INFORMATION(); int ret;
      if (NtQueryInformationProcess(h, 0, ref pbi, Marshal.SizeOf(pbi), out ret) != 0) return null;
      var buf = new byte[8]; IntPtr read;
      // PEB -> ProcessParameters, offset 0x20 on x64
      if (!ReadProcessMemory(h, (IntPtr)(pbi.PebBaseAddress.ToInt64() + 0x20), buf, 8, out read)) return null;
      long rtl = BitConverter.ToInt64(buf, 0);
      // RTL_USER_PROCESS_PARAMETERS -> CurrentDirectory.DosPath (UNICODE_STRING), offset 0x38
      var us = new byte[16];
      if (!ReadProcessMemory(h, (IntPtr)(rtl + 0x38), us, 16, out read)) return null;
      int len = BitConverter.ToUInt16(us, 0);
      long p = BitConverter.ToInt64(us, 8);
      if (len <= 0 || p == 0) return null;
      var s = new byte[len];
      if (!ReadProcessMemory(h, (IntPtr)p, s, len, out read)) return null;
      return System.Text.Encoding.Unicode.GetString(s);
    } finally { CloseHandle(h); }
  }
}
'@

$hits = 0
foreach ($proc in Get-CimInstance Win32_Process) {
  $cwd = $null
  try { $cwd = [Peb]::GetCwd([int]$proc.ProcessId) } catch {}
  if ($cwd -and $cwd -like "*$Needle*") {
    $hits++
    $cmd = if ($proc.CommandLine) { $proc.CommandLine.Substring(0, [Math]::Min(160, $proc.CommandLine.Length)) } else { '' }
    Write-Output "PID=$($proc.ProcessId) PPID=$($proc.ParentProcessId) NAME=$($proc.Name)"
    Write-Output "  CWD=$cwd"
    Write-Output "  CMD=$cmd"
  }
}

if ($hits -eq 0) { Write-Output "no process has a working directory matching '$Needle'" }
else { Write-Output "$hits process(es) - kill them (child first) before deleting the directory" }
