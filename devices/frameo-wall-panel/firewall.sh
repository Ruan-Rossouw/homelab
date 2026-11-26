#!/bin/sh
# Egress firewall for the wall panel, run as root ON the frame (`su -c`).
#
# The frame is an unpatched Android 7 device with a vendor updater, and the
# router (a TP-Link Deco) cannot restrict one device's outbound traffic. So
# the frame restricts itself: over Wi-Fi it may talk only to the homelab
# server (Home Assistant, Jellyfin and AdGuard DNS all live there), the
# router (DHCP, gateway), and NTP. Everything else, IPv6 included, is dropped.
# Replies to inbound connections (Home Assistant's ADB link) are allowed.
#
# iptables rules vanish on reboot. Home Assistant re-applies this script when
# the frame comes back (see wall_panel_power.yaml), so a copy lives on the
# frame at /data/local/wp-firewall.sh. The script is idempotent.
#
# Undo: `su -c "iptables -D OUTPUT -o wlan0 -j wp_out"` or just reboot.
SERVER=192.168.68.110
ROUTER=192.168.68.1

iptables -N wp_out 2>/dev/null
iptables -F wp_out
iptables -A wp_out -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A wp_out -d "$SERVER" -j ACCEPT
iptables -A wp_out -d "$ROUTER" -j ACCEPT
iptables -A wp_out -p udp --sport 68 --dport 67 -j ACCEPT
iptables -A wp_out -p udp --dport 123 -j ACCEPT
iptables -A wp_out -j DROP
iptables -C OUTPUT -o wlan0 -j wp_out 2>/dev/null || iptables -I OUTPUT 1 -o wlan0 -j wp_out

ip6tables -N wp_out6 2>/dev/null
ip6tables -F wp_out6
ip6tables -A wp_out6 -p icmpv6 -j ACCEPT
ip6tables -A wp_out6 -j DROP
ip6tables -C OUTPUT -o wlan0 -j wp_out6 2>/dev/null || ip6tables -I OUTPUT 1 -o wlan0 -j wp_out6
