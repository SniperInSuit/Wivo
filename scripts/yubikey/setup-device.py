"""
The YubiKey setup: the part that talks to the key (docs/YUBIKEYS.md §3).

Run by scripts/yubikey/setup-key.mjs through Yubico's own `ykman script`,
never on its own, like the arrival test's device.py. Nothing here decides
whether a key passes; the Node side checks what is written.

Three steps:
  state  reads what the key has and changes nothing. No PIN.
  piv    once, on a key whose PIV is as it left the factory:
           1. a new random PIN and PUK, shown once. Kevin saves them in Apple
              Passwords and types them back before anything on the key changes;
           2. the Ed25519 keys made on the key, PIN and touch for every use,
              each attested;
           3. a random AES-256 management key, kept on the key under the PIN,
              so it is never shown or written anywhere.
  sign   signs the given statements: the PIN once, then a touch for each.

The PIN, PUK and management key live only in this process's memory. Only
public keys, certificates and signatures are written.

  ykman script --force setup-device.py state <serial> <out.json>
  ykman script --force setup-device.py piv   <serial> <plan.json> <out.json>
  ykman script --force setup-device.py sign  <serial> <in.json> <out.json>
"""

import getpass
import json
import secrets
import sys

from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from ykman import scripting
from ykman.piv import generate_random_management_key, get_pivman_data, pivman_set_mgm_key
from yubikit.core import InvalidPinError
from yubikit.core.smartcard import SW, ApduError
from yubikit.management import CAPABILITY
from yubikit.piv import (
    DEFAULT_MANAGEMENT_KEY,
    KEY_TYPE,
    MANAGEMENT_KEY_TYPE,
    PIN_POLICY,
    SLOT,
    TOUCH_POLICY,
    PivSession,
)

FACTORY_PIN = "123456"
FACTORY_PUK = "12345678"
CLEAR = "\033[3J\033[H\033[2J"  # the screen and its scrollback


def say(text=""):
    print(text, flush=True)


def fail(text):
    say("")
    say("STOPPED: " + text)
    sys.exit(2)


def write(path, value):
    with open(path, "w") as f:
        json.dump(value, f, indent=2)


def connect(expected):
    try:
        dev = scripting.single()
    except ValueError:
        fail("more than one YubiKey is inserted. Leave in only the one being set up.")
    if dev.info.serial != expected:
        fail(f"this key's serial is {dev.info.serial}, not {expected}. Nothing was changed.")
    return dev, PivSession(dev.smart_card())


def raw_hex(public_key):
    return public_key.public_bytes(Encoding.Raw, PublicFormat.Raw).hex()


def slot_state(piv, slot):
    try:
        m = piv.get_slot_metadata(slot)
    except ApduError as e:
        if e.sw == SW.REFERENCE_DATA_NOT_FOUND:
            return None
        raise
    return {
        "key_type": m.key_type.name,
        "pin_policy": m.pin_policy.name,
        "touch_policy": m.touch_policy.name,
        "generated": m.generated,
        "public_key_hex": raw_hex(m.public_key) if m.key_type == KEY_TYPE.ED25519 else None,
    }


def piv_state(piv):
    pin, puk = piv.get_pin_metadata(), piv.get_puk_metadata()
    mgm = piv.get_management_key_metadata()
    slots = {}
    for s in SLOT:
        if s != SLOT.ATTESTATION:
            st = slot_state(piv, s)
            if st:
                slots[f"{int(s):02x}"] = st
    return {
        "pin": {"default": pin.default_value, "tries": [pin.attempts_remaining, pin.total_attempts]},
        "puk": {"default": puk.default_value, "tries": [puk.attempts_remaining, puk.total_attempts]},
        "management_key": {
            "type": mgm.key_type.name,
            "default": mgm.default_value,
            "stored_under_pin": get_pivman_data(piv).has_stored_key,
        },
        "slots": slots,
    }


def as_from_factory(s):
    return (
        s["pin"]["default"] and s["puk"]["default"] and s["management_key"]["default"]
        and s["pin"]["tries"][0] == s["pin"]["tries"][1]
        and s["puk"]["tries"][0] == s["puk"]["tries"][1]
        and not s["slots"]
    )


def state(serial, out_path):
    dev, piv = connect(serial)
    info = dev.info
    write(out_path, {
        "serial": info.serial,
        "version": list(info.version),
        "form_factor": info.form_factor.name,
        "enabled": {
            t.value: [c.name for c in CAPABILITY if c in caps]
            for t, caps in info.config.enabled_capabilities.items()
        },
        **piv_state(piv),
        "f9_pem": piv.get_certificate(SLOT.ATTESTATION).public_bytes(Encoding.PEM).decode(),
    })


def new_secret():
    return f"{secrets.randbelow(10**8):08d}"


