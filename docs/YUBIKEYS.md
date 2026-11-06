# The YubiKeys: arrival test and setup

Status (2026-11-06):
- **The arrival test is ready for Kevin to run** (§1). Claude never runs it.
- **The real setup is a plan** (§3), for Kevin's OK after the test.

docs/ARCHITECTURE-INSTANCES.md §5e says why the keys exist and what each one signs.

**The four keys** (Kevin, 2026-11-06), each a YubiKey 5C NFC:

| Letter | Serial | Proposed role (§3) |
|---|---|---|
| A | 38272275 | root A, in the safe |
| B | 38272285 | root B, in another place (a bank box) |
| C | 38272295 | the signing key, with Kevin |
| D | 38272284 | the spare signing key, kept apart from C |

`ykman info` on each showed:
- firmware 5.7.4;
- PIV, OpenPGP, FIDO2, OATH, OTP and YubiHSM Auth enabled over USB and NFC.

---

## 1. The arrival test

**What it proves, for each key:**
- **its serial** is the one for its letter, and **its firmware** is 5.7 or later;
- **it is genuine:**
  - a key made on it is attested by its own factory certificate (slot f9);
  - that certificate chains, signature by signature, to Yubico Attestation Root 1, which the script pins by its SHA-256;
  - inside that signed attestation, the key itself states its serial, firmware, form factor and policies, so they don't rest on what `ykman info` printed;
- **Ed25519 signing works** with the PIN and a touch for every signature:
  - the signature verifies with WebCrypto, which is how Wivo's release code checks it;
  - a changed message is refused;
  - a second signature without a fresh PIN is refused;
- **it is left clean:**
  - the throwaway key is deleted;
  - PIV is as it left the factory: the default PIN, PUK and management key, every try left, no key in any slot except the factory's f9.

  So the real setup starts from a fresh key. Nothing else on the key is touched: FIDO2, OTP, OATH and OpenPGP stay as they are.
- **On key A only:** the largest message the key will sign (§2).

**How it works:**
- `scripts/yubikey/device.py` talks to the key, through Yubico's own `ykman script`.
- `scripts/yubikey/arrival-test.mjs` checks what came back, in Node only (`attestation.mjs`, with its tests).
- Yubico's root and intermediate certificates are kept beside the script, in `scripts/yubikey/yubico/`.
- **What it writes:** public keys, certificates and signatures, in `~/wivo-yubikey-arrival/<letter>-<serial>/`, outside the project. The PIN is never written anywhere.

**Time:** about 5 minutes per key, plus about 10 touches on key A.

### The commands, one at a time

Run them in Terminal, in the project folder on `testing`.

**1. Go to the project, and check that the test is there.**
```sh
cd ~/dev/Workly && git log --oneline -1
```
It should show the commit "YubiKey arrival test: ...".

**2. Check ykman.**
```sh
ykman --version
```
It should show `YubiKey Manager (ykman) version: 5.9.2`. Any version from 5.4 on works; with an older one, run `brew upgrade ykman`.

**3. Check Yubico's root yourself, fetched fresh from Yubico.**
```sh
curl -fsSL https://developers.yubico.com/PKI/yubico-ca-1.pem | openssl x509 -noout -subject -fingerprint -sha256
```
It should show exactly:
```
subject=CN=Yubico Attestation Root 1
sha256 Fingerprint=62:76:0C:6A:6E:F9:16:79:F4:54:C8:90:2B:80:FD:00:98:25:B3:F2:5D:A9:0F:1F:BA:CE:2E:C6:58:6C:D5:A8
```
That is the fingerprint the script pins. **If it differs, stop and tell me.**

**4. Run the checker's own tests.**
```sh
npx vitest run --mode unit scripts/yubikey
```
It should end with `Tests  14 passed (14)`.

**5. Key A.** Insert **only key A**, then run:
```sh
node scripts/yubikey/arrival-test.mjs A --probe-size
```
What happens, in order:
1. It shows `Found YubiKey 5C NFC, serial 38272275, firmware 5.7.4.`
2. It asks `PIN (a new key's PIN is 123456):`. Type `123456`; nothing shows as you type.
3. It shows `Making a throwaway Ed25519 key in slot 9c ...` and `Attested.`
4. It shows `Touch the key now (the test signature): it is blinking.` Touch it, within about 15 seconds. Then `Signed.`
5. It shows `Signing again WITHOUT the PIN: this must be refused.` It should answer `refused 6982` at once. Touch only if the key blinks.
6. It shows `Finding the largest message the key signs: one touch per size.` Touch each time it says so, until a line says `refused`. That is about 5–10 touches.
7. It shows `Deleting the throwaway key...` and `Clean: PIV is as it left the factory.`

