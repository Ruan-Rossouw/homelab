#!/usr/bin/env python3
"""Send the keep-alive page to an IPP printer. Stdlib only, so it runs
inside the stock Home Assistant container with nothing installed.

    print_purge.py <printer-host> [--validate]

--validate sends an IPP Validate-Job instead of Print-Job: the printer
checks it would accept the job, but nothing is printed or fed.

Exit codes: 0 accepted, 1 printer rejected the job, 2 could not reach it.
"""
import http.client
import ssl
import struct
import sys
from pathlib import Path

PAGE = Path(__file__).with_name("purge-page.jpg")
PRINT_JOB, VALIDATE_JOB = 0x0002, 0x0004


def attr(tag, name, value):
    n, v = name.encode(), value.encode()
    return struct.pack(">BH", tag, len(n)) + n + struct.pack(">H", len(v)) + v


def build_request(host, operation):
    body = struct.pack(">BBHI", 2, 0, operation, 1)  # IPP 2.0, request-id 1
    body += b"\x01"  # operation-attributes-tag
    body += attr(0x47, "attributes-charset", "utf-8")
    body += attr(0x48, "attributes-natural-language", "en")
    body += attr(0x45, "printer-uri", f"ipps://{host}:631/ipp/print")
    body += attr(0x42, "requesting-user-name", "homeassistant")
    body += attr(0x42, "job-name", "keepalive-purge")
    body += attr(0x49, "document-format", "image/jpeg")
    body += b"\x02"  # job-attributes-tag
    body += attr(0x44, "print-scaling", "fill")
    body += b"\x03"  # end-of-attributes-tag
    return body


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1:
        sys.exit(__doc__)
    host = args[0]
    validate = "--validate" in sys.argv
    request = build_request(host, VALIDATE_JOB if validate else PRINT_JOB)
    if not validate:
        request += PAGE.read_bytes()

    try:
        # The printer refuses plain HTTP (426 Upgrade Required) and presents a
        # self-signed certificate, so TLS is required but cannot be verified.
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        conn = http.client.HTTPSConnection(host, 631, timeout=30, context=ctx)
        conn.request("POST", "/ipp/print", request, {"Content-Type": "application/ipp"})
        reply = conn.getresponse().read()
    except OSError as err:
        print(f"unreachable: {err}")
        return 2

    status = struct.unpack(">H", reply[2:4])[0] if len(reply) >= 4 else 0xFFFF
    ok = status < 0x0100  # 0x0000-0x00ff are the IPP success codes
    print(f"{'accepted' if ok else 'rejected'}: ipp-status 0x{status:04x}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
