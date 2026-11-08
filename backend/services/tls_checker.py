"""Verify a site's TLS certificate with a read-only TLS handshake.

No HTTP request is sent, so page paths, cookies, and form contents are not involved.
Private-network targets are only checked when the API caller is on this same machine.
"""
import ipaddress
import socket
import ssl
import time
from urllib.parse import urlsplit

TLS_TIMEOUT_SECONDS = 2
TLS_PORT = 443


def _usable_ip(value: str, allow_private: bool) -> bool:
    try:
        address = ipaddress.ip_address(value.split("%", 1)[0])
    except ValueError:
        return False
    if address.is_loopback or address.is_link_local or address.is_multicast or address.is_reserved or address.is_unspecified:
        return False
    return address.is_global or (allow_private and address.is_private)


def check_tls(url: str, *, allow_private: bool = False) -> str | None:
    """Return secure/insecure/broken, or None if a reliable check was unavailable."""
    try:
        parsed = urlsplit(url)
        host = parsed.hostname
        port = parsed.port or TLS_PORT
        if parsed.scheme.lower() != "https" or not host or parsed.username or parsed.password or port != TLS_PORT:
            return None
        try:
            ipaddress.ip_address(host.split("%", 1)[0])
            literal_ip = True
        except ValueError:
            literal_ip = False
        answers = socket.getaddrinfo(host, TLS_PORT, type=socket.SOCK_STREAM)
    except (OSError, ValueError):
        return None

    addresses = []
    seen = set()
    for family, socktype, proto, _, sockaddr in answers:
        address = sockaddr[0]
        # Only permit a private-network destination when the user navigated to
        # an explicit IP. A public hostname must not be able to DNS-rebind here.
        if address not in seen and _usable_ip(address, allow_private and literal_ip):
            seen.add(address)
            addresses.append((family, socktype, proto, sockaddr))
    if not addresses:
        return None

    context = ssl.create_default_context()
    saw_certificate_error = False
    saw_tls_error = False
    deadline = time.monotonic() + TLS_TIMEOUT_SECONDS
    # Keep the scan responsive even for hosts with several DNS records.
    for family, socktype, proto, sockaddr in addresses[:2]:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        try:
            with socket.socket(family, socktype, proto) as connection:
                connection.settimeout(remaining)
                connection.connect(sockaddr)
                with context.wrap_socket(connection, server_hostname=host):
                    return "secure"
        except ssl.SSLCertVerificationError:
            saw_certificate_error = True
        except ssl.SSLError:
            saw_tls_error = True
        except OSError:
            continue

    if saw_certificate_error:
        return "insecure"
    if saw_tls_error:
        return "broken"
    return None