It then prints:
```
Largest message signed and verified: <N> bytes; <M> refused (<code>).

Key A (38272275):
  ok    Serial 38272275 is key A's (38272275)
  ok    Firmware 5.7.4 is 5.7 or later
  ok    PIV was as it left the factory before the test
  ok    Genuine: the attestation chains to Yubico Attestation Root 1
  ok    Attested serial: 38272275
  ok    Attested firmware: 5.7.4
  ok    Attested form factor: USB-C keychain
  ok    Attested policy: PIN always, touch always
  ok    Attested key: the Ed25519 key just made on the key
  ok    Slot 9c: made on the key, not imported
  ok    Ed25519 signature with PIN and touch verifies (WebCrypto, as the release code, and Node)
  ok    A changed message is refused
  ok    A second signature without a fresh PIN: refused 6982
  ok    Clean afterwards: throwaway key deleted, PIV as it left the factory

PASSED. Kept in /Users/kevintreial/wivo-yubikey-arrival/A-38272275
```

**6. Key B.** Take out A, insert only B:
```sh
node scripts/yubikey/arrival-test.mjs B
```
The same as step 5, without the sizes. The lines say `38272285`.

**7. Key C:**
```sh
node scripts/yubikey/arrival-test.mjs C
```

**8. Key D:**
```sh
node scripts/yubikey/arrival-test.mjs D
```

**9. Optional: Yubico's own check, which doesn't use our code.** For each key, change the folder name to that key's:
```sh
cd ~/wivo-yubikey-arrival/A-38272275 && openssl x509 -in f9.pem -noout -issuer && openssl verify -CAfile ~/dev/Workly/scripts/yubikey/yubico/yubico-ca-1.pem -untrusted ~/dev/Workly/scripts/yubikey/yubico/yubico-intermediate.pem -untrusted f9.pem attestation-9c.pem; cd ~/dev/Workly
```
It should show:
- `issuer=CN=Yubico PIV Attestation B 1`, or `A 1` or `B2 1`;
- then `attestation-9c.pem: OK`.

**10. Send me:**
- for each key, the `ok` lines and `PASSED`;
- the line `Largest message signed and verified: ...` from key A.

I record them in §4.

### If something isn't as above

| What you see | What it means | What to do |
|---|---|---|
| `STOPPED: this key's serial is …` | Another key is inserted, or the letter is wrong. Nothing was changed. | Insert the right key. |
| `STOPPED: more than one YubiKey is inserted` | Nothing was changed. | Leave in only the key being tested. |
| `STOPPED: this key's PIV is not as it left the factory` | Someone, or something, used its PIV. Nothing was changed. | If it wasn't you, don't use the key. Tell me. |
| `STOPPED: wrong PIN; 2 tries left` | Nothing was changed. | Run it again and type `123456`. |
| `Refused (6985). Not touched within about 15 seconds?` | The touch came too late. The throwaway key is still deleted. | Run it again. |
| `FAIL  Firmware …` | Older than 5.7: no Ed25519. | Return the key. |
| `FAIL  Genuine: …` or any `FAIL  Attested …` | Not proven genuine, or not as attested. | **Don't use the key.** Send me the output. |
| `FAIL  A second signature without a fresh PIN: refused <other code>` alone | Refused as it should be, with another code than expected. | Send me the code; the key is fine if everything else passed. |
| `NOT CLEAN: …`, or the run stopped half-way | The throwaway key may still be there. | `ykman --device <serial> piv reset` (answer `y`), then run the test again. That reset touches only PIV, and the factory's f9 certificate survives it. |

---

## 2. What the size probe decides

**Wivo's release format signs the whole `<PREFIX>.<payload>`** (`shared/release/release.ts`).
- A package's manifest lists every migration and function file with its hash and size.
- **Today that is about 160 files, so about 30 KB to sign, and it grows with every migration.** The list of versions grows too.
- A YubiKey's PIV keeps the whole message in its own memory to sign it with Ed25519. That memory is probably a few KB. The probe measures it.

**If the largest message signed is below 64 KB** (expected), `shared/release` changes before any real key signs anything:
- **What is signed** becomes a short statement of fixed length: the prefix and the SHA-256 of the payload;
- **checking** hashes the payload first, then checks the signature on the statement;
- the tokens keep their format, and only what the signature covers changes;
- about half a day, with the tests.

