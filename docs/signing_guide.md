# Distribution Signing Guide

All distribution files served to the launcher must be signed with **Ed25519**. The launcher rejects unsigned or incorrectly signed distributions.

---

## Key Infrastructure

- **Algorithm**: Ed25519 (32-byte public key, 64-byte signature)
- **Trusted public key** (configured in `network/config.js`):
  ```
  47719aff1f56160e4d07d6e35add3f31e1e96c918cc24e37fc569a9a99cc190f
  ```
- **Private key**: Must be kept secret by the distribution operator. Not stored in the repository.

---

## What Must Be Signed

| File | Signature file |
|------|----------------|
| `distribution.json` | `distribution.json.sig` |
| `java/manifest.json` (per mirror) | `java/manifest.json.sig` |

Both must be served at the same URL + `.sig` extension.

---

## Signature Format

The `.sig` file contains the **hex-encoded** Ed25519 signature of the raw bytes of the signed file.

```
# Example distribution.json.sig content:
a1b2c3d4e5f6...  (128 hex characters = 64 bytes)
```

The signature is over the **entire raw file content** (not a hash of it). `SignatureUtils.verifyDistribution` receives:
- `dataHex`: hex encoding of the full file content
- `signatureHex`: hex encoding of the 64-byte signature

---

## Generating a Keypair

Using OpenSSL (recommended):

```bash
# Generate private key (keep secret, never commit)
openssl genpkey -algorithm ed25519 -out distro_private.pem

# Extract public key
openssl pkey -in distro_private.pem -pubout -out distro_public.pem

# Get hex-encoded public key (32 bytes = 64 hex chars)
openssl pkey -in distro_public.pem -pubin -text -noout
```

Alternatively, using Python:
```python
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat, PrivateFormat, NoEncryption

key = Ed25519PrivateKey.generate()
pub_hex = key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw).hex()
priv_bytes = key.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption()).hex()
print('Public key:', pub_hex)   # Add to DISTRO_PUB_KEYS in network/config.js
```

---

## Signing a Distribution File

```bash
# Sign distribution.json
openssl pkeyutl -sign \
  -inkey distro_private.pem \
  -in distribution.json \
  -out distribution.json.sig.bin

# Convert binary signature to hex
xxd -p distribution.json.sig.bin | tr -d '\n' > distribution.json.sig
```

Or with Python:
```python
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PrivateFormat, NoEncryption
import binascii

# Load private key from hex (stored securely, not in repo)
priv_hex = '...'
key = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(priv_hex))

with open('distribution.json', 'rb') as f:
    data = f.read()

sig = key.sign(data)
with open('distribution.json.sig', 'w') as f:
    f.write(sig.hex())
```

---

## Adding a New Trusted Key

If the private key is rotated:

1. Generate a new keypair.
2. Add the new public key hex to `DISTRO_PUB_KEYS` in `network/config.js`:
   ```js
   DISTRO_PUB_KEYS: [
       '47719aff1f56160e4d07d6e35add3f31e1e96c918cc24e37fc569a9a99cc190f', // old
       '<new_public_key_hex>'  // new
   ]
   ```
3. **Ship a launcher update** with the new config before retiring the old key.
4. Sign future distributions with the new private key.
5. After all users are on the new launcher version, remove the old key.

`SignatureUtils.verifyDistribution` verifies against **any** of the trusted keys — a valid signature from any one key is accepted.

---

## Verification Implementation

`app/assets/js/core/util/SignatureUtils.js`:

```js
// Uses WebCrypto (Renderer) or Node crypto (Main)
async function verifyDistribution({ dataHex, signatureHex, trustedKeys }) {
    const data = Buffer.from(dataHex, 'hex')
    const sig = Buffer.from(signatureHex, 'hex')
    
    for (const keyHex of trustedKeys) {
        const keyBytes = Buffer.from(keyHex, 'hex')
        // Import as Ed25519 raw public key
        const cryptoKey = await subtle.importKey('raw', keyBytes, { name: 'Ed25519' }, false, ['verify'])
        const valid = await subtle.verify({ name: 'Ed25519' }, cryptoKey, sig, data)
        if (valid) return true
    }
    return false
}
```

---

## Security Notes

- The private key **must never** be stored in the repository, CI environment variables (unencrypted), or any client-side file.
- The signature covers the **entire file content**. Any modification to `distribution.json` after signing — even whitespace — invalidates the signature.
- Use a hardware security module (HSM) or secret manager (e.g. Vault, GitHub Actions encrypted secrets) for production signing.
- The `timestamp` field in `distribution.json` is part of the signed content, providing anti-replay protection. Always update it when publishing a new distribution.
