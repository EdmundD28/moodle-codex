[CmdletBinding()]
param(
    [string]$Passport,
    [string]$StatusPath,
    [switch]$SelfTest,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$baseUrl = 'https://moodle.telt.unsw.edu.au'

function ConvertTo-LowerHex([byte[]]$Bytes) {
    return -join ($Bytes | ForEach-Object { $_.ToString('x2') })
}

function Get-Md5Hex([string]$Value) {
    $md5 = [Security.Cryptography.MD5]::Create()
    try {
        return ConvertTo-LowerHex ($md5.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))
    } finally {
        $md5.Dispose()
    }
}

function Convert-MobileCallback([string]$Value, [string]$ExpectedPassport) {
    $value = $Value.Trim()
    if ($value -notmatch '^moodlemobile://token=([A-Za-z0-9+/=%]+)$') {
        throw 'Paste the complete moodlemobile:// link, not an RSS key or password.'
    }
    try {
        $decoded = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Uri]::UnescapeDataString($Matches[1])))
    } catch { throw 'The callback link has invalid encoding.' }
    $parts = $decoded -split ':::'
    if ($parts.Count -notin @(2,3) -or $parts[1] -notmatch '^[a-fA-F0-9]{32}$') {
        throw 'The callback link has an invalid format.'
    }
    $expected = Get-Md5Hex ($baseUrl + $ExpectedPassport)
    if ($parts[0] -cne $expected) { throw 'This link does not belong to the current UNSW login attempt.' }
    return $parts[1]
}

if ($SelfTest) {
    $p = 'self-test'
    $hash = Get-Md5Hex ($baseUrl + $p)
    $fake = '0' * 32
    $link = 'moodlemobile://token=' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($hash + ':::' + $fake + ':::unused'))
    if ((Convert-MobileCallback $link $p) -ne $fake) { throw 'Valid callback test failed.' }
    foreach ($case in @(@($link,'wrong-attempt'), @('not-a-callback',$p))) {
        $rejected = $false
        try { $null = Convert-MobileCallback $case[0] $case[1] } catch { $rejected = $true }
        if (-not $rejected) { throw 'Invalid callback was accepted.' }
    }
    Write-Output 'PASS: callback parsing, attempt binding, invalid input rejection. No network or settings writes.'
    return
}

if ([string]::IsNullOrWhiteSpace($Passport)) {
    $bytes = New-Object byte[] 16
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    } finally {
        $rng.Dispose()
    }
    $Passport = ConvertTo-LowerHex $bytes
}
if ($Passport -notmatch '^[A-Za-z0-9]{16,128}$') {
    throw 'Passport must contain 16 to 128 letters or digits.'
}

$transientStatus = $false
if ([string]::IsNullOrWhiteSpace($StatusPath)) {
    $StatusPath = Join-Path ([IO.Path]::GetTempPath()) ('moodle-codex-setup-' + [Guid]::NewGuid().ToString('N') + '.json')
    $transientStatus = $true
}

$launchUrl = $baseUrl + '/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=' +
    [Uri]::EscapeDataString($Passport) + '&urlscheme=moodlemobile&confirmed=1&oauthsso=0'

