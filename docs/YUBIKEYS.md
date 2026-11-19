# The YubiKeys: arrival test and setup

Status (2026-11-06):
- **All four keys passed the arrival test** (§1; results in §4): genuine, firmware 5.7.4, Ed25519 with the PIN and a touch, and left clean. Kevin ran it; Claude never runs anything against the keys.
- **The release format now signs a short statement** with the hash (§2), in `shared/release`. No real key has signed anything yet.
- **The real setup:** Kevin's decisions are in (§3). **The setup script is ready for Kevin to run** (§3a), as he ran the test.

docs/ARCHITECTURE-INSTANCES.md §5e says why the keys exist and what each one signs.

**The four keys** (Kevin, 2026-11-06), each a YubiKey 5C NFC:

| Letter | Serial | Role (Kevin, 2026-11-06) |
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
  - a key made on it is attested by its factory certificate (slot f9). Yubico issues that certificate per production batch, not per key, so other keys share it (all four of ours do, §4);
  - that certificate chains, signature by signature, to Yubico Attestation Root 1, which the script pins by its SHA-256;
  - inside that signed attestation, the key itself states its serial, firmware, form factor and policies, so they don't rest on what `ykman info` printed. The serial is there, not in the shared f9;
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
It should end with `Tests  36 passed (36)`: the arrival test's checks and the setup's (§3a). Some of them run on key A's real attestation (§4).

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
  size  Largest message signed and verified: 3000 bytes; 4096 refused (NotSupportedError).

