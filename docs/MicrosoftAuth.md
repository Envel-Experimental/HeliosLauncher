# Microsoft Authentication

FLauncher authenticates users via Microsoft's OAuth 2.0 **device-code flow**. This avoids embedding a browser WebView and eliminates the need for a redirect URI, making it compatible with both packaged and dev builds.

**Service**: `app/main/MicrosoftAuthService.js`  
**Core logic**: `app/assets/js/core/microsoft/` + `app/assets/js/core/authmanager.js`

---

## OAuth Device-Code Flow

```
UI clicks "Login with Microsoft"
       │
       ▼
IPC: auth:microsoft:startDeviceCode
       │
       ▼
MicrosoftAuthService
    POST https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode
    Body: client_id=<azure_app_id>&scope=XboxLive.signin offline_access
       │
       ▼
Response: { device_code, user_code, verification_url, expires_in, interval }
    → Send user_code + verification_url to Renderer via IPC
    → Renderer displays: "Go to <url> and enter code <user_code>"
       │
       ▼
Start polling loop (every interval seconds):
    POST https://login.microsoftonline.com/consumers/oauth2/v2.0/token
    Body: grant_type=urn:ietf:params:oauth2:grant-type:device_code
          &client_id=<azure_app_id>
          &device_code=<device_code>
       │
       ├─► 400 authorization_pending → keep polling
       ├─► 400 expired_token → abort, show error
       └─► 200 OK → Microsoft token received
```

---

## Token Exchange Chain

After receiving the Microsoft OAuth token:

```
Microsoft Access Token
       │
       ▼
POST https://user.auth.xboxlive.com/user/authenticate
Body: { Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com',
                      RpsTicket: 'd=<ms_access_token>' },
        RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT' }
       │
       ▼
XBL Token + UserHash (uhs)
       │
       ▼
POST https://xsts.auth.xboxlive.com/xsts/authorize
Body: { Properties: { SandboxId: 'RETAIL', UserTokens: [xbl_token] },
        RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT' }
       │
       ▼
XSTS Token
       │
       ▼
POST https://api.minecraftservices.com/authentication/login_with_xbox
Body: { identityToken: 'XBL3.0 x=<uhs>;<xsts_token>' }
       │
       ▼
Game Access Token + UUID
       │
       ▼
GET https://api.minecraftservices.com/minecraft/profile
Headers: Authorization: Bearer <game_access_token>
       │
       ▼
{ id, name }  →  { uuid, displayName }
```

---

## Token Storage

Tokens are stored in `ConfigManager.authenticationDatabase`:

```ts
interface AuthAccount {
  uuid: string             // Game profile UUID
  displayName: string      // In-game name
  accessToken: string      // Game access token (used in launch args)
  username: string         // Usually same as displayName
  type: 'microsoft'
  expiresAt: number        // Unix timestamp ms
  microsoft: {
    access_token: string   // MS OAuth access token
    refresh_token: string  // MS OAuth refresh token (long-lived)
    expires_in: number
    token_type: 'Bearer'
  }
}
```

Tokens are stored in `config.json` as plain JSON. There is no OS keychain integration — tokens are protected only by filesystem permissions.

---

## Token Refresh

On app startup and before each launch, `authmanager.js` checks `expiresAt`:

```
if (Date.now() >= account.expiresAt - 5 * 60 * 1000):
    → Refresh using microsoft.refresh_token
    → POST /oauth2/v2.0/token with grant_type=refresh_token
    → On success: update account in authenticationDatabase, save config
    → On failure: mark account as invalid, prompt re-login
```

The 5-minute buffer prevents the token from expiring during a long download.

---

## Multiple Accounts

The launcher supports multiple authenticated accounts simultaneously. Accounts are stored by UUID in `authenticationDatabase`. `selectedAccount` holds the UUID of the currently active account.

Switching accounts is done from the Settings UI by selecting a different account. No re-authentication is required unless the refresh token has expired.

---

## IPC Channels (Microsoft Auth)

| Channel | Direction | Description |
|---------|-----------|-------------|
| `auth:microsoft:startDeviceCode` | Renderer→Main | Start device code flow, returns `{ user_code, verification_url }` |
| `auth:microsoft:pollStatus` | Renderer→Main | Check if user has completed auth. Returns token or `{ pending: true }` |
| `auth:microsoft:cancel` | Renderer→Main | Cancel ongoing device code poll |
| `auth:logout` | Renderer→Main | Remove account from database, save config |
| `auth:getAccounts` | Renderer→Main | Returns all accounts in `authenticationDatabase` |
| `auth:selectAccount` | Renderer→Main | Sets `selectedAccount` in config |
| `auth:refresh` | Renderer→Main | Force refresh tokens for selected account |

---

## Azure Application

The launcher uses a registered Azure AD application for OAuth. The `client_id` is hardcoded in `MicrosoftAuthService.js`. The application is registered as a **public client** (no client secret) with the `XboxLive.signin offline_access` scope.

The app does **not** use PKCE — device-code flow inherently doesn't require it since there is no redirect URI to protect.