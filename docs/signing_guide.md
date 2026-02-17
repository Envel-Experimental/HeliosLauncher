# How to Sign FLauncher with a Self-Signed Certificate in GitHub Actions

Electron Builder supports code signing using a certificate stored in GitHub Secrets. Since you don't have a paid EV/OV certificate, you can use a self-signed certificate, though Windows SmartScreen will still warn users until the application builds reputation.

## 1. Generate a Self-Signed Certificate (Windows PowerShell)

Run the following command in PowerShell as Administrator to generate a `.pfx` certificate file.
**Important:** Replace `YourPassword123` with a strong password.

```powershell
$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=FLauncher, O=Envel-Experimental, C=RU" -KeyUsage DigitalSignature -FriendlyName "FLauncher Self-Signed" -CertStoreLocation "Cert:\CurrentUser\My" -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")

$password = ConvertTo-SecureString -String "YourPassword123" -Force -AsPlainText

Export-PfxCertificate -Cert $cert -FilePath "cert.pfx" -Password $password
```

This will create a `cert.pfx` file in your current directory.

## 2. Encode the Certificate to Base64

GitHub Secrets cannot store binary files directly, so we need to encode it as a Base64 string.

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx")) | Out-File "cert_base64.txt"
```

Open `cert_base64.txt` and copy the entire long string.

## 3. Add Secrets to GitHub

1.  Go to your GitHub Repository -> **Settings** -> **Secrets and variables** -> **Actions**.
2.  Click **New repository secret**.
3.  Add the following two secrets:

| Name | Value |
| :--- | :--- |
| `WIN_CSC_LINK` | Paste the **Base64 string** from `cert_base64.txt`. |
| `WIN_CSC_KEY_PASSWORD` | The password you used in step 1 (e.g., `YourPassword123`). |

## 4. Verify

Next time you push to the repository, the `build.yml` workflow will automatically pick up these secrets and sign the Windows executable.
