#!/bin/sh
# 在 Mint 执行：sh ~/sera-account-lab/deploy/start_public_test.sh
set -eu
umask 077
cd "$HOME/sera-account-lab"
cleanup() {
    systemctl --user stop sera-website-public.service sera-website-tunnel.service
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
systemctl --user stop sera-website-public.service sera-website-tunnel.service
systemctl --user start sera-website-tunnel.service
host=""
attempt=0
while [ "$attempt" -lt 60 ]; do
    if ! systemctl --user is-active --quiet sera-website-tunnel.service; then
        echo '隧道未能启动，请查看 journalctl --user -u sera-website-tunnel -n 30' >&2
        exit 1
    fi
    host=$(sed -nE 's/.*https:\/\/([a-z0-9]+(-[a-z0-9]+)*\.trycloudflare\.com).*/\1/p' .local/tunnel.log | head -n 1)
    [ -z "$host" ] || break
    attempt=$((attempt + 1))
    sleep 1
done
if [ -z "$host" ]; then
    echo '60 秒内未能取得临时网址，请检查隧道日志。' >&2
    exit 1
fi
printf 'DJANGO_PUBLIC_HOST=%s\n' "$host" > .local/public.env.new
mv .local/public.env.new .local/public.env
systemctl --user start sera-website-public.service
attempt=0
while [ "$attempt" -lt 60 ]; do
    if curl --fail --silent --noproxy '*' --max-time 2 \
        -H "Host: $host" -H 'X-Forwarded-Proto: https' \
        http://127.0.0.1:8002/health/ >/dev/null && \
        curl --fail --silent --noproxy '*' --max-time 2 \
        http://127.0.0.1:20242/ready >/dev/null; then
        trap - EXIT HUP INT TERM
        printf '临时网址：https://%s\n' "$host"
        exit 0
    fi
    attempt=$((attempt + 1))
    sleep 1
done
echo '公网后端或隧道数据连接未能就绪，请查看服务日志。' >&2
exit 1
