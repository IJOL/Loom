<#
.SYNOPSIS
  Bring chat transcripts that were recorded inside a git worktree back to the
  main checkout's project directory, so `claude --resume` from the main repo
  lists them.

.DESCRIPTION
  Claude Code indexes sessions by cwd: a session whose cwd is a worktree gets
  its transcript written to  ~/.claude/projects/<slug-of-worktree-path>/
  instead of the main checkout's directory. EnterWorktree re-homes the session
  that way, and ExitWorktree is supposed to bring it back. When it doesn't, the
  transcript is stranded and vanishes from the main repo's --resume list.

  MEASURED, 2026-08-09: the cwd a resumed session runs in comes from the
  DIRECTORY YOU LAUNCH `claude` IN, never from the transcript. A transcript
  whose every line says cwd = <worktree>, resumed from the main checkout, runs
  in the main checkout and appends new lines carrying the main cwd. That is the
  same shape the 33 healthy Enter/Exit sessions on this machine already have:
  the worktree-era lines stay, truthfully, and the tail is main.

  So this script only COPIES. It never rewrites a byte of a transcript, never
  moves and never deletes — rewriting cwd/gitBranch would falsify the record
  and fixes nothing.

.PARAMETER Id
  Only act on sessions whose id starts with this (a prefix is enough).

.PARAMETER Current
  Act on the session you are sitting in right now, so you never have to know
  its id. Read from ~/.claude/sessions/<pid>.json, the registry the running
  process keeps. Implies -Force: the point is to refresh a snapshot.

.PARAMETER Apply
  Actually copy. Without it the script only reports what it would do.

.PARAMETER Force
  Overwrite a transcript already present in the main directory. Use this to
  refresh a snapshot of a session that was still being written when you copied
  it (see the note about live sessions below).

.EXAMPLE
  tools\rehome-sessions.ps1
  tools\rehome-sessions.ps1 -Apply
  tools\rehome-sessions.ps1 -Id 79927d59 -Apply -Force

.NOTES
  A LIVE session is still appending to its transcript. Copying it mid-session
  gives you a snapshot up to that moment; re-run with -Force once the session
  is closed to capture the rest.
#>
[CmdletBinding()]
param(
    [string] $Id,
    [switch] $Apply,
    [switch] $Force,
    [switch] $Current,
    [switch] $FixMarked
)

$ErrorActionPreference = 'Stop'

if ($Current) {
    $live = Get-ChildItem (Join-Path $env:USERPROFILE '.claude\sessions') -Filter *.json -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $live) { throw "no live session registered under ~/.claude/sessions - pass -Id instead." }
    $reg = Get-Content $live.FullName -Raw | ConvertFrom-Json
    $Id    = $reg.sessionId
    $Force = $true
    Write-Host ("current session: {0}   (pid {1}, cwd {2})" -f $reg.sessionId, $reg.pid, $reg.cwd)
}

# --- where the main checkout is -------------------------------------------
# Derived from git, so this works when the script is run from a worktree too:
# --git-common-dir always points at the MAIN repo's .git.
$commonGitDir = & git -C $PSScriptRoot rev-parse --path-format=absolute --git-common-dir
if ($LASTEXITCODE -ne 0) { throw "not a git repository: $PSScriptRoot" }
$mainRoot = Split-Path -Parent ([System.IO.Path]::GetFullPath($commonGitDir))

# --- path -> project-directory slug ---------------------------------------
# C:\Users\me\repo                          -> C--Users-me-repo
# C:\Users\me\repo\.claude\worktrees\feat-x -> C--Users-me-repo--claude-worktrees-feat-x
function ConvertTo-ProjectSlug([string] $path) {
    return ($path -replace '[:\\/.]', '-')
}

