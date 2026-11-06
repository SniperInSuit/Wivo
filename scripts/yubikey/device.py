"""
The YubiKey arrival test: the part that talks to the key (docs/YUBIKEYS.md).

Run by scripts/yubikey/arrival-test.mjs through Yubico's own `ykman script`,
never on its own. It writes what the key said to a JSON file; the Node side
checks it. Nothing here decides whether the key passes.

What it does to the key, and nothing more:
  1. refuses to start unless exactly one YubiKey is inserted, its serial is
     the one expected, and its PIV is as it left the factory;
  2. makes a throwaway Ed25519 key in slot 9c, PIN and touch for every use;
  3. has the key attest it, and reads the factory attestation certificate (f9);
  4. signs once with the PIN and a touch, then once more without a fresh PIN,
     which must be refused;
  5. optionally, signs messages of growing size to find the largest it takes;
  6. deletes the throwaway key, whatever happened, and checks that PIV is back
     as it left the factory: default PIN, PUK and management key, every try
     left, no key in any slot but f9.

The PIN typed is held only in this process's memory, for the run.

  ykman script --force scripts/yubikey/device.py <serial> <out.json> [--probe-size]
"""

import getpass
import json
import sys

from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from ykman import scripting
from yubikit.core import InvalidPinError
from yubikit.core.smartcard import SW, ApduError
from yubikit.management import CAPABILITY
from yubikit.piv import (
    DEFAULT_MANAGEMENT_KEY,
    KEY_TYPE,
    PIN_POLICY,
    SLOT,
    TOUCH_POLICY,
    PivSession,
)

TEST_SLOT = SLOT.SIGNATURE  # 9c
# A known value, so a signature from one run can be checked by hand later.
MESSAGE = b"WIVOTEST1.arrival test: a throwaway key, deleted after this signature"
PROBE_SIZES = [64, 512, 1024, 2048, 3000, 4096, 8192, 16384, 32768, 65536]


def say(text=""):
    print(text, flush=True)


def fail(text):
    say("")
    say("STOPPED: " + text)
    sys.exit(2)


def capabilities(caps):
    return [c.name for c in CAPABILITY if caps is not None and c in caps]


def empty(piv, slot):
    try:
        piv.get_slot_metadata(slot)
        return False
    except ApduError as e:
        if e.sw == SW.REFERENCE_DATA_NOT_FOUND:
            return True
        raise


def factory_state(piv):
    """What differs from a key fresh from the factory; empty when nothing does."""
    differs = []
    pin, puk = piv.get_pin_metadata(), piv.get_puk_metadata()
    mgm = piv.get_management_key_metadata()
    if not pin.default_value:
        differs.append("the PIN is not the factory PIN")
    if pin.attempts_remaining != pin.total_attempts:
        differs.append(f"PIN tries left {pin.attempts_remaining} of {pin.total_attempts}")
    if not puk.default_value:
        differs.append("the PUK is not the factory PUK")
    if puk.attempts_remaining != puk.total_attempts:
        differs.append(f"PUK tries left {puk.attempts_remaining} of {puk.total_attempts}")
    if not mgm.default_value:
        differs.append("the management key is not the factory key")
    used = [f"{int(s):02x}" for s in SLOT if s != SLOT.ATTESTATION and not empty(piv, s)]
    if used:
        differs.append("keys in slots " + ", ".join(used))
    return {
        "differs": differs,
        "pin_tries": [pin.attempts_remaining, pin.total_attempts],
        "puk_tries": [puk.attempts_remaining, puk.total_attempts],
        "management_key_type": mgm.key_type.name,
    }


def sign_with_touch(piv, pin, message, what):
    piv.verify_pin(pin)
    say(f"  Touch the key now ({what}): it is blinking.")
    return piv.sign(TEST_SLOT, KEY_TYPE.ED25519, message, None)