PASSED. Kept in /Users/kevintreial/wivo-yubikey-arrival/A-38272275
```
The `size` line is there only with `--probe-size`. In the first run (2026-11-06) it was printed above `Key A (38272275):`, where the probe's own lines buried it. It is now inside the results block.

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
- the `size` line from key A.

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

## 2. What the size probe decided

**Measured on key A (2026-11-06): 3,000 bytes signed and verified, 4,096 refused.**
- The 4,096 bytes never reached the key. Yubico's own library refused them (`NotSupportedError`: "APDU length exceeds YubiKey capability").
- One command to a YubiKey 4.3 or later holds at most 3,062 bytes, and Ed25519 in PIV sends the whole message in one command. So **a YubiKey signs at most about 3 KB.**

**Wivo's release format signed the whole `<PREFIX>.<payload>`.** A package's manifest lists every migration and function file with its hash and size: about 160 files, so about 30 KB, and it grows with every migration. The list of versions grows too.

**So the format changed (Kevin, 2026-11-06), before any real key signs anything** (`shared/release/release.ts`):
- **The key signs a short statement,** `<PREFIX>.sha256.<hex>`:
  - `<hex>` is the SHA-256 of `<PREFIX>.<payload>`;
  - the statement is at most 81 bytes, whatever the payload's size.
- **Checking** hashes `<PREFIX>.<payload>` first, then checks the signature on the statement.
- **Unchanged:**
  - the tokens keep their shape, `<PREFIX>.<payload>.<signature>`;
  - the hash that revocations and the list's serial floor name is the same as before.
- **The signature now also rests on SHA-256,** as the files a manifest lists already did.
- **The tests:**
  - a list of over 60 KB, signed through a stand-in that refuses anything over 3,000 bytes, as key A did;
  - a signature over the whole text, the old way, is refused;
  - a statement signed for one kind is refused as another.

**Licences (`shared/license`) keep signing in full.** A licence is a few hundred bytes, well under the limit.

## 3. The real setup (Kevin's decisions, 2026-11-06)

One session of about an hour. `scripts/yubikey/setup-key.mjs` does steps 1–4 and 6, one key at a time (§3a): Kevin saves and types the PINs and touches the keys. Claude does step 5 afterwards, from what the script keeps.

**1. Turn off what the keys won't use.**

**Yubico OTP off, over USB and over NFC, on all four keys** (Kevin: yes).
- With OTP on, a touch while no signature is waiting makes the key type a 44-character code into whatever window has focus. That includes a terminal, followed by Enter.
- A touch is exactly what every signature asks for, so a second touch or a late one is likely.
- Over NFC, a tap on a phone opens a Yubico link carrying a code.
- Wivo uses none of it. With OTP off over USB, the key is no longer a keyboard at all, so nothing can be typed by it.

**Also off on all four:** OATH, OpenPGP and YubiHSM Auth. Unused things are only more to trust.

**NFC off entirely on all four.** GitHub on the phone uses an iPhone passkey instead.

| Key | Keep over USB | Keep over NFC |
|---|---|---|
| A and B (roots) | PIV only | nothing |
| C and D (signing) | PIV, plus FIDO2 for GitHub's hardware second factor (docs/GITHUB-CHECKLIST.md) | nothing |

On C and D, U2F stays on with FIDO2 (Kevin, 2026-11-06). It is the older protocol of the same FIDO part of the key.

The commands, for the record (the setup script runs them and shows each one first):
```sh
# A, root A (38272275); B (38272285) the same
ykman --device 38272275 config nfc --disable-all --force
ykman --device 38272275 config usb --disable OTP --disable U2F --disable FIDO2 --disable OATH --disable OPENPGP --disable HSMAUTH --force
# C, the signing key (38272295); D (38272284) the same
ykman --device 38272295 config nfc --disable-all --force
ykman --device 38272295 config usb --disable OTP --disable OATH --disable OPENPGP --disable HSMAUTH --force
```
- A key can't turn off everything over USB, which is why the USB lines name what to turn off.
- All of this can be turned back on with `ykman config`. It is not a fuse.

**2. PIV access, on each key:**
- **a new PIN** of 8 digits, and **a new PUK** of 8, made at random by the script and shown once. Kevin saves them in Apple Passwords and types them back before anything on the key changes;
- **a random AES-256 management key, kept on the key under the PIN** (what `ykman piv access change-management-key --algorithm AES256 --generate --protect` does). So only the PIN is ever needed, and the management key is never shown or written down;
- 3 tries for the PIN and 3 for the PUK, as from the factory.

**3. The keys, made on the hardware:**
- **Ed25519,** with PIN and touch for every use, as in the test;
- **A and B:** one root key each, in slot 9c;
- **C:**
  - the update signing key, in 9c;
  - the app release key, in 82;
  - the licence key, in 83;
- **D, the spare:** a spare update signing key, a spare app release key and a spare licence key, in the same slots;
- **each key's name** is its purpose, its letter and the start of its public key's SHA-256, for example `update-C-87150f67`. A key made again gets a new name.
  - **The spare licence key** (Kevin: yes): the app trusts both C's and D's licence keys, so losing C doesn't mean issuing every licence again. `shared/license` then takes two public keys instead of one. That change comes with the setup, once the public keys exist.

**4. Each key's attestation is checked,** with the same checks as the test, and kept with its public key. Each must name the same serial as the test, under the same factory certificate (§4).

**5. The two root public keys are pinned** in `shared/release` and in `wivo-update`. They are committed for Kevin to push.

**6. Root A signs the certificates** for the update and app keys on C and D (valid two years, 5e). Root B signs nothing real yet: it signs one test statement, which is verified. C's and D's keys each sign one too.

**7. A test release, signed end to end** on the test channel: a separate session (docs/ARCHITECTURE-INSTANCES.md §9, slice 1).

**8. Where the keys go:**
- A to the safe;
- B to the other place;
- C stays with Kevin;
- D goes somewhere other than C.

**9. The PINs and PUKs** (Kevin):
- **all eight, each key's PIN and PUK, in Apple Passwords;**
- **plus each root's PIN on paper, kept crosswise:** root A's PIN where root B is kept, and root B's PIN where root A is kept. So whoever finds one root finds beside it only the PIN of the other root, which is elsewhere;
- C's and D's PINs are in Apple Passwords only.

The private keys never leave the hardware: never in a password manager or a file (5e). A PIN only unlocks a key that is in someone's hand, and every signature still needs a touch.

Three wrong PINs and then three wrong PUKs make a key useless. For a root, the other root then signs the replacement (5e).

**Decided (Kevin, 2026-11-06):**
1. **The roles by letter,** as in the table at the top.
2. **OTP, OATH, OpenPGP and YubiHSM Auth off on all four;** the roots keep only PIV, and C and D also keep FIDO2.
3. **NFC off on all four;** an iPhone passkey for GitHub on the phone.
4. **The PINs and PUKs** as in step 9.
5. **A spare licence key on D.**
6. **The release format change** (§2): done, before any real key signs anything.
7. **U2F stays on with FIDO2** on C and D.

### 3a. Running the setup: the commands, one at a time

**Before you start:**
- Run it in Terminal, not in a shared or recorded screen. Each key's new PIN and PUK are shown once; the script then clears the screen and its scrollback.
- Have Apple Passwords open, and paper and a pen for the two root PINs.
- **The order is C, D, A, B.** A signs the certificates for C's and D's keys, so they must exist first.
- **Time:** about 10 minutes each for C, D and A, and 5 for B. Touches: 3 on C, 3 on D, 4 on A and 1 on B.
- **If anything stops,** run the same command again. What is done is checked and skipped. The table at the end says what each stop means.

**1. Go to the project.**
```sh
cd ~/dev/Workly && git log --oneline -1
```
It should show the commit "YubiKey setup script: ...".

**2. Run the checks' own tests.**
```sh
npx vitest run --mode unit scripts/yubikey
```
It should end with `Tests  36 passed (36)`.

**3. Key C.** Insert **only key C**, then run:
```sh
node scripts/yubikey/setup-key.mjs C
```
What happens, in order:
1. `Key C (38272295), the signing key. Insert only this key.` and `PIV is as it left the factory: setting it up.`
2. **The new PIN and PUK, shown once:**
   ```
   Key C (38272295), the signing key: its new PIN and PUK.

       PIN   ########
       PUK   ########

   1. Save both in Apple Passwords now, in a new entry named "Wivo YubiKey C 38272295":
      the PIN as the password, and the PUK in the notes.
   ```
   Save them, then press Enter. The screen clears.
3. `Type the new PIN, from Apple Passwords (nothing shows):`, then the same for the PUK. Paste or type them; nothing shows. It answers `Both match.`
   - Until here nothing on the key has changed. If they don't match, it shows them again, up to three times.
4. `Setting the new PUK and PIN...`, then `Making the Ed25519 key in slot 9c ...`, the same for 82 and 83, `Setting a random AES-256 management key ...` and `PIV is set up.`
5. `Key C: a test signature with each key: 3 signature(s), the PIN once and a touch for each.`
   - `PIN, from Apple Passwords (nothing shows):`: the new PIN;
   - for each key, `Touch the key now: it is blinking.` Touch it within about 15 seconds. Then `Signed.`
6. `Turning off what this key won't use.` It shows and runs the two `ykman ... config` commands from step 1 of §3. The key restarts after each; that is normal.
7. `Reading the key again for the final check...`, then:
```
Key C (38272295), the signing key:
  ok    Serial 38272295 is key C's (38272295)
  ok    Firmware 5.7.4 is 5.7 or later
  ok    The factory certificate (f9) is the batch's, as in the arrival test
  ok    A new PIN, not the factory's; 3 of 3 tries left
  ok    A new PUK, not the factory's; 3 of 3 tries left
  ok    Management key: AES256, random, kept on the key under the PIN
  ok    No keys in other slots
  ok    Slot 9c, update-C-xxxxxxxx: Ed25519 made on the key, PIN and touch for every use
  ok    Slot 9c: attested, up to Yubico's root
  ok    Slot 82, app-C-xxxxxxxx: Ed25519 made on the key, PIN and touch for every use
  ok    Slot 82: attested, up to Yubico's root
  ok    Slot 83, licence-C-xxxxxxxx: Ed25519 made on the key, PIN and touch for every use
  ok    Slot 83: attested, up to Yubico's root
  ok    Test signature by update-C-xxxxxxxx: verifies, as the release code verifies
  ok    Test signature by app-C-xxxxxxxx: verifies, as the release code verifies
  ok    Test signature by licence-C-xxxxxxxx: verifies, as the release code verifies
  ok    Over USB: U2F, FIDO2, PIV
  ok    Over NFC: nothing

PASSED. Kept in /Users/kevintreial/wivo-yubikey-setup/C-38272295
Next: take out key C, insert only key D, and run: node scripts/yubikey/setup-key.mjs D
```

