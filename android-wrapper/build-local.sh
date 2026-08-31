#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
SDK_ROOT="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$SDK_ROOT" ]; then
  echo "Set ANDROID_HOME or ANDROID_SDK_ROOT to an Android SDK containing platform 35 and build-tools 35.0.0."
  exit 1
fi
BUILD_TOOLS="$SDK_ROOT/build-tools/35.0.0"
PLATFORM_JAR="$SDK_ROOT/platforms/android-35/android.jar"
JAVAC_BIN="${JAVA_HOME:+$JAVA_HOME/bin/}javac"
if [ ! -x "$BUILD_TOOLS/aapt" ] || [ ! -f "$PLATFORM_JAR" ]; then
  echo "Android SDK platform 35 or build-tools 35.0.0 is missing."
  exit 1
fi
mkdir -p "$PROJECT_ROOT/app/build"
TEMP_BUILD="$(mktemp -d "$PROJECT_ROOT/app/build/arcade-local.XXXXXX")"
trap 'rm -rf "$TEMP_BUILD"' EXIT
mkdir -p "$TEMP_BUILD/gen" "$TEMP_BUILD/classes" "$TEMP_BUILD/dex" "$PROJECT_ROOT/app/build/outputs/apk/release"
"$BUILD_TOOLS/aapt" package -f -m -M "$PROJECT_ROOT/app/src/main/AndroidManifest.xml" -S "$PROJECT_ROOT/app/src/main/res" -I "$PLATFORM_JAR" -J "$TEMP_BUILD/gen" -F "$TEMP_BUILD/resources.apk"
mapfile -t SOURCES < <(find "$PROJECT_ROOT/app/src/main/java" "$TEMP_BUILD/gen" -name '*.java' -type f)
"$JAVAC_BIN" --release 8 -encoding UTF-8 -classpath "$PLATFORM_JAR" -d "$TEMP_BUILD/classes" "${SOURCES[@]}"
mapfile -t CLASSES < <(find "$TEMP_BUILD/classes" -name '*.class' -type f)
"$BUILD_TOOLS/d8" --min-api 23 --lib "$PLATFORM_JAR" --output "$TEMP_BUILD/dex" "${CLASSES[@]}"
cp "$TEMP_BUILD/resources.apk" "$TEMP_BUILD/unsigned.apk"
(cd "$TEMP_BUILD/dex" && "$BUILD_TOOLS/aapt" add "$TEMP_BUILD/unsigned.apk" classes.dex)
"$BUILD_TOOLS/zipalign" -f 4 "$TEMP_BUILD/unsigned.apk" "$TEMP_BUILD/aligned.apk"
KEYSTORE="${ARCADE_KEYSTORE_PATH:-}"
KEY_ALIAS="${ARCADE_KEY_ALIAS:-arcade}"
if [ -z "$KEYSTORE" ] || [ ! -f "$KEYSTORE" ]; then
  echo "Set ARCADE_KEYSTORE_PATH to an existing private Android signing keystore."
  exit 1
fi
if [ -z "${ARCADE_KEYSTORE_PASSWORD:-}" ]; then
  echo "Set ARCADE_KEYSTORE_PASSWORD before building a signed release."
  exit 1
fi
export ARCADE_KEY_PASSWORD="${ARCADE_KEY_PASSWORD:-$ARCADE_KEYSTORE_PASSWORD}"
OUTPUT="$PROJECT_ROOT/app/build/outputs/apk/release/Arcade.apk"
SIGNED_TEMP="$TEMP_BUILD/Arcade-signed.apk"
"$BUILD_TOOLS/apksigner" sign --ks "$KEYSTORE" --ks-key-alias "$KEY_ALIAS" --ks-pass env:ARCADE_KEYSTORE_PASSWORD --key-pass env:ARCADE_KEY_PASSWORD --out "$SIGNED_TEMP" "$TEMP_BUILD/aligned.apk"
"$BUILD_TOOLS/apksigner" verify --verbose --print-certs "$SIGNED_TEMP"
PUBLISHED_TEMP="$PROJECT_ROOT/app/build/outputs/apk/release/.Arcade.apk.$$.tmp"
cp "$SIGNED_TEMP" "$PUBLISHED_TEMP"
mv -f "$PUBLISHED_TEMP" "$OUTPUT"
echo "$OUTPUT"
