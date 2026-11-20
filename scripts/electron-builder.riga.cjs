/**
 * electron-builder's configuration for Riga's temporary installer
 * (scripts/build-riga.mjs). package.json's `build` block, with three changes:
 *
 *  - no `.env` resource. Nothing reads it at run time (the address and the
 *    public key are built into the app); shipping it would ship whatever the
 *    root .env holds, production's address included;
 *  - the output goes to dist-riga/, not dist/;
 *  - the installer is named Wivo-Riga-Setup-<version>.exe, so it cannot be
 *    mistaken for the one the releases publish.
 */
const { build } = require('../package.json')

module.exports = {
  ...build,
  directories: { ...build.directories, output: 'dist-riga' },
  extraResources: build.extraResources.filter(r => r.from !== '.env'),
  artifactName: 'Wivo-Riga-Setup-${version}.${ext}',
}