function Save-Status([string]$State, [string]$Code = '', [hashtable]$Details = @{}) {
    @{ state = $State; code = $Code; details = $Details; updated = [DateTimeOffset]::UtcNow.ToString('o') } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $StatusPath -Encoding utf8
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form = New-Object Windows.Forms.Form
$form.Text = 'UNSW Moodle - secure local setup'
$form.ClientSize = New-Object Drawing.Size(660,280)
$form.StartPosition = 'CenterScreen'
$label = New-Object Windows.Forms.Label
$label.Text = '1. Copy the complete moodlemobile:// link.  2. Paste it below. The token stays on this computer.'
$label.SetBounds(20,20,620,42)
$openButton = New-Object Windows.Forms.Button
$openButton.Text = 'Open Moodle sign-in'
$openButton.SetBounds(20,68,190,34)
$inputBox = New-Object Windows.Forms.TextBox
$inputBox.UseSystemPasswordChar = $true
$inputBox.SetBounds(20,116,620,28)
$button = New-Object Windows.Forms.Button
$button.Text = 'Verify and save'
$button.SetBounds(20,158,190,34)
$message = New-Object Windows.Forms.Label
$message.SetBounds(20,207,620,55)
$form.Controls.AddRange(@($label,$openButton,$inputBox,$button,$message))
$form.AcceptButton = $button
$script:saved = $false
$openButton.Add_Click({
    try {
        Start-Process -FilePath $launchUrl
        $message.Text = 'Browser opened. Complete sign-in, then paste the complete callback link here.'
    } catch {
        Save-Status 'browser_launch_failed' 'browser_launch_failed'
        $message.Text = 'Could not open the browser. Run the PowerShell setup command to see the error.'
    }
})
$button.Add_Click({
    $button.Enabled = $false
    $message.Text = 'Verifying with UNSW Moodle...'
    $form.Refresh()
    $token = $null
    try {
        try { $token = Convert-MobileCallback $inputBox.Text $Passport }
        catch { $message.Text = 'Invalid callback link or wrong login attempt. Nothing saved.'; Save-Status 'input_rejected'; return }
        $inputBox.Clear()
        $body = @{ wstoken = $token; wsfunction = 'core_webservice_get_site_info'; moodlewsrestformat = 'json' }
        $info = Invoke-RestMethod -Uri ($baseUrl + '/webservice/rest/server.php') -Method Post -ContentType 'application/x-www-form-urlencoded' -Body $body -TimeoutSec 30 -MaximumRedirection 0
        if ($info.errorcode -or $info.exception) {
            $safeCodes = @('invalidtoken','accessexception','webservice_access_exception','servicenotavailable','accesscontrol')
            $code = if ($info.errorcode -in $safeCodes) { [string]$info.errorcode } else { 'moodle_rejected' }
            Save-Status 'verification_failed' $code
            $message.Text = 'Moodle rejected the connection. Nothing saved. Error: ' + $code
            return
        }
        if ([string]$info.siteurl -and ([string]$info.siteurl).TrimEnd('/') -ne $baseUrl) { throw 'Unexpected site.' }
        if (-not $info.userid -or -not $info.functions) { throw 'Incomplete site information.' }
        $required = @('core_webservice_get_site_info','core_enrol_get_users_courses','core_course_get_contents','mod_assign_get_assignments','mod_assign_get_submission_status','core_calendar_get_action_events_by_timesort')
        $available = @($info.functions | ForEach-Object { [string]$_.name })
        $missing = @($required | Where-Object { $_ -notin $available })
        # Site-info success proves the token is usable. Optional functions must not
        # block saving it; expose a capability report so callers can adapt.
        $details = @{
            missing_functions = $missing
            available_read_functions = @($available | Where-Object { $_ -match '^(core_(webservice|enrol|course|calendar)|mod_assign)_get_[a-z0-9_]+$' })
            site_verified = $true
            courses_verified = $false
        }
        if ('core_enrol_get_users_courses' -in $available) {
            $body.wsfunction = 'core_enrol_get_users_courses'
            $body.userid = $info.userid
            $courses = Invoke-RestMethod -Uri ($baseUrl + '/webservice/rest/server.php') -Method Post -ContentType 'application/x-www-form-urlencoded' -Body $body -TimeoutSec 30 -MaximumRedirection 0
            if ('errorcode' -in $courses.PSObject.Properties.Name -or 'exception' -in $courses.PSObject.Properties.Name) {
                $details.course_probe = 'rejected'
            } else {
                $details.courses_verified = $true
                $details.course_count = @($courses).Count
            }
        }
        [Environment]::SetEnvironmentVariable('MOODLE_BASE_URL', $baseUrl, 'User')
        [Environment]::SetEnvironmentVariable('MOODLE_TOKEN', $token, 'User')
        $script:saved = $true
        Save-Status 'verified_and_saved' '' $details
        $message.Text = if ($missing.Count) { 'Connected and saved. Some optional functions are unavailable; diagnostics recorded safely.' } else { 'Connected and saved. You may close this window.' }
    } catch {
        Save-Status 'verification_failed' 'request_or_storage_failed'
        $message.Text = 'Network, response or storage verification failed. No success reported.'
    } finally {
        $token = $null
        $body = $null
        $info = $null
        $courses = $null
        $inputBox.Clear()
        $button.Enabled = -not $script:saved
    }
})
Save-Status 'waiting_for_local_input'
$form.Add_Shown({
    $inputBox.Focus()
})
$null = $form.ShowDialog()
$inputBox.Clear()
$form.Dispose()
if (-not $script:saved) { Save-Status 'closed_without_saving' }
if ($transientStatus -and (Test-Path -LiteralPath $StatusPath)) {
    Remove-Item -LiteralPath $StatusPath -Force
}