# --- the two records ExitWorktree leaves behind ---------------------------
# A session that entered a worktree carries a running pair of records:
#   {"type":"relocated","relocatedCwd":"<worktree>",...}
#   {"type":"worktree-state","worktreeSession":{...},...}
# and a CLEAN exit ends the file with the pair pointing home:
#   {"type":"relocated","relocatedCwd":"<main>",...}
#   {"type":"worktree-state","worktreeSession":null,...}
# That last pair is what the resume picker reads. Without it a copied
# transcript still resumes INTO the worktree, whatever its cwd fields say --
# it is the mark, and the per-line cwd/gitBranch are not. Verified against
# three healthy Enter/Exit sessions on 2026-08-09, all three identical.
function Test-NeedsExitRecords([string] $jsonl, [string] $homeCwd) {
    $lastState = $null
    $lastReloc = $null
    $firstCwd  = ''
    $sr = [System.IO.StreamReader]::new($jsonl, [System.Text.Encoding]::UTF8)
    try {
        while ($null -ne ($l = $sr.ReadLine())) {
            if     ($l.StartsWith('{"type":"worktree-state"')) { $lastState = $l }
            elseif ($l.StartsWith('{"type":"relocated"'))      { $lastReloc = $l }
            elseif ($firstCwd -eq '') {
                $k = $l.IndexOf('"cwd":"')
                if ($k -ge 0) { $j = $l.IndexOf('"', $k + 7); $firstCwd = $l.Substring($k + 7, $j - $k - 7) }
            }
        }
    }
    finally { $sr.Close() }

    $escapedHome = $homeCwd -replace '\\', '\\'

    # A session BORN inside a worktree -- Claude opened directly in the
    # worktree directory, no EnterWorktree involved -- carries neither record,
    # so there is nothing to set to null and it stays marked forever. Its only
    # tell is that its very first cwd is not the main checkout. Give it the
    # pair too, or it survives every copy still wearing the badge.
    if (-not $lastState -and -not $lastReloc) {
        if ($firstCwd -eq '') { return $false }
        return ($firstCwd -ne $escapedHome)
    }

    # BOTH have to point home. A half-finished exit leaves worktree-state at
    # null while `relocated` still names the worktree: that is what an
    # ExitWorktree that could not move the process actually writes.
    if ($lastState -and -not ($lastState -like '*"worktreeSession":null*')) { return $true }
    if ($lastReloc) {
        # JSON-escape the path: one backslash becomes two. The regex pattern
        # '\\' is ONE literal backslash; the replacement '\\' is TWO characters
        # (backslashes are not special in a -replace replacement, only $ is).
        $escaped = $homeCwd -replace '\\', '\\'
        if ($lastReloc -notlike ('*"relocatedCwd":"' + $escaped + '"*')) { return $true }
    }
    return $false
}

function Add-ExitRecords([string] $jsonl, [string] $sessionId, [string] $homeCwd) {
    $escaped = $homeCwd -replace '\\', '\\'
    $l1 = '{"type":"relocated","relocatedCwd":"' + $escaped + '","sessionId":"' + $sessionId + '"}'
    $l2 = '{"type":"worktree-state","worktreeSession":null,"sessionId":"' + $sessionId + '"}'

    $fs = [System.IO.File]::Open($jsonl, 'Open', 'ReadWrite')
    try {
        $fs.Seek(-1, 'End') | Out-Null
        $endsWithNewline = ($fs.ReadByte() -eq 10)
        $fs.Seek(0, 'End') | Out-Null
        $text  = $(if ($endsWithNewline) { '' } else { "`n" }) + $l1 + "`n" + $l2 + "`n"
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
        $fs.Write($bytes, 0, $bytes.Length)
    }
    finally { $fs.Close() }
}

$projects = Join-Path $env:USERPROFILE '.claude\projects'
$mainSlug = ConvertTo-ProjectSlug $mainRoot
$mainDir  = Join-Path $projects $mainSlug

if (-not (Test-Path $mainDir)) { throw "no project directory for the main checkout: $mainDir" }

Write-Host "main checkout : $mainRoot"
Write-Host "project dir   : $mainDir"
Write-Host ""

# --- the worktree project directories that belong to this repo ------------
$worktreeDirs = Get-ChildItem $projects -Directory |
    Where-Object { $_.Name -like "$mainSlug--claude-worktrees-*" }