**Recommended in any case,** even if the probe reaches 64 KB: signing then costs the same however long the lists grow.

## 3. The real setup (plan, for Kevin's OK after the test)

One session of about 2 hours, after all four keys pass. A script does each step, as the arrival test does, and Kevin types the PINs and touches the keys.

**1. Turn off what the keys won't use.**

**Turn off Yubico OTP, over USB and over NFC, on all four keys. Yes.**
- With OTP on, a touch while no signature is waiting makes the key type a 44-character code into whatever window has focus. That includes a terminal, followed by Enter.
- A touch is exactly what every signature asks for, so a second touch or a late one is likely.
- Over NFC, a tap on a phone opens a Yubico link carrying a code.
- Wivo uses none of it. With OTP off over USB, the key is no longer a keyboard at all, so nothing can be typed by it.

**Also turn off** OATH, OpenPGP and YubiHSM Auth on all four. Unused things are only more to trust.

| Key | Keep over USB | Keep over NFC |
|---|---|---|
| A and B (roots) | PIV only | nothing |
| C and D (signing) | PIV, plus FIDO2 and U2F for GitHub's hardware second factor (docs/GITHUB-CHECKLIST.md) | FIDO2 only if Kevin signs in to GitHub on a phone, otherwise nothing |

The commands, for the record (the setup script runs them and shows each one first):
```sh
ykman --device 38272275 config usb --disable OTP --disable OATH --disable OPENPGP --disable HSMAUTH --disable FIDO2 --disable U2F --force
ykman --device 38272275 config nfc --disable-all --force
ykman --device 38272295 config usb --disable OTP --disable OATH --disable OPENPGP --disable HSMAUTH --force
ykman --device 38272295 config nfc --disable-all --force
```
- These lines are for A and C; B is like A and D like C.
- A key can't turn off everything over USB, which is why the USB lines name what to turn off.
- All of this can be turned back on with `ykman config`. It is not a fuse.

**2. PIV access, on each key:**
- **a new PIN** of 8 digits, and **a new PUK** of 8;
- **a random AES-256 management key, protected by the PIN** (`ykman piv access change-management-key --algorithm AES256 --generate --protect`). So only the PIN is ever needed, and no management key is written down;
- 3 tries for the PIN and 3 for the PUK, as from the factory.

**3. The keys, made on the hardware:**
- **Ed25519,** with PIN and touch for every use, as in the test;
- **A and B:** one root key each, in slot 9c;
- **C:**
  - the update signing key, in 9c;
  - the app release key, in 82;
  - the licence key, in 83;
- **D:** a spare update signing key and a spare app release key, in the same slots (decision 4).

**4. Each key's attestation is checked,** with the same checks as the test, and kept with its public key. Each attestation must name the same serial as the test.

**5. The two root public keys are pinned** in `shared/release` and in `wivo-update`. They are committed for Kevin to push.

**6. Root A signs the certificates** for the update and app keys on C and D (valid two years, 5e). Root B signs nothing yet; it is checked to sign and verify once.

**7. A test release, signed end to end** on the test channel: a separate session (§9, slice 1).

**8. Where the keys go:**
- A to the safe;
- B to the other place;
- C stays with Kevin;
- D goes somewhere other than C.

  The PINs and PUKs never go into a file or a password manager (5e).

**Decisions for Kevin:**
1. **The roles by letter,** as in the table at the top.
2. **Where the PINs and PUKs are kept.**
   - Proposed: each root's PIN and PUK on paper, sealed, with that root. C's and D's PINs memorised, and their PUKs on paper in the safe.
   - Three wrong PINs and then three wrong PUKs make a key useless. For a root, the other root then signs the replacement (5e).
3. **NFC on C and D:** off entirely, unless GitHub on the phone needs it.
4. **A spare licence key on D.**
   - Today the app trusts one licence key. If C is lost, every licence would have to be issued again under a new key.
   - Recommended: the app trusts both C's and D's licence keys.
5. **The release format change** in §2, before the setup.

## 4. Results

| Key | Serial | Passed | Attested firmware | f9 issuer | Largest message signed |
|---|---|---|---|---|---|
| A | 38272275 | | | | |
| B | 38272285 | | | | – |
| C | 38272295 | | | | – |
| D | 38272284 | | | | – |