def main():
    if len(sys.argv) < 3:
        fail("usage: ykman script --force device.py <serial> <out.json> [--probe-size]")
    expected = int(sys.argv[1])
    out_path = sys.argv[2]
    probe = "--probe-size" in sys.argv[3:]
    result = {"expected_serial": expected}

    try:
        dev = scripting.single()
    except ValueError:
        fail("more than one YubiKey is inserted. Leave in only the one being tested.")
    info = dev.info
    result["serial"] = info.serial
    result["version"] = list(info.version)
    result["form_factor"] = info.form_factor.name
    result["enabled"] = {
        t.value: capabilities(c) for t, c in info.config.enabled_capabilities.items()
    }
    say(f"Found {dev.name}, serial {info.serial}, firmware {info.version}.")
    if info.serial != expected:
        fail(f"this key's serial is {info.serial}, not {expected}. Nothing was changed.")

    piv = PivSession(dev.smart_card())
    before = factory_state(piv)
    result["before"] = before
    if before["differs"]:
        fail(
            "this key's PIV is not as it left the factory: "
            + "; ".join(before["differs"])
            + ". Nothing was changed. If you didn't change it yourself, don't use this key."
        )
    if not empty(piv, TEST_SLOT):
        fail("slot 9c already holds a key. Nothing was changed.")

    say("")
    pin = getpass.getpass("PIN (a new key's PIN is 123456): ")
    try:
        piv.verify_pin(pin)
    except InvalidPinError as e:
        fail(f"wrong PIN; {e.attempts_remaining} tries left. Nothing was changed. Run again.")

    piv.authenticate(DEFAULT_MANAGEMENT_KEY)
    say("Making a throwaway Ed25519 key in slot 9c (PIN and touch for every use)...")
    try:
        public_key = piv.generate_key(
            TEST_SLOT, KEY_TYPE.ED25519, PIN_POLICY.ALWAYS, TOUCH_POLICY.ALWAYS
        )
        result["public_key_hex"] = public_key.public_bytes(Encoding.Raw, PublicFormat.Raw).hex()
        meta = piv.get_slot_metadata(TEST_SLOT)
        result["slot"] = {
            "key_type": meta.key_type.name,
            "pin_policy": meta.pin_policy.name,
            "touch_policy": meta.touch_policy.name,
            "generated": meta.generated,
        }
        result["attestation_pem"] = (
            piv.attest_key(TEST_SLOT).public_bytes(Encoding.PEM).decode()
        )
        result["f9_pem"] = piv.get_certificate(SLOT.ATTESTATION).public_bytes(Encoding.PEM).decode()
        say("Attested.")

        say("")
        say("Signing the test message with the PIN.")
        try:
            result["message_hex"] = MESSAGE.hex()
            result["signature_hex"] = sign_with_touch(piv, pin, MESSAGE, "the test signature").hex()
            say("  Signed.")
        except ApduError as e:
            result["signature_error"] = f"{e.sw:04x}"
            say(f"  Refused ({e.sw:04x}). Not touched within about 15 seconds? Run again.")

        # The PIN was used up by that signature, so with "PIN always" this one
        # must fail before the key even asks for a touch.
        say("")
        say("Signing again WITHOUT the PIN: this must be refused. If the key blinks, touch it.")
        try:
            piv.sign(TEST_SLOT, KEY_TYPE.ED25519, MESSAGE, None)
            result["without_pin"] = "signed"
        except ApduError as e:
            result["without_pin"] = f"refused {e.sw:04x}"
        say(f"  {result['without_pin']}")

        if probe and "signature_hex" in result:
            say("")
            say("Finding the largest message the key signs: one touch per size.")
            result["probe"] = []
            for size in PROBE_SIZES:
                message = (b"WIVOPROBE." * (size // 10 + 1))[:size]
                try:
                    sig = sign_with_touch(piv, pin, message, f"{size} bytes")
                    result["probe"].append({"size": size, "signature_hex": sig.hex()})
                    say(f"  {size} bytes: signed.")
                except Exception as e:  # noqa: BLE001: a refusal, or the connection giving up on a long message
                    why = f"{e.sw:04x}" if isinstance(e, ApduError) else type(e).__name__
                    result["probe"].append({"size": size, "refused": why})
                    say(f"  {size} bytes: refused ({why}). The limit is below this.")
                    break
    finally:
        say("")
        say("Deleting the throwaway key...")
        try:
            piv.authenticate(DEFAULT_MANAGEMENT_KEY)
            piv.delete_key(TEST_SLOT)
        except Exception as e:  # noqa: BLE001: reported, and the state check below says what is left
            result["delete_error"] = repr(e)
        after = factory_state(piv)
        result["after"] = after
        with open(out_path, "w") as f:
            json.dump(result, f, indent=2)
        if after["differs"]:
            say("NOT CLEAN: " + "; ".join(after["differs"]))
        else:
            say("Clean: PIV is as it left the factory.")


main()
