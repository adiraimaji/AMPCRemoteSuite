#!/bin/sh
# Builds and signs the AM PC Remote Android APK without Gradle.
#
# Works in Termux and on any POSIX shell with a JDK plus Android build tools.
# Everything it reads lives in this folder:
#
#   android.jar            platform jar (or point SDK/ANDROID_JAR at one)
#   keystore.properties    signing settings (copy keystore.properties.example)
#   keystore.jks           signing key (path set by storeFile)
#
# Usage:
#   sh build.sh
#   SDK=/path/to/android.jar sh build.sh
#   ANDROID_HOME=$HOME/Android/Sdk BUILD_TOOLS=$HOME/Android/Sdk/build-tools/35.0.0 sh build.sh
#   INSTALL=1 sh build.sh
#
# Environment:
#   SDK                    android.jar file or Android SDK directory
#   ANDROID_JAR            explicit path to android.jar
#   ANDROID_HOME           Android SDK directory
#   BUILD_TOOLS            directory containing aapt2/d8/zipalign/apksigner
#   AAPT2 / AAPT / D8 / DX / ZIPALIGN / APKSIGNER / JAVAC / JAR
#                          explicit tool paths
#   KEYSTORE_PROPERTIES    alternate signing properties file
#   INSTALL=1              install over adb after building
#   LAUNCH=1               launch the app after installing
#   ADB                    explicit adb path
#
# Termux packages that cover the toolchain:
#   pkg install openjdk-17 aapt2 d8 apksigner zip findutils
#   (zipalign is optional; the APK is still installable without it)

set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

BUILD_DIR="$ROOT/.build"
OUT_DIR="$BUILD_DIR/out"
GEN_DIR="$OUT_DIR/gen"
CLASSES_DIR="$OUT_DIR/classes"
DEX_DIR="$OUT_DIR/dex"
DIST_DIR="$ROOT/dist"
UNSIGNED_APK="$OUT_DIR/unsigned.apk"
ALIGNED_APK="$OUT_DIR/aligned.apk"
FINAL_APK="$DIST_DIR/AM-PC-Remote-1.0.0.apk"

fail() {
  printf '\nBuild failed: %s\n' "$1" >&2
  exit 1
}

exists() {
  command -v "$1" >/dev/null 2>&1
}

# ---------------------------------------------------------------- signing
PROPS_FILE=${KEYSTORE_PROPERTIES:-"$ROOT/keystore.properties"}
[ -f "$PROPS_FILE" ] || fail "Signing settings not found: $PROPS_FILE
Copy keystore.properties.example to keystore.properties and fill in your values."

read_prop() {
  key=$1
  value=""
  while IFS= read -r line || [ -n "$line" ]; do
    line=$(printf '%s' "$line" | tr -d '\015')
    case "$line" in
      ''|'#'*|'!'*) continue ;;
    esac
    name=${line%%=*}
    name=$(printf '%s' "$name" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    [ "$name" = "$key" ] || continue
    value=${line#*=}
    value=$(printf '%s' "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  done < "$PROPS_FILE"
  case "$value" in
    \"*\") value=${value#\"}; value=${value%\"} ;;
    \'*\') value=${value#\'}; value=${value%\'} ;;
  esac
  printf '%s' "$value"
}

STORE_FILE=$(read_prop storeFile)
[ -n "$STORE_FILE" ] || STORE_FILE=keystore.jks
STORE_PASSWORD=$(read_prop storePassword)
KEY_ALIAS=$(read_prop keyAlias)
KEY_PASSWORD=$(read_prop keyPassword)
[ -n "$KEY_PASSWORD" ] || KEY_PASSWORD=$STORE_PASSWORD

[ -n "$STORE_PASSWORD" ] || fail "keystore.properties must define storePassword."
[ -n "$KEY_ALIAS" ] || fail "keystore.properties must define keyAlias."

case "$STORE_FILE" in
  "~/"*) STORE_FILE="$HOME/${STORE_FILE#\~/}" ;;
  /*) ;;
  *) STORE_FILE="$ROOT/$STORE_FILE" ;;
esac
[ -f "$STORE_FILE" ] || fail "Signing keystore not found: $STORE_FILE"

# ---------------------------------------------------------------- toolchain
# BUILD_TOOLS can be supplied directly or found in an Android SDK.
if [ -z "${BUILD_TOOLS:-}" ]; then
  for base in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" "$HOME/Android/Sdk"; do
    [ -n "$base" ] || continue
    if [ -d "$base/build-tools" ]; then
      newest=$(ls -1d "$base"/build-tools/*/ 2>/dev/null | sort -V | tail -n 1 || true)
      if [ -n "$newest" ]; then
        BUILD_TOOLS=${newest%/}
        break
      fi
    fi
  done
fi

find_build_tool() {
  explicit=$1
  name=$2
  if [ -n "$explicit" ]; then
    printf '%s' "$explicit"
    return 0
  fi
  if exists "$name"; then
    command -v "$name"
    return 0
  fi
  if [ -n "${BUILD_TOOLS:-}" ]; then
    for candidate in "$BUILD_TOOLS/$name" "$BUILD_TOOLS/$name.exe"; do
      if [ -f "$candidate" ]; then
        printf '%s' "$candidate"
        return 0
      fi
    done
  fi
  return 1
}

