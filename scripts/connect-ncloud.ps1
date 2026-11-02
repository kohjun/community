[CmdletBinding()]
param(
    [ValidatePattern('^[a-zA-Z_][a-zA-Z0-9_-]*[$]?$')]
    [string]$SshUser = 'root',
    [ValidateRange(1,65535)]
    [int]$SshPort = 22,
    [switch]$Preview
)
$ErrorActionPreference = 'Stop'
$SliperRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$SliperLocal = Join-Path $SliperRoot '.local'
$SliperTargetFile = Join-Path $SliperLocal 'ncloud-existing-target.json'
if (-not (Test-Path -LiteralPath $SliperTargetFile)) { throw 'The local deployment target is missing.' }
$SliperTarget = Get-Content -Raw -LiteralPath $SliperTargetFile | ConvertFrom-Json
$SliperRemoteHost = [string]$SliperTarget.host
if ($SliperRemoteHost -notmatch '^[a-zA-Z0-9][a-zA-Z0-9.-]*$') { throw 'Invalid deployment host.' }
$SliperKnownHosts = Join-Path $SliperLocal 'ncloud_known_hosts'
$SliperKey = Join-Path $env:USERPROFILE '.ssh\sliper-deploy\id_ed25519'
$SliperPublic = $SliperKey + '.pub'
if (-not (Test-Path -LiteralPath $SliperKey) -or -not (Test-Path -LiteralPath $SliperPublic)) { throw 'Prepare the local deployment SSH key first.' }
if (-not (Test-Path -LiteralPath $SliperKnownHosts)) { throw 'The pinned SSH host key is missing. Verify the server identity first.' }
$SliperPublicKey = [IO.File]::ReadAllText($SliperPublic).Trim()
if ($SliperPublicKey -notmatch '^ssh-ed25519 [a-zA-Z0-9+/]+={0,2} [a-zA-Z0-9_.-]+$') { throw 'Invalid deployment public key.' }
function ConvertTo-SliperShellLiteral([string]$Text) {
    return "'" + $Text.Replace("'", "'\''") + "'"
}
function ConvertTo-SliperWindowsArgument([string]$Text) {
    if ($Text.Length -gt 0 -and $Text -notmatch '[\s"]') { return $Text }
    $SliperEscaped = [regex]::Replace($Text, '(\\*)"', '$1$1\"')
    $SliperEscaped = [regex]::Replace($SliperEscaped, '(\\+)$', '$1$1')
    return '"' + $SliperEscaped + '"'
}
$SliperInstallScript = @'
set -eu
if [ -z "${HOME:-}" ] || [ ! -d "$HOME" ]; then exit 1; fi
if [ -L "$HOME/.ssh" ] || [ -L "$HOME/.ssh/authorized_keys" ]; then
    printf '%s\n' 'Refusing an unexpected SSH symlink.' >&2
    exit 1
fi
umask 077
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
if [ ! -e "$HOME/.ssh/authorized_keys" ]; then : > "$HOME/.ssh/authorized_keys"; fi
if [ ! -f "$HOME/.ssh/authorized_keys" ]; then exit 1; fi
chmod 600 "$HOME/.ssh/authorized_keys"
sliper_deploy_key=__SLIPER_DEPLOY_PUBLIC_KEY__
if ! grep -qxF -- "$sliper_deploy_key" "$HOME/.ssh/authorized_keys"; then
    printf '\n%s\n' "$sliper_deploy_key" >> "$HOME/.ssh/authorized_keys"
