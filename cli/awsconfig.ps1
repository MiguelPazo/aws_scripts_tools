<#
.SYNOPSIS
    Retrieves temporary AWS STS credentials and sets them as environment variables in the current PowerShell session.

.DESCRIPTION
    This script runs the 'aws sts get-session-token' command to request temporary credentials.
    It supports optional MFA and AWS CLI profiles. The credentials are exported as environment variables
    for use with subsequent AWS CLI commands.

.PARAMETER serialNumber
    (Optional) The ARN of the MFA device. If provided, the script will prompt for a token code.

.PARAMETER profile
    (Optional) The AWS CLI profile name to use.

.PARAMETER duration
    (Optional) Duration of the session in seconds. Default is 28800 (8 hours).

.EXAMPLE
    .\awsconfig.ps1
    Requests temporary credentials without MFA or profile.

.EXAMPLE
    .\awsconfig.ps1 -serialNumber arn:aws:iam::123456789012:mfa/user -profile dev
    Requests credentials using MFA and a named AWS CLI profile.

.NOTES
    - Requires AWS CLI installed and configured.

    - Must be run with execution policy set appropriately:
        Set-ExecutionPolicy RemoteSigned -Scope CurrentUser

    - Maybe require to unblock script to execute:
        Unblock-File -Path .\awsconfig.ps1
#>

param(
    [string]$serialNumber,  # Optional: MFA device ARN (serial number)
    [string]$profile,        # Optional: AWS CLI profile
    [int]$duration = 28800   # Optional: Duration of the session in seconds, default is 28800 (8 hours)
)

# Remove AWS environment variables if they exist
Remove-Item -Path env:AWS_ACCESS_KEY_ID -ErrorAction SilentlyContinue
Remove-Item -Path env:AWS_SECRET_ACCESS_KEY -ErrorAction SilentlyContinue
Remove-Item -Path env:AWS_SESSION_TOKEN -ErrorAction SilentlyContinue

# Build the command for STS based on parameters
$stsCommand = "aws sts get-session-token --duration-seconds $duration"

# Add MFA parameter if serial number is provided
if ($serialNumber) {
    $tokenCode = Read-Host "Enter the MFA token code"  # Only ask for MFA token code if serial number is provided
    $stsCommand += " --serial-number $serialNumber --token-code $tokenCode"
}

# Add profile parameter if provided
if ($profile) {
    $stsCommand += " --profile $profile"
}

Write-Host "Requesting temporary AWS STS credentials using the following command:"
Write-Host $stsCommand

# Run the AWS CLI command and parse the JSON output
$response = Invoke-Expression $stsCommand | ConvertFrom-Json

# Check for errors
if (-not $response.Credentials) {
    Write-Error "Failed to get session token from STS."
    exit 1
}

# Set environment variables in the current PowerShell session
$env:AWS_ACCESS_KEY_ID     = $response.Credentials.AccessKeyId
$env:AWS_SECRET_ACCESS_KEY = $response.Credentials.SecretAccessKey
$env:AWS_SESSION_TOKEN     = $response.Credentials.SessionToken

# Display the variables with the requested format
Write-Host "Temporary AWS credentials set successfully:"
Write-Host "AWS_ACCESS_KEY_ID=$env:AWS_ACCESS_KEY_ID"
Write-Host "AWS_SECRET_ACCESS_KEY=$env:AWS_SECRET_ACCESS_KEY"
Write-Host "AWS_SESSION_TOKEN=$env:AWS_SESSION_TOKEN"

# Correctly access the expiration date
$expiration = $response.Credentials.Expiration
Write-Host "Token expires at: $expiration"
Write-Host "You can now run AWS CLI commands in this session."