**4. Key D.** Take out C, insert only D:
```sh
node scripts/yubikey/setup-key.mjs D
```
The same as C, with `38272284`, the entry "Wivo YubiKey D 38272284", and names ending in `-D-...`.

**5. Key A, root A.** Take out D, insert only A:
```sh
node scripts/yubikey/setup-key.mjs A
```
As for C, with these differences:
- **The PIN on paper.** Next to the PIN and PUK it says:
  ```
  2. Write the PIN on paper too, marked "Wivo root A: PIN".
     That paper is kept where root B is kept, never with this key.
  ```
- **One key,** in slot 9c.
- **The signing:** `Root A certifies the update and app keys on C and D: 4 signature(s)`. Each shows what it certifies, for example `Certificate: update-C-xxxxxxxx may sign update packages and lists, 2026-11-06 to 2028-11-06`, with the short statement being signed. One touch each.
- **The final check** ends with:
```
  ok    Slot 9c, root-A-xxxxxxxx: Ed25519 made on the key, PIN and touch for every use
  ok    Slot 9c: attested, up to Yubico's root
  ok    Certificate: update-C-xxxxxxxx may sign update packages and lists, ...: signed by root A, accepted by shared/release
  ok    Certificate: app-C-xxxxxxxx may sign desktop releases, ...: signed by root A, accepted by shared/release
  ok    Certificate: update-D-xxxxxxxx may sign update packages and lists, ...: signed by root A, accepted by shared/release
  ok    Certificate: app-D-xxxxxxxx may sign desktop releases, ...: signed by root A, accepted by shared/release
  ok    Over USB: PIV
  ok    Over NFC: nothing

PASSED. Kept in /Users/kevintreial/wivo-yubikey-setup/A-38272275
```

**6. Key B, root B.** Take out A, insert only B:
```sh
node scripts/yubikey/setup-key.mjs B
```
As for A, but its PIN on paper is kept where root A is kept, and it signs one test statement instead of certificates. It ends with `PASSED` and `All four are set up. Tell Claude "done".`