fi
printf '%s\n' 'SLIPER_DEPLOY_KEY_READY=1'
set +e
'@
$SliperInstallScript = $SliperInstallScript.Replace('__SLIPER_DEPLOY_PUBLIC_KEY__', (ConvertTo-SliperShellLiteral $SliperPublicKey))
$SliperInventory = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'existing-host-preflight.sh'))
$SliperRemoteScript = $SliperInstallScript + "`n" + $SliperInventory
$SliperReviewFile = Join-Path $SliperLocal 'ncloud-ssh-bootstrap.review.sh'
[IO.File]::WriteAllText($SliperReviewFile, $SliperRemoteScript, [Text.UTF8Encoding]::new($false))
$SliperSsh = (Get-Command ssh.exe).Source
Write-Host ('Target: {0}@{1}:{2}' -f $SshUser,$SliperRemoteHost,$SshPort)
Write-Host 'Actions: append this deployment PUBLIC key once, then inspect host resources and ports.'
Write-Host 'No services, firewall, proxy, domain, or password-authentication settings will be changed.'
& ssh-keygen.exe -l -f $SliperPublic
if ($LASTEXITCODE -ne 0) { throw 'Could not validate the public key fingerprint.' }
Write-Host ('Review script: ' + $SliperReviewFile)
if ($Preview) { return }
if ([Console]::IsInputRedirected) { throw 'Run this script in an interactive PowerShell terminal to enter the password privately.' }
$SliperDestination = $SshUser + '@' + $SliperRemoteHost
$SliperBaseArguments = @('-T','-p',[string]$SshPort,'-o','StrictHostKeyChecking=yes','-o',('UserKnownHostsFile=' + $SliperKnownHosts),'-o','ConnectionAttempts=1','-o','ConnectTimeout=8','-o','ServerAliveInterval=10','-o','ServerAliveCountMax=3')
$SliperPasswordArguments = $SliperBaseArguments + @('-o','BatchMode=no','-o','PubkeyAuthentication=no','-o','PreferredAuthentications=password,keyboard-interactive','-o','NumberOfPasswordPrompts=1',$SliperDestination,'bash -s -- 13000')
Write-Host 'Enter the existing server password only at the OpenSSH prompt. Input is not echoed or stored by this script.'
$SliperAuditFile = Join-Path $SliperLocal 'ncloud-existing-readonly-audit.log'
# SSH reads the password from the interactive console; only the public bootstrap script uses stdin.
# Avoid legacy PowerShell's native-argument quote rewriting for multi-line remote commands.
$SliperStart = [Diagnostics.ProcessStartInfo]::new()
$SliperStart.FileName = $SliperSsh
$SliperStart.Arguments = (($SliperPasswordArguments | ForEach-Object { ConvertTo-SliperWindowsArgument $_ }) -join ' ')
$SliperStart.UseShellExecute = $false
$SliperStart.RedirectStandardInput = $true
$SliperStart.RedirectStandardOutput = $true
$SliperStart.RedirectStandardError = $false
$SliperStart.CreateNoWindow = $false
$SliperProcess = [Diagnostics.Process]::new()
$SliperProcess.StartInfo = $SliperStart
try {
    if (-not $SliperProcess.Start()) { throw 'Could not start interactive SSH.' }
    $SliperOutputTask = $SliperProcess.StandardOutput.ReadToEndAsync()
    $SliperProcess.StandardInput.Write($SliperRemoteScript.Replace("`r`n", "`n"))
    $SliperProcess.StandardInput.Close()
    $SliperProcess.WaitForExit()
    $SliperAudit = $SliperOutputTask.GetAwaiter().GetResult()
    [IO.File]::WriteAllText($SliperAuditFile,$SliperAudit,[Text.UTF8Encoding]::new($false))
    Write-Host $SliperAudit
    if ($SliperAudit -match '(?m)^SLIPER_DEPLOY_KEY_READY=1\r?$') {
        $SliperTarget.sshUser = $SshUser
        $SliperTarget.sshPort = $SshPort
        $SliperTarget.privateKeyPath = $SliperKey
        $SliperTarget.sshAuthenticationVerified = $false
        $SliperTarget.remoteChanges = $true
        $SliperTarget.remoteInspectionCompleted = $SliperAudit -match '(?m)^INSPECTION_ONLY=1'
        $SliperTarget | Add-Member -NotePropertyName remotePublicKeyRegistered -NotePropertyValue $true -Force
        $SliperTarget | Add-Member -NotePropertyName remoteChangeScope -NotePropertyValue 'deployment public key only; no service or firewall changes' -Force
        [IO.File]::WriteAllText($SliperTargetFile, ($SliperTarget | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
    }
    if ($SliperProcess.ExitCode -ne 0) { throw 'SSH setup did not finish. Keep the password out of chat; report only the error.' }
} finally { $SliperProcess.Dispose() }
$SliperKeyArguments = $SliperBaseArguments + @('-i',$SliperKey,'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','PreferredAuthentications=publickey',$SliperDestination,'true')
& $SliperSsh @SliperKeyArguments
if ($LASTEXITCODE -ne 0) { throw 'Password access worked, but deployment-key access still needs server configuration review.' }
$SliperTarget.sshUser = $SshUser
$SliperTarget.sshPort = $SshPort
$SliperTarget.privateKeyPath = $SliperKey
$SliperTarget.sshAuthenticationVerified = $true
$SliperTarget.remoteInspectionCompleted = $true
$SliperTarget.remoteChanges = $true
$SliperTarget | Add-Member -NotePropertyName remoteChangeScope -NotePropertyValue 'deployment public key only; no service or firewall changes' -Force
[IO.File]::WriteAllText($SliperTargetFile, ($SliperTarget | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
Write-Host 'SLIPER_SSH_READY=1. Tell Codex that the SSH setup finished.'