def show_and_confirm(plan, serial):
    pin = new_secret()
    puk = new_secret()
    while puk in (pin, FACTORY_PUK):
        puk = new_secret()
    name = f"Wivo YubiKey {plan['letter']} {serial}"
    for _ in range(3):
        say("")
        say(f"Key {plan['letter']} ({serial}), {plan['role']}: its new PIN and PUK.")
        say("")
        say(f"    PIN   {pin}")
        say(f"    PUK   {puk}")
        say("")
        say(f'1. Save both in Apple Passwords now, in a new entry named "{name}":')
        say("   the PIN as the password, and the PUK in the notes.")
        if plan.get("paper"):
            say(f'2. Write the PIN on paper too, marked "Wivo {plan["role"]}: PIN".')
            say(f"   That paper is kept where {plan['paper']} is kept, never with this key.")
        say("")
        say("Nothing on the key has changed yet. The screen is cleared next, and you type both back.")
        input("Press Enter once they are saved. ")
        print(CLEAR, end="", flush=True)
        typed_pin = getpass.getpass("Type the new PIN, from Apple Passwords (nothing shows): ")
        typed_puk = getpass.getpass("Type the new PUK, from Apple Passwords: ")
        if typed_pin == pin and typed_puk == puk:
            say("Both match.")
            return pin, puk
        say("")
        say("That doesn't match what was shown. Nothing on the key has changed. Here they are again.")
    fail("the PIN and PUK were not confirmed. Nothing on the key was changed. "
         "Run again: it shows a new PIN and PUK, so replace the Apple Passwords entry.")


def piv_setup(serial, plan_path, out_path):
    plan = json.load(open(plan_path))
    dev, piv = connect(serial)
    # setup-key.mjs checked this already; checked again, here, before anything changes.
    if not as_from_factory(piv_state(piv)):
        fail("this key's PIV is not as it left the factory. Nothing was changed.")
    pin, puk = show_and_confirm(plan, serial)

    result = {"complete": False, "changed": False, "slots": {}}
    try:
        say("")
        say("Setting the new PUK and PIN...")
        piv.change_puk(FACTORY_PUK, puk)
        result["changed"] = True
        piv.change_pin(FACTORY_PIN, pin)
        piv.verify_pin(pin)
        piv.authenticate(DEFAULT_MANAGEMENT_KEY)
        for name in plan["slots"]:
            slot = SLOT(int(name, 16))
            say(f"Making the Ed25519 key in slot {name} (PIN and touch for every use), and its attestation...")
            public_key = piv.generate_key(slot, KEY_TYPE.ED25519, PIN_POLICY.ALWAYS, TOUCH_POLICY.ALWAYS)
            result["slots"][name] = {
                "public_key_hex": raw_hex(public_key),
                "attestation_pem": piv.attest_key(slot).public_bytes(Encoding.PEM).decode(),
            }
        say("Setting a random AES-256 management key, kept on the key under the PIN...")
        piv.authenticate(DEFAULT_MANAGEMENT_KEY)
        piv.verify_pin(pin)
        pivman_set_mgm_key(
            piv,
            generate_random_management_key(MANAGEMENT_KEY_TYPE.AES256),
            MANAGEMENT_KEY_TYPE.AES256,
            touch=False,
            store_on_device=True,
        )
        result["complete"] = True
        say("PIV is set up.")
    except Exception as e:  # noqa: BLE001: reported; setup-key.mjs says how to start the key over
        result["error"] = repr(e)
    finally:
        write(out_path, result)


def sign(serial, in_path, out_path):
    job = json.load(open(in_path))
    dev, piv = connect(serial)
    result = {"signed": []}
    say("")
    say(f"{job['what']}: {len(job['statements'])} signature(s), the PIN once and a touch for each.")
    pin = getpass.getpass("PIN, from Apple Passwords (nothing shows): ")
    try:
        piv.verify_pin(pin)
    except InvalidPinError as e:
        left = e.attempts_remaining
        fail(f"wrong PIN; {left} {'try' if left == 1 else 'tries'} left. Nothing was signed. "
             + ("Stop, and tell Claude before typing it again." if left == 1 else "Copy it from Apple Passwords and run again."))
    try:
        for s in job["statements"]:
            message = bytes.fromhex(s["hex"])
            say("")
            say(f"  {s['label']}")
            say(f"    signing: {message.decode('ascii')}")
            piv.verify_pin(pin)
            say("    Touch the key now: it is blinking.")
            try:
                signature = piv.sign(SLOT(int(s["slot"], 16)), KEY_TYPE.ED25519, message, None)
                result["signed"].append({"id": s["id"], "signature_hex": signature.hex()})
                say("    Signed.")
            except ApduError as e:
                result["signed"].append({"id": s["id"], "error": f"{e.sw:04x}"})
                say(f"    Refused ({e.sw:04x}). Not touched within about 15 seconds? "
                    "Run again: what is signed is kept.")
                break
    finally:
        write(out_path, result)


def main():
    step = sys.argv[1] if len(sys.argv) > 1 else ""
    if step == "state" and len(sys.argv) == 4:
        state(int(sys.argv[2]), sys.argv[3])
    elif step == "piv" and len(sys.argv) == 5:
        piv_setup(int(sys.argv[2]), sys.argv[3], sys.argv[4])
    elif step == "sign" and len(sys.argv) == 5:
        sign(int(sys.argv[2]), sys.argv[3], sys.argv[4])
    else:
        fail("usage: ykman script --force setup-device.py state|piv|sign <serial> ...")


main()