**7. Put the keys away** (step 8 of §3), and the two papers crosswise (step 9).

**8. Tell me "done".** *(Done 2026-11-19: A 38272275, B 38272285, C 38272295, D 38272284 all passed; pinned on `testing`.)* I then read `~/wivo-yubikey-setup/*/public.json`, which holds public keys, attestations and certificates only, and:
- pin the two root public keys in `shared/release` (and later in `wivo-update`);
- add root A's four certificates;
- make `shared/license` trust C's and D's licence keys;
- commit that, for you to push.

The test release, signed end to end, is a session of its own (step 7 of §3).

**What it keeps,** in `~/wivo-yubikey-setup/<letter>-<serial>/`: the key's state as read, the public keys and attestations (`piv.json`), the signatures and certificates (`signed.json`), `public.json` and `report.json`. Never a PIN, a PUK or the management key.

### If something isn't as above

| What you see | What it means | What to do |
|---|---|---|
| `Set up C and D first` | A was started before C and D passed. | Run C and D first. |
| `STOPPED: this key's serial is …` or `more than one YubiKey is inserted` | The wrong key, or two. Nothing was changed. | Insert only the right key. |
| `That doesn't match what was shown`, three times | Nothing on the key changed. | Run again. It shows a new PIN and PUK: replace the Apple Passwords entry (and, for a root, the paper). |
| `STOPPED: wrong PIN; 2 tries left` | Nothing was signed. | Copy the PIN from Apple Passwords and run again. A right PIN resets the count. |
| `1 try left`, anywhere | One more wrong PIN blocks the key. | **Stop and tell me** before typing it again. |
| `Refused (6985)` while signing | The touch came too late. What was signed is kept. | Run again. |
| `The setup failed: …`, or `PIV is not as it left the factory, and no earlier run of this setup finished it` | The PIV setup stopped half-way. | `ykman --device <serial> piv reset` (answer `y`), then run again. It shows a new PIN and PUK: replace the Apple Passwords entry (and, for a root, the paper). |
| `This key no longer holds the keys an earlier run made` | Its keys changed since the setup. Nothing was changed now. | **Tell me before anything else.** |
| Any `FAIL` | Not as planned. | **Don't use the key.** Send me the output. |
| `ykman could not change the configuration` | The key may have been restarting. | Run again. |

If C or D is ever reset and set up again after A has certified it, run A again: it certifies the new keys.

## 4. Results

**Kevin ran the arrival test on 2026-11-06, 14:39–14:43.** All four keys passed, with all 14 checks `ok`.

| Key | Serial | Passed | Attested firmware | f9 issuer | Largest message signed |
|---|---|---|---|---|---|
| A | 38272275 | yes, 14 of 14 | 5.7.4 | Yubico PIV Attestation B 1 | 3,000 bytes; 4,096 refused (`NotSupportedError`, §2) |
| B | 38272285 | yes, 14 of 14 | 5.7.4 | Yubico PIV Attestation B 1 | – |
| C | 38272295 | yes, 14 of 14 | 5.7.4 | Yubico PIV Attestation B 1 | – |
| D | 38272284 | yes, 14 of 14 | 5.7.4 | Yubico PIV Attestation B 1 | – |

**On all four:**
- **The chain:** the key's attestation → Yubico PIV Attestation (f9) → Yubico PIV Attestation B 1 → Yubico Attestation Intermediate B 1 → Yubico Attestation Root 1.
- **Attested:**
  - its own serial;
  - firmware 5.7.4;
  - USB-C keychain, not FIPS;
  - PIN always and touch always;
  - an Ed25519 key made on the key.
- **A second signature without a fresh PIN:** refused 6982.
- **Afterwards:** clean, PIV as it left the factory.

**The four share one factory certificate (f9),** as expected:
- serial `BA36E4565864961B`, issued 2024-12-01;
- SHA-256 `7E:E7:06:D2:67:DF:53:E5:CC:45:05:37:2D:26:E5:DA:EA:DD:8F:EA:AF:4B:58:56:2A:FD:E8:CC:39:21:92:C1`.

Yubico issues f9 per production batch, not per key. It carries the firmware but no serial.

The serial is in each key's own attestation, which the key signs with the batch's private key. The four attestations differ, and each names its own key's serial. So the test proves each key is a genuine YubiKey, and that it states that serial under a key only genuine YubiKeys hold.

**Kept:**
- each key's output, on Kevin's Mac in `~/wivo-yubikey-arrival/<letter>-<serial>/`: public keys, certificates and signatures only;
- key A's attestation and the f9 certificate, in `scripts/yubikey/fixtures/real-*.pem`. The checker's tests run on them, so it is tested on a real key's output, not only on made-up data.
