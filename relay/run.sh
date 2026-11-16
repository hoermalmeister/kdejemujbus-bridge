#!/data/data/com.termux/files/usr/bin/sh
# Smyčka, která drží DPKV relay v chodu: před každým spuštěním stáhne nejnovější verzi skriptu
# (opravy se tak dostanou do telefonu samy) a po pádu nebo plánovaném konci ho spustí znovu.
cd "$HOME/dpkv" || exit 1
while true; do
    curl -fsSL --max-time 30 -o dpkv-relay.mjs.new "https://raw.githubusercontent.com/hoermalmeister/kdejemujbus-bridge/main/relay/dpkv-relay.mjs" \
        && node --check dpkv-relay.mjs.new 2>/dev/null && mv dpkv-relay.mjs.new dpkv-relay.mjs
    node dpkv-relay.mjs
    sleep 10
done
