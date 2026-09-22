[CmdletBinding()]
param(
    [string]$BaseUrl,
    [switch]$SkipProbe
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
    $BaseUrl = Read-Host "Moodle base URL, for example https://moodle.example.edu"
}

$BaseUrl = $BaseUrl.Trim().TrimEnd("/")
$uri = [System.Uri]::new($BaseUrl)
if ($uri.Scheme -notin @("http", "https")) {
    throw "Moodle base URL must use http or https."
}

$secureToken = Read-Host "Moodle Web Services token" -AsSecureString
$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)

try {
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
    if ([string]::IsNullOrWhiteSpace($token)) {
        throw "The Moodle token cannot be empty."
    }

    if (-not $SkipProbe) {
        $invokeParams = @{
            Uri = $BaseUrl + "/webservice/rest/server.php"
            Method = "Post"
            ContentType = "application/x-www-form-urlencoded"
            Body = @{
                wstoken = $token
                wsfunction = "core_webservice_get_site_info"
                moodlewsrestformat = "json"
            }
        }
        $response = Invoke-RestMethod @invokeParams

        if ($response.exception -or $response.errorcode) {
            $code = if ($response.errorcode) { $response.errorcode } else { $response.exception }
            throw "Moodle rejected the connection test: " + $code + "."
        }

        Write-Host ("Connection verified: " + $response.sitename)
    }

    [Environment]::SetEnvironmentVariable("MOODLE_BASE_URL", $BaseUrl, "User")
    [Environment]::SetEnvironmentVariable("MOODLE_TOKEN", $token, "User")
    Write-Host "Saved Moodle settings for the current Windows user."
    Write-Host "Fully restart Codex, start a new task, and ask it to check the Moodle connection."
}
finally {
    if ($tokenPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
    }
    $token = $null
}
