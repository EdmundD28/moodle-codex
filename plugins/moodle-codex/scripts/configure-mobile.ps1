[CmdletBinding()]
param(
    [string]$Passport,
    [string]$StatusPath,
    [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'
$baseUrl = 'https://moodle.telt.unsw.edu.au'

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
    $md5 = [Security.Cryptography.MD5]::Create()
    try {
        $expected = [Convert]::ToHexString($md5.ComputeHash([Text.Encoding]::UTF8.GetBytes($baseUrl + $ExpectedPassport))).ToLowerInvariant()
    } finally { $md5.Dispose() }
    if ($parts[0] -cne $expected) { throw 'This link does not belong to the current UNSW login attempt.' }
    return $parts[1]
}

if ($SelfTest) {
    $p = 'self-test'
    $hash = [Convert]::ToHexString([Security.Cryptography.MD5]::HashData([Text.Encoding]::UTF8.GetBytes($baseUrl + $p))).ToLowerInvariant()
    $fake = '0' * 32
    $link = 'moodlemobile://token=' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($hash + ':::' + $fake + ':::unused'))
    if ((Convert-MobileCallback $link $p) -ne $fake) { throw 'Valid callback test failed.' }
    foreach ($case in @(@($link,'wrong-attempt'), @('not-a-callback',$p))) {
        $rejected = $false
        try { $null = Convert-MobileCallback $case[0] $case[1] } catch { $rejected = $true }
        if (-not $rejected) { throw 'Invalid callback was accepted.' }
    }
    Write-Output 'PASS: callback parsing, attempt binding, invalid input rejection. No network or settings writes.'
    exit
}

if ([string]::IsNullOrWhiteSpace($Passport) -or [string]::IsNullOrWhiteSpace($StatusPath)) {
    throw 'Passport and StatusPath are required.'
}

function Save-Status([string]$State, [string]$Code = '', [hashtable]$Details = @{}) {
    @{ state = $State; code = $Code; details = $Details; updated = [DateTimeOffset]::UtcNow.ToString('o') } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $StatusPath -Encoding utf8
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form = New-Object Windows.Forms.Form
$form.Text = 'UNSW Moodle - local secure setup v2'
$form.ClientSize = New-Object Drawing.Size(620,220)
$form.StartPosition = 'CenterScreen'
$label = New-Object Windows.Forms.Label
$label.Text = 'Paste the complete moodlemobile:// link below. Input stays on this computer.'
$label.SetBounds(20,20,580,40)
$inputBox = New-Object Windows.Forms.TextBox
$inputBox.UseSystemPasswordChar = $true
$inputBox.SetBounds(20,65,580,28)
$button = New-Object Windows.Forms.Button
$button.Text = 'Verify and save'
$button.SetBounds(20,108,170,34)
$message = New-Object Windows.Forms.Label
$message.SetBounds(20,155,580,55)
$form.Controls.AddRange(@($label,$inputBox,$button,$message))
$form.AcceptButton = $button
$script:saved = $false
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
$null = $form.ShowDialog()
$inputBox.Clear()
$form.Dispose()
if (-not $script:saved) { Save-Status 'closed_without_saving' }
