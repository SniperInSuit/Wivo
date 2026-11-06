#!/bin/sh
# Makes the made-up attestation chain the tests check (attestation.test.mjs).
# Same names as Yubico's, different keys: only the root's SHA-256 tells them
# apart, which is the point of pinning it. The private keys are thrown away.
#   sh scripts/yubikey/fixtures/make-fixtures.sh
set -eu
cd "$(dirname "$0")"
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT

ca() { # name subject issuer-name ("" = self)
  openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$t/$1.key" 2>/dev/null
  if [ -z "$3" ]; then
    openssl req -new -x509 -key "$t/$1.key" -subj "/CN=$2" -days 36500 -out "$t/$1.pem" \
      -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign"
  else
    openssl req -new -key "$t/$1.key" -subj "/CN=$2" -out "$t/$1.csr"
    printf 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign\n' > "$t/ca.ext"
    openssl x509 -req -in "$t/$1.csr" -CA "$t/$3.pem" -CAkey "$t/$3.key" -days 36500 \
      -extfile "$t/ca.ext" -out "$t/$1.pem" 2>/dev/null
  fi
}

ca root "Yubico Attestation Root 1" ""
ca intb "Yubico Attestation Intermediate B 1" root
ca pivb "Yubico PIV Attestation B 1" intb
ca f9 "Yubico PIV Attestation" pivb
ca otherf9 "Yubico PIV Attestation" pivb

# The attested key: Ed25519, serial 38272275 (0x0247FD13) as a DER INTEGER,
# firmware 5.7.4, PIN always and touch always, a USB-C keychain.
openssl genpkey -algorithm ed25519 -out "$t/leaf.key"
openssl req -new -key "$t/leaf.key" -subj "/CN=YubiKey PIV Attestation 9c" -out "$t/leaf.csr"
cat > "$t/leaf.ext" <<'EXT'
1.3.6.1.4.1.41482.3.3 = DER:05:07:04
1.3.6.1.4.1.41482.3.7 = DER:02:04:02:47:FD:13
1.3.6.1.4.1.41482.3.8 = DER:03:02
1.3.6.1.4.1.41482.3.9 = DER:03
EXT
openssl x509 -req -in "$t/leaf.csr" -CA "$t/f9.pem" -CAkey "$t/f9.key" -days 36500 \
  -extfile "$t/leaf.ext" -out attestation.pem 2>/dev/null
openssl pkey -in "$t/leaf.key" -pubout -outform DER | tail -c 32 | xxd -p -c 64 > public-key.hex

cp "$t/root.pem" root.pem
cp "$t/f9.pem" f9.pem
cp "$t/otherf9.pem" other-f9.pem
cat "$t/intb.pem" "$t/pivb.pem" > intermediates.pem
