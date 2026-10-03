#!/usr/bin/env python3
"""Serve storybook-static and ignore clients that close before the body finishes."""

import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class QuietHandler(SimpleHTTPRequestHandler):
    def copyfile(self, source, outputfile):
        try:
            super().copyfile(source, outputfile)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            return

    def handle(self):
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            return

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError)):
            return
        super().handle_error(request, client_address)


if __name__ == "__main__":
    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "storybook-static"))
    ThreadingHTTPServer(("127.0.0.1", 6193), QuietHandler).serve_forever()
