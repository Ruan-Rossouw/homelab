# Frameo Wall Panel

A cheap Frameo digital photo frame (Bozztek CPF1011, Rockchip RK3126C,
Android 7.1.2, 1 GB RAM, 1280x800) repurposed as a Home Assistant
dashboard panel. This is not a Docker service, so it lives under
`devices/` instead of `services/`: there is no `compose.yml`, and the
"deployment" is an APK installed over USB.

## What It Is

A ~17 KB native Android app (`app/`): one full-screen `WebView` that loads
the `wall-panel` dashboard at `https://home-assistant.home/wall-panel/panel`, keeps the screen on, retries when HA is
unreachable, and registers as a home app so it launches at boot. No third
party kiosk app, no Play Store, no root, no flashing.

It was chosen over Fully Kiosk Browser because the frame is 32-bit ARM
(`armeabi-v7a`) with no Play Store, and a plain Java app has no native
code to match against the ABI.

## Decisions Worth Knowing

- **No flashing.** A full firmware replacement was investigated (the
  partition layout is standard Rockchip and a maskrom/loader path exists),
  and a full read-only backup was taken first. It turned out to be
  unnecessary: setting the app as the default home app is enough, and the
  frame boots straight into the dashboard.
- **TLS trust is app-local.** `home-assistant.home` uses a mkcert
  certificate. `build.sh` bundles only mkcert's **public** root CA into the
  APK (`res/raw/`, gitignored); the frame's system trust store is
  unchanged and the private CA key is never copied anywhere. The app
  refuses every other certificate error.
- **Frameo's own app is disabled, not removed.** `pm disable-user` is fully
  reversible with `pm enable`.

## Build

Needs `openjdk@17`, the Android SDK (`platforms;android-25`,
`build-tools;34.0.0`) and `mkcert`. No Gradle.

```bash
./app/build.sh   # produces app/kiosk.apk (gitignored)
```

The first build generates `app/debug.keystore` (gitignored). Never commit
it. To point the panel at a different dashboard, change `kiosk_url` in
`app/res/values/strings.xml` and rebuild.

## Install

```bash
adb -s <serial> install -r app/kiosk.apk
adb -s <serial> shell pm disable-user --user 0 net.frameo.frame
```

Then press Home on the frame and, in the "Select a Home app" chooser, pick
**Dashboard** and tap **Always**. Wait about two seconds after selecting
before tapping Always: the buttons are disabled at first.
`cmd package set-home-activity` does **not** survive a reboot, so the
on-screen chooser is the only reliable way. Sign in on the frame's
touchscreen with a dedicated **non-admin** HA user.

## Backlight Bridge

The app exposes `window.KioskBridge` to the dashboard so the
[wall-panel card](../../services/home-assistant/README.md#stage-5-wall-panel--scene-driven-display-card)
can set the screen brightness per scene:

- `KioskBridge.setBrightness(level)` — `level` 0.0–1.0, applied as a
  per-window override.
- `KioskBridge.version()` — currently `1`.

It only acts while the page on screen is served from the configured HA
host, so no other page the WebView visits can drive the screen. Android
clamps the backlight to the panel's own floor, which on this frame is
10/255 (about 4%): `Settings` brightness values of 0, 1 and 5 all read
back as 10. "Black at minimum" is therefore a faint glow, not off. A true
off would need the app to be a device administrator (`lockNow()`), and
waking it would then depend on HA reaching the app with the screen off;
not built.

Signing: `build.sh` generates `app/debug.keystore` on first run. An
install over an existing one only works if it is signed with the **same**
key, otherwise Android refuses it (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`)
and the only way forward is an uninstall, which also wipes the panel's HA
login. Keep that keystore somewhere safe outside the repo.

## Wireless ADB (screen off/on from Home Assistant)

With root, `setprop persist.internet.adb.enable 1` makes adbd listen on
TCP 5555 after every boot (the vendor `init.rk30board.rc` reads this
property, not `persist.adb.tcp.port`). Add the Home Assistant key's public
half to `/data/misc/adb/adb_keys` (one key per line). Then
`input keyevent 223` turns the display off and `224` on; the frame stays on
Wi-Fi while the screen is off.

## Network: Static IP, Not a DHCP Reservation

The frame joins the `M&R_IoT` network. Its Wi-Fi driver picks a **random MAC
address on every boot** (a pinned `wifimac.txt` is ignored), so a router
reservation can never match. Set a static IP on the frame itself instead:
Settings > Wi-Fi > long-press the network > Modify network > Advanced >
IP settings: Static. Current values: IP `192.168.68.201`, gateway
`192.168.68.1`, prefix 24, DNS `192.168.68.110` (AdGuard, which answers the
`.home` names the dashboard needs). Leave the password as "(unchanged)".
After saving, toggle Wi-Fi once (`svc wifi disable; svc wifi enable` as root)
if the default route is missing. The Home Assistant ADB integration connects
to that address.

## Revert

```bash
adb -s <serial> shell pm enable net.frameo.frame
adb -s <serial> uninstall com.local.kiosk
```

## Security Notes

Read this before treating the frame as trusted. It is a consumer device
running an unpatched OS.

- Android 7.1.2 on a 3.10 kernel: no security updates, and a `su` binary
  is present in `/system/xbin`.
- A vendor updater (`com.adups.fota`) starts at boot with internet access
  and cannot be audited. It can be disabled the same reversible way as
  Frameo: `pm disable-user --user 0 com.adups.fota`.
- The frame holds a Home Assistant login token. Use a dedicated non-admin
  user so a lost or compromised frame cannot change the system.
- The strongest control is on the router, not the device: allow the frame
  only to Home Assistant over 443 plus DHCP, DNS and NTP, and block all
  other egress. Give it a DHCP reservation first.

## Operational Notes

- The 1 GB RAM is tight but workable with Frameo disabled (roughly 500 MB
  free including cache). Keep the panel's dashboard view light: heavy
  history graphs and live camera streams will lag on this CPU.
- Stock firmware images (all partitions except `userdata`) were backed up
  to local storage outside this repository. They are proprietary vendor
  firmware and do not belong in Git.
- Sounds are silenced on the frame: the system sound settings plus the
  stock keyboard's `sound_on=false` preference.