# --- -FixMarked: repair transcripts already sitting in the main directory --
# Once an original has been archived there is nothing left to copy, but the
# copy can still wear the badge. This pass appends the exit pair in place.
if ($FixMarked) {
    $fixed = 0
    foreach ($f in (Get-ChildItem $mainDir -Filter *.jsonl -File)) {
        if (-not (Test-NeedsExitRecords -jsonl $f.FullName -homeCwd $mainRoot)) { continue }
        $sid = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
        Write-Host ("marked: {0}" -f $sid)
        if ($Apply) {
            Add-ExitRecords -jsonl $f.FullName -sessionId $sid -homeCwd $mainRoot
            Write-Host "        + exit records appended"
        }
        $fixed++
    }
    if ($fixed -eq 0)  { Write-Host "nothing marked." }
    elseif (-not $Apply) { Write-Host "DRY RUN - nothing was written. Re-run with -Apply to do it." }
    return
}

if (-not $worktreeDirs) { Write-Host "no worktree project directories found."; return }

$plan = foreach ($d in $worktreeDirs) {
    foreach ($f in (Get-ChildItem $d.FullName -Filter *.jsonl -File)) {
        $sid = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
        if ($Id -and -not $sid.StartsWith($Id)) { continue }

        $dst      = Join-Path $mainDir $f.Name
        $exists   = Test-Path $dst

        # Once a session has been resumed from the main directory, the file in
        # the MAIN directory is the live transcript and the worktree one is the
        # dead branch. Copying then would overwrite the live conversation with
        # a stale snapshot. A newer destination always wins - -Force must not
        # override this.
        $newerAtDst = $exists -and ((Get-Item $dst).LastWriteTimeUtc -gt $f.LastWriteTimeUtc)
        $sidecar  = Join-Path $d.FullName $sid          # subagents/, tool-results/
        $liveLock = $false
        try { $s = [System.IO.File]::Open($f.FullName, 'Open', 'Read', 'None'); $s.Close() }
        catch { $liveLock = $true }

        [pscustomobject]@{
            Session   = $sid
            Worktree  = $d.Name -replace "^$mainSlug--claude-worktrees-", ''
            SizeMB    = [math]::Round($f.Length / 1MB, 2)
            Sidecar   = (Test-Path $sidecar)
            InMain    = $exists
            Live      = $liveLock
            Action    = if (-not $exists) { 'copy' }
                        elseif ($newerAtDst) { 'REFUSE (dest is newer)' }
                        elseif (-not $Force) { 'skip (already there)' }
                        else { 'OVERWRITE' }
            Src       = $f.FullName
            Dst       = $dst
            SidecarSrc= $sidecar
            SidecarDst= Join-Path $mainDir $sid
        }
    }
}

if (-not $plan) { Write-Host "nothing to do."; return }

$plan | Format-Table Session, Worktree, SizeMB, Sidecar, InMain, Action -AutoSize | Out-String -Width 200 | Write-Host

if (-not $Apply) {
    Write-Host "DRY RUN - nothing was written. Re-run with -Apply to do it."
    return
}

foreach ($p in $plan) {
    if ($p.Action -like 'skip*') { continue }
    if ($p.Action -like 'REFUSE*') {
        Write-Warning ("{0}: the copy in the main directory is NEWER than the worktree one. That means the session was already resumed from main and is the live transcript - copying would destroy it. Nothing written." -f $p.Session)
        continue
    }

    Copy-Item -LiteralPath $p.Src -Destination $p.Dst -Force
    if ($p.Sidecar) {
        Copy-Item -LiteralPath $p.SidecarSrc -Destination $p.SidecarDst -Recurse -Force
    }

    $srcLen = (Get-Item $p.Src).Length
    $dstLen = (Get-Item $p.Dst).Length
    $ok     = ($srcLen -eq $dstLen)
    Write-Host ("{0}  {1}  ({2} bytes){3}" -f `
        $(if ($ok) { 'copied ' } else { 'MISMATCH' }), $p.Session, $dstLen, `
        $(if ($p.Sidecar) { ' + sidecar' } else { '' }))
    if (-not $ok) { Write-Warning "size differs (src $srcLen / dst $dstLen) - the session was probably still writing. Re-run with -Force when it is closed." }

    if (Test-NeedsExitRecords -jsonl $p.Dst -homeCwd $mainRoot) {
        Add-ExitRecords -jsonl $p.Dst -sessionId $p.Session -homeCwd $mainRoot
        Write-Host "         + exit records appended (worktreeSession: null)"
    }
}

Write-Host ""
Write-Host "The originals in the worktree project directories were NOT touched."
