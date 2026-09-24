#!/bin/sh
# Destinations at runtime, no rebuild (docs/destinations.md):
#   DESTINATION_HOSTS     comma-separated origins added to the CSP `connect-src` (the browser blocks
#                         uploads to any origin that is not listed)
#   DESTINATIONS_DEFAULT  JSON array of destinations preset for every user, written to config.json
#                         when no config.json is mounted
set -e

entrypoint_log() {
    if [ -z "${NGINX_ENTRYPOINT_QUIET_LOGS:-}" ]; then
        echo "$@"
    fi
}

ROOT="${DESTINATIONS_HTML_ROOT:-/usr/share/nginx/html}"

if [ -n "${DESTINATION_HOSTS:-}" ]; then
    HOSTS=$(printf '%s' "$DESTINATION_HOSTS" | tr ',' ' ' | tr -s ' ')
    case "$HOSTS" in
        *[\;\"\\]*) echo "ERROR: DESTINATION_HOSTS contains an invalid character" >&2; exit 1 ;;
    esac
    entrypoint_log "DESTINATION_HOSTS: allowing uploads to $HOSTS"
    for conf in /etc/nginx/security-headers.conf /etc/nginx/security-headers-docs.conf; do
        [ -f "$conf" ] || continue
        if grep -q "bentopdf-destination-hosts" "$conf"; then
            continue
        fi
        sed -i "s|connect-src 'self'|connect-src 'self' $HOSTS|" "$conf"
        printf '# bentopdf-destination-hosts: %s\n' "$HOSTS" >> "$conf"
    done
fi

if [ -n "${DESTINATIONS_DEFAULT:-}" ]; then
    if [ -f "$ROOT/config.json" ]; then
        entrypoint_log "DESTINATIONS_DEFAULT: $ROOT/config.json already exists, add a \"destinations\" key there instead"
    else
        entrypoint_log "DESTINATIONS_DEFAULT: writing $ROOT/config.json"
        printf '{ "destinations": %s }\n' "$DESTINATIONS_DEFAULT" > "$ROOT/config.json"
    fi
fi

exit 0
