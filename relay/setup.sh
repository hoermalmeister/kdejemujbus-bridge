#!/data/data/com.termux/files/usr/bin/bash
# Instalace DPKV relay do Termuxu. Spuštění (klíč dostaneš od můstku/Clauda):
#   curl -fsSL https://raw.githubusercontent.com/hoermalmeister/kdejemujbus-bridge/main/relay/setup.sh | bash -s KLÍČ
set -e
KEY="$1"
if [ -z "$KEY" ]; then echo "Chybí klíč: ... | bash -s KLÍČ"; exit 1; fi
BASE="https://raw.githubusercontent.com/hoermalmeister/kdejemujbus-bridge/main/relay"

echo "== Instaluji Node.js =="
yes | pkg update -y >/dev/null 2>&1 || true
pkg install -y nodejs-lts curl >/dev/null 2>&1 || pkg install -y nodejs curl

echo "== Stahuji skript =="
mkdir -p "$HOME/dpkv"
cd "$HOME/dpkv"
curl -fsSL -o dpkv-relay.mjs "$BASE/dpkv-relay.mjs"
curl -fsSL -o run.sh "$BASE/run.sh"
chmod +x run.sh
printf '%s' "$KEY" > key
chmod 600 key

echo "== Automatické spuštění po restartu telefonu (Termux:Boot) =="
mkdir -p "$HOME/.termux/boot"
cat > "$HOME/.termux/boot/start-dpkv.sh" <<'BOOT'
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
cd "$HOME/dpkv" && nohup ./run.sh > /dev/null 2>&1 &
BOOT
chmod +x "$HOME/.termux/boot/start-dpkv.sh"

echo "== Spouštím =="
pkill -f "dpkv/run.sh" 2>/dev/null || true
pkill -f "dpkv-relay.mjs" 2>/dev/null || true
sh "$HOME/.termux/boot/start-dpkv.sh"
sleep 20
echo "== Posledni zaznamy logu =="
tail -n 8 "$HOME/dpkv/relay.log" 2>/dev/null || echo "(log zatim prazdny)"
echo
echo "Hotovo. Relay bezi na pozadi. Stav: tail -f ~/dpkv/relay.log"
