#!/usr/bin/env python3
"""usage: unixbridge.py unix-to-tcp SOCKET HOST:PORT [--ready FILE]
       unixbridge.py tcp-to-unix HOST:PORT SOCKET [--ready FILE]

Relays byte streams between a Unix socket and a TCP address. The isolate
runner uses it to carry the namespace's proxy port (127.0.0.1 inside the
network namespace) to the logging proxy on the host, through a socket file
in the run directory, so the namespace needs no network device that reaches
the host.
"""
import asyncio
import os
import sys


async def pipe(reader, writer):
    try:
        while True:
            chunk = await reader.read(65536)
            if not chunk:
                break
            writer.write(chunk)
            await writer.drain()
    except (ConnectionError, asyncio.CancelledError):
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass


def split_address(text):
    host, _, port = text.rpartition(":")
    return host or "127.0.0.1", int(port)


async def main(mode, source, target, ready):
    if mode == "unix-to-tcp":
        host, port = split_address(target)

        async def connect():
            return await asyncio.open_connection(host, port)

        async def serve(handler):
            if os.path.exists(source):
                os.unlink(source)
            server = await asyncio.start_unix_server(handler, path=source)
            os.chmod(source, 0o600)
            return server
    elif mode == "tcp-to-unix":
        host, port = split_address(source)

        async def connect():
            return await asyncio.open_unix_connection(target)

        async def serve(handler):
            return await asyncio.start_server(handler, host, port)
    else:
        print(__doc__, file=sys.stderr)
        sys.exit(64)

    async def handle(client_reader, client_writer):
        try:
            upstream_reader, upstream_writer = await connect()
        except OSError:
            client_writer.close()
            return
        await asyncio.gather(pipe(client_reader, upstream_writer), pipe(upstream_reader, client_writer))

    server = await serve(handle)
    if ready:
        with open(ready, "w") as marker:
            marker.write(str(os.getpid()))
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    arguments = sys.argv[1:]
    if arguments and arguments[0] in ("-h", "--help"):
        print(__doc__)
        sys.exit(0)
    ready_file = None
    if "--ready" in arguments:
        index = arguments.index("--ready")
        ready_file = arguments[index + 1]
        del arguments[index:index + 2]
    if len(arguments) != 3:
        print(__doc__, file=sys.stderr)
        sys.exit(64)
    try:
        asyncio.run(main(arguments[0], arguments[1], arguments[2], ready_file))
    except KeyboardInterrupt:
        pass
