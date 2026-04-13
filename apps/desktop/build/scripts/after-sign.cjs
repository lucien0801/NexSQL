'use strict';
/**
 * electron-builder afterSign hook.
 *
 * Problem: Electron Framework ships pre-signed with the Electron team's Team ID.
 * When we sign the outer app ad-hoc (no certificate), Team ID becomes empty.
 * macOS 13+ (and especially 26+) rejects loading a dylib whose Team ID differs
 * from the process Team ID, causing a fatal DYLD crash at launch.
 *
 * Fix: re-sign the entire .app bundle with --deep --force after electron-builder's
 * signing pass, so every nested binary/framework gets the same (empty) ad-hoc
 * Team ID as the outer executable.
 */

const { execSync } = require('child_process');
const path = require('path');

exports.default = async function afterSign(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== 'darwin') return;

  // Skip if a real Developer ID was used (real signing handles this correctly).
  const identity = packager.platformSpecificBuildOptions.identity;
  if (identity && identity !== '-' && identity !== null) return;

  const appPath = path.join(appOutDir, `${packager.appInfo.productFilename}.app`);
  console.log(`\n[after-sign] Re-signing with --deep to unify Team IDs: ${appPath}\n`);
  execSync(`codesign --deep --force --sign - "${appPath}"`, { stdio: 'inherit' });
};