# android.jar: explicit jar/SDK first, then a local copy, then ANDROID_HOME.
ANDROID_JAR_PATH=${ANDROID_JAR:-}
if [ -z "$ANDROID_JAR_PATH" ] && [ -n "${SDK:-}" ]; then
  if [ -f "$SDK" ]; then
    ANDROID_JAR_PATH=$SDK
  elif [ -f "$SDK/android.jar" ]; then
    ANDROID_JAR_PATH=$SDK/android.jar
  elif [ -d "$SDK/platforms" ]; then
    newest=$(ls -1d "$SDK"/platforms/android-*/ 2>/dev/null | sort -V | tail -n 1 || true)
    if [ -n "$newest" ]; then
      ANDROID_JAR_PATH="${newest%/}/android.jar"
    fi
  fi
fi
if [ -z "$ANDROID_JAR_PATH" ] && [ -f "$ROOT/android.jar" ]; then
  ANDROID_JAR_PATH=$ROOT/android.jar
fi
if [ -z "$ANDROID_JAR_PATH" ]; then
  for base in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}"; do
    [ -n "$base" ] || continue
    if [ -d "$base/platforms" ]; then
      newest=$(ls -1d "$base"/platforms/android-*/ 2>/dev/null | sort -V | tail -n 1 || true)
      if [ -n "$newest" ]; then
        ANDROID_JAR_PATH="${newest%/}/android.jar"
        break
      fi
    fi
  done
fi
[ -n "$ANDROID_JAR_PATH" ] && [ -f "$ANDROID_JAR_PATH" ] || fail "android.jar not found.
Put it at $ROOT/android.jar, or run: SDK=/path/to/android.jar sh build.sh"

AAPT2_BIN=$(find_build_tool "${AAPT2:-}" aapt2 || true)
AAPT_BIN=$(find_build_tool "${AAPT:-}" aapt || true)
D8_BIN=$(find_build_tool "${D8:-}" d8 || true)
DX_BIN=$(find_build_tool "${DX:-}" dx || true)
ZIPALIGN_BIN=$(find_build_tool "${ZIPALIGN:-}" zipalign || true)
APKSIGNER_BIN=$(find_build_tool "${APKSIGNER:-}" apksigner || true)
APKSIGNER_JAR=${APKSIGNER_JAR:-}

if [ -n "$APKSIGNER_BIN" ]; then
  case "$APKSIGNER_BIN" in
    *.jar)
      APKSIGNER_JAR=$APKSIGNER_BIN
      APKSIGNER_BIN=""
      ;;
  esac
fi
if [ -z "$APKSIGNER_BIN" ] && [ -z "$APKSIGNER_JAR" ] && [ -n "${BUILD_TOOLS:-}" ] && [ -f "$BUILD_TOOLS/lib/apksigner.jar" ]; then
  APKSIGNER_JAR="$BUILD_TOOLS/lib/apksigner.jar"
fi

if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/javac" ]; then
  JAVAC=$JAVA_HOME/bin/javac
  JAR=$JAVA_HOME/bin/jar
  JAVA=$JAVA_HOME/bin/java
else
  JAVAC=${JAVAC:-$(command -v javac || true)}
  JAR=${JAR:-$(command -v jar || true)}
  JAVA=${JAVA:-$(command -v java || true)}
fi

[ -n "$JAVAC" ] && [ -x "$JAVAC" ] || fail "javac not found. Set JAVA_HOME or install a JDK (Termux: pkg install openjdk-17)."
[ -n "$JAR" ] && [ -x "$JAR" ] || fail "jar not found. Set JAVA_HOME or install a JDK."
[ -n "$AAPT2_BIN" ] || [ -n "$AAPT_BIN" ] || fail "aapt2/aapt not found.
Termux: pkg install aapt2   (or: pkg install aapt)
Other systems: set BUILD_TOOLS to an Android build-tools directory."
[ -n "$D8_BIN" ] || [ -n "$DX_BIN" ] || fail "d8/dx not found.
Termux: pkg install d8
Other systems: set BUILD_TOOLS to an Android build-tools directory."
if [ -z "$APKSIGNER_BIN" ] && [ -z "$APKSIGNER_JAR" ]; then
  fail "apksigner not found. Termux: pkg install apksigner   or set BUILD_TOOLS."
fi

run_apksigner() {
  if [ -n "$APKSIGNER_JAR" ]; then
    [ -n "$JAVA" ] || fail "java not found; needed to run apksigner.jar."
    "$JAVA" -jar "$APKSIGNER_JAR" "$@"
  else
    "$APKSIGNER_BIN" "$@"
  fi
}

printf 'android.jar: %s\n' "$ANDROID_JAR_PATH"
if [ -n "${BUILD_TOOLS:-}" ]; then
  printf 'Build tools: %s\n' "$BUILD_TOOLS"
