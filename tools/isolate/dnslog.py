#!/usr/bin/env python3
"""usage: dnslog.py --log FILE [--listen 127.0.0.53:53] [--ready FILE]

A logging DNS stub for the isolate network namespace. Every query is written
to FILE as one JSON line (name, type, answer). A and ANY queries get a unique
sinkhole address in 10.201.0.0/16 per name, so a process that bypasses the
proxy sends its packets to an address the checker maps back to the name it
looked up; nftables then logs and drops them. Other types get an empty answer.
"""
import json
import socket
import struct
import sys
import time

TYPE_NAMES = {1: "A", 2: "NS", 5: "CNAME", 6: "SOA", 12: "PTR", 15: "MX", 16: "TXT", 28: "AAAA", 33: "SRV", 64: "SVCB", 65: "HTTPS", 255: "ANY"}


def parse_question(packet):
    labels = []
    offset = 12
    while True:
        length = packet[offset]
        offset += 1
        if length == 0:
            break
        labels.append(packet[offset:offset + length].decode("ascii", "replace"))
        offset += length
    qtype, qclass = struct.unpack("!HH", packet[offset:offset + 4])
    return ".".join(labels).lower(), qtype, qclass, offset + 4


def main(arguments):
    if "-h" in arguments or "--help" in arguments:
        print(__doc__)
        return 0
    options = {"--listen": "127.0.0.53:53", "--log": None, "--ready": None}
    while arguments:
        key = arguments.pop(0)
        if key not in options or not arguments:
            print(__doc__, file=sys.stderr)
            return 64
        options[key] = arguments.pop(0)
    if not options["--log"]:
        print(__doc__, file=sys.stderr)
        return 64
    host, _, port = options["--listen"].rpartition(":")
    server = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    server.bind((host, int(port)))
    if options["--ready"]:
        with open(options["--ready"], "w") as marker:
            marker.write("ready")
    addresses = {}
    log = open(options["--log"], "a", encoding="utf-8", buffering=1)
    while True:
        packet, client = server.recvfrom(4096)
        if len(packet) < 17:
            continue
        try:
            name, qtype, qclass, end = parse_question(packet)
        except (IndexError, struct.error):
            continue
        answer = None
        if qtype in (1, 255) and qclass == 1:
            if name not in addresses:
                index = len(addresses) + 1
                addresses[name] = f"10.201.{(index >> 8) & 255}.{index & 255}"
            answer = addresses[name]
        log.write(json.dumps({"ts": round(time.time(), 3), "name": name, "type": TYPE_NAMES.get(qtype, str(qtype)), "answer": answer, "client_port": client[1]}, sort_keys=True) + "\n")
        identifier = packet[:2]
        flags = struct.pack("!H", 0x8180 | (struct.unpack("!H", packet[2:4])[0] & 0x0100))
        counts = struct.pack("!HHHH", 1, 1 if answer else 0, 0, 0)
        reply = identifier + flags + counts + packet[12:end]
        if answer:
            reply += struct.pack("!HHHIH", 0xC00C, 1, 1, 5, 4) + socket.inet_aton(answer)
        server.sendto(reply, client)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
