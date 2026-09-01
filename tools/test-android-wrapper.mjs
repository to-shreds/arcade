#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const android = path.join(root, 'android-wrapper');
const source = relative => readFile(path.join(android, relative), 'utf8');

const [manifest, gradle, activity, baseActivity, archive, storage] = await Promise.all([
  source('app/src/main/AndroidManifest.xml'),
  source('app/build.gradle'),
  source('app/src/main/java/com/familyarcade/platform/MainActivity.java'),
  source('app/src/main/java/com/familyarcade/platform/BaseActivity.java'),
  source('app/src/main/java/com/familyarcade/platform/OfflineArchiveManager.java'),
  source('app/src/main/java/com/familyarcade/platform/ArcadeStorage.java')
]);

const manifestVersion = manifest.match(/android:versionName="([^"]+)"/)?.[1];
const manifestCode = manifest.match(/android:versionCode="([0-9]+)"/)?.[1];
const gradleVersion = gradle.match(/\bversionName\s+"([^"]+)"/)?.[1];
const gradleCode = gradle.match(/\bversionCode\s+([0-9]+)/)?.[1];
assert.equal(manifestVersion, '2.4.0', 'Android manifest release version');
assert.equal(gradleVersion, manifestVersion, 'Gradle and manifest versionName agree');
assert.equal(gradleCode, manifestCode, 'Gradle and manifest versionCode agree');
assert.match(manifest, /android\.permission\.CAMERA/, 'camera permission declared');
assert.match(manifest, /android\.hardware\.camera\.any" android:required="false"/, 'camera is optional hardware');
assert.match(manifest, /android\.permission\.RECORD_AUDIO/, 'existing microphone permission is preserved');
assert.match(manifest, /android\.hardware\.microphone" android:required="false"/, 'microphone remains optional hardware');
assert.match(activity, /PermissionRequest\.RESOURCE_VIDEO_CAPTURE/, 'WebView video capture is handled');
assert.match(activity, /public void setGameOrientation\(String orientation\)/, 'shell has non-navigating orientation hook');
assert.match(activity, /@JavascriptInterface\s+public boolean hasOfflineArchive\(\)/, 'shell can verify the native archive before bypassing browser readiness');
assert.match(activity, /new ArcadeBridge\(boundGeneration, boundOffline\)/, 'native bridge records whether this exact WebView was archive-bound');
assert.match(activity, /private final boolean boundOffline;[\s\S]*ArcadeBridge\(int generation, boolean boundOffline\)/, 'native bridge retains its immutable archive binding');
assert.match(activity, /public boolean hasOfflineArchive\(\) \{[\s\S]*?return boundOffline[\s\S]*?generation > 0[\s\S]*?generation == webGeneration[\s\S]*?remoteMode[\s\S]*?forceOffline[\s\S]*?manager != null[\s\S]*?manager\.isReady\(\);/, 'only the live archive-bound WebView with a validated archive satisfies Nearby readiness');
assert.match(activity, /@JavascriptInterface\s+public void setNearbyNetworkPaused\(boolean paused\)/, 'shell can pause native archive networking for Nearby');
assert.match(activity, /setNearbyNetworkPaused\(boolean paused\) \{[\s\S]*?if \(generation != webGeneration\) return;/, 'a replaced WebView cannot resume native networking through a stale bridge');
assert.match(activity, /manager\.setNetworkPaused\(paused\)/, 'Nearby bridge delegates to the archive network gate');
assert.match(activity, /if \(wasPaused && !paused\) resumeNativeArchiveUpdate\(\)/, 'only a real transition out of Nearby queues a fresh archive update');
assert.match(activity, /archiveResumeRequested\.set\(true\)[\s\S]*archiveResumeRequested\.getAndSet\(false\)[\s\S]*resumeNativeArchiveUpdate\(\)/, 'a pause/resume race cannot strand the deferred native update');
assert.match(archive, /void setNetworkPaused\(boolean paused\)[\s\S]*activeNetworkConnection[\s\S]*connection\.disconnect\(\)/, 'pausing Nearby disconnects the exact in-flight native transfer');
assert.match(archive, /if \(networkPaused\)[\s\S]*throw new IOException\("Offline archive networking is paused for Nearby Arcade"\)/, 'paused archive networking rejects new public requests');
assert.equal((archive.match(/ensureNetworkAllowed\(\);\s*int status = connection\.getResponseCode\(\);/g) || []).length, 2, 'manifest and file transfers recheck the Nearby gate immediately before connecting');
assert.match(archive, /ensureNetworkAllowed\(\);\s*promote\(staging, remote\)/, 'a paused update cannot promote a partial staging tree over the LKG');
assert.doesNotMatch(archive, /HttpURLConnection connection = openConnection\(new URL\(REMOTE_BASE/, 'all public archive requests pass through the Nearby network gate');
assert.match(activity, /delegateToArcadeShell\("handleNativeBack"/, 'physical Back delegates to shell');
assert.match(activity, /delegateToArcadeShell\("goHome"/, 'game Home delegates to shell');
assert.match(activity, /getQueryParameter\("game"\)\s*!=\s*null/, 'shell game query is not mistaken for the Arcade home screen');
assert.match(activity, /"sec-fetch-dest"\.equalsIgnoreCase\(name\)/, 'iframe document failures are classified separately from subresources');
assert.match(activity, /"iframe"\.equals\(destination\)/, 'iframe navigation is treated as a recoverable document load');
assert.match(activity, /boundRemote && isDocumentRequest\(request\) && isRemoteArcadeUri/, 'remote recovery is limited to Arcade document requests');
assert.match(activity, /requestStorageRecovery\([^;]+isDocumentRequest\(request\)\)/, 'local-folder iframe documents use the same narrow recovery classifier');
assert.doesNotMatch(baseActivity, /FLAG_KEEP_SCREEN_ON/, 'wrapper no longer keeps every screen awake');
assert.match(archive, /application\/manifest\+json/, 'native archive serves webmanifest MIME');
assert.match(storage, /application\/manifest\+json/, 'selected-folder server serves webmanifest MIME');
const shell = await readFile(path.join(root, 'arcade-shell.js'), 'utf8');
assert.match(shell, /ArcadeNative\?\.setNearbyNetworkPaused\?\.\(mode === "nearby"\)/, 'shell synchronizes Nearby state with native archive networking');
console.log(`Android wrapper source verified: ${manifestVersion} (${manifestCode})`);