fi
printf 'JDK:         %s\n' "$JAVAC"
printf 'Keystore:    %s\n' "$STORE_FILE"

# ---------------------------------------------------------------- clean
rm -rf "$BUILD_DIR"
mkdir -p "$GEN_DIR" "$CLASSES_DIR" "$DEX_DIR" "$DIST_DIR"

# ---------------------------------------------------------------- resources
if [ -n "$AAPT2_BIN" ]; then
  printf '\nCompiling resources with aapt2...\n'
  "$AAPT2_BIN" compile --dir "$ROOT/res" -o "$OUT_DIR/resources.zip"
  printf 'Linking resources and manifest...\n'
  "$AAPT2_BIN" link \
    -o "$UNSIGNED_APK" \
    -I "$ANDROID_JAR_PATH" \
    --manifest "$ROOT/AndroidManifest.xml" \
    --java "$GEN_DIR" \
    --auto-add-overlay \
    "$OUT_DIR/resources.zip"
else
  printf '\nCompiling resources with aapt...\n'
  "$AAPT_BIN" package -f -m \
    -J "$GEN_DIR" \
    -M "$ROOT/AndroidManifest.xml" \
    -S "$ROOT/res" \
    -I "$ANDROID_JAR_PATH" \
    -F "$UNSIGNED_APK"
fi

# ---------------------------------------------------------------- java
printf 'Compiling Java...\n'
SOURCES_LIST="$OUT_DIR/sources.txt"
find "$ROOT/java" "$GEN_DIR" -type f -name '*.java' > "$SOURCES_LIST"
ARG_FILE="$OUT_DIR/javac.args"
JAVAC_VERSION=$("$JAVAC" -version 2>&1 | head -n 1)
{
  case "$JAVAC_VERSION" in
    javac\ 1.8*) printf '%s\n' '-source' '8' '-target' '8' ;;
    *) printf '%s\n' '--release' '8' ;;
  esac
  printf '%s\n' '-encoding' 'UTF-8' '-classpath' "$ANDROID_JAR_PATH" '-d' "$CLASSES_DIR"
  while IFS= read -r src; do
    printf '"%s"\n' "$src"
  done < "$SOURCES_LIST"
} > "$ARG_FILE"
"$JAVAC" "@$ARG_FILE"

printf 'Dexing...\n'
CLASSES_JAR="$OUT_DIR/classes.jar"
(cd "$CLASSES_DIR" && "$JAR" cf "$CLASSES_JAR" .)
if [ -n "$D8_BIN" ]; then
  "$D8_BIN" --min-api 23 --lib "$ANDROID_JAR_PATH" --output "$DEX_DIR" "$CLASSES_JAR"
else
  "$DX_BIN" --dex --min-api=23 --output="$DEX_DIR/classes.dex" "$CLASSES_JAR"
fi
[ -f "$DEX_DIR/classes.dex" ] || fail "classes.dex was not produced."

printf 'Adding classes.dex to the APK...\n'
if exists zip; then
  (cd "$DEX_DIR" && zip -q -j "$UNSIGNED_APK" classes.dex)
else
  (cd "$DEX_DIR" && "$JAR" uf "$UNSIGNED_APK" classes.dex)
fi

if [ -n "$ZIPALIGN_BIN" ]; then
  printf 'Aligning...\n'
  "$ZIPALIGN_BIN" -f -p 4 "$UNSIGNED_APK" "$ALIGNED_APK"
else
  printf 'Warning: zipalign not found; skipping alignment (still installable).\n'
  cp "$UNSIGNED_APK" "$ALIGNED_APK"
fi

printf 'Signing...\n'
run_apksigner sign \
  --ks "$STORE_FILE" \
  --ks-key-alias "$KEY_ALIAS" \
  --ks-pass "pass:$STORE_PASSWORD" \
  --key-pass "pass:$KEY_PASSWORD" \
  --out "$FINAL_APK" \
  "$ALIGNED_APK"

run_apksigner verify "$FINAL_APK"
CERT_INFO=$(run_apksigner verify --print-certs "$FINAL_APK")
printf '%s\n' "$CERT_INFO" | head -n 3

SIZE=$(wc -c < "$FINAL_APK" | tr -d ' ')
printf '\nBuilt %s\n' "$FINAL_APK"
printf 'Size: %s bytes\n' "$SIZE"
if exists sha256sum; then
  printf 'SHA-256: %s\n' "$(sha256sum "$FINAL_APK" | cut -d ' ' -f 1)"
fi

# ---------------------------------------------------------------- install
if [ "${INSTALL:-0}" = "1" ]; then
  ADB_BIN=${ADB:-$(command -v adb || true)}
  [ -n "$ADB_BIN" ] || fail "adb not found. Install Android platform-tools or set ADB."
  "$ADB_BIN" install -r "$FINAL_APK"
  if [ "${LAUNCH:-0}" = "1" ]; then
    "$ADB_BIN" shell monkey -p com.adiraimaji.ampcremote -c android.intent.category.LAUNCHER 1
  fi
fi
