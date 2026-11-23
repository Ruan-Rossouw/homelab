#!/usr/bin/env bash
# Builds kiosk.apk with the raw Android SDK tools (no Gradle).
# Needs: openjdk@17, Android SDK (platform android-25, build-tools 34.0.0),
# and mkcert (its public root CA is bundled so the app trusts the
# internal HTTPS certificate; the private key is never touched).
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export PATH="$JAVA_HOME/bin:$PATH"
SDK="$HOME/Library/Android/sdk"
BT="$SDK/build-tools/34.0.0"
PLAT="$SDK/platforms/android-25/android.jar"
mkdir -p res/raw
cp "$(mkcert -CAROOT)/rootCA.pem" res/raw/mkcert_ca.pem
rm -rf out && mkdir -p out/gen out/classes
"$BT/aapt2" compile --dir res -o out/res.zip
"$BT/aapt2" link -o out/base.apk -I "$PLAT" --manifest AndroidManifest.xml --java out/gen out/res.zip
find src out/gen -name '*.java' > out/sources.txt
javac -source 8 -target 8 -bootclasspath "$PLAT" -d out/classes @out/sources.txt 2>&1 | grep -v "warning" || true
"$BT/d8" --min-api 25 --lib "$PLAT" --output out out/classes/com/local/kiosk/*.class
cp out/base.apk out/unsigned.apk
(cd out && zip -q -j unsigned.apk classes.dex)
"$BT/zipalign" -f 4 out/unsigned.apk out/aligned.apk
# Local signing key, generated on first build and gitignored.
[ -f debug.keystore ] || keytool -genkeypair -keystore debug.keystore -storepass android -keypass android -alias kiosk -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=kiosk" >/dev/null 2>&1
"$BT/apksigner" sign --ks debug.keystore --ks-pass pass:android --key-pass pass:android --out kiosk.apk out/aligned.apk
ls -l kiosk.apk
