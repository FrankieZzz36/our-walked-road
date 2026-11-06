"""Change the website password and re-wrap the private data key.

The encrypted photos/profiles are not re-encrypted; only the password hash and
the wrapped data key in web/lock.js are updated.

Usage:
    D:\\anaconda\\python.exe tools\\set_password.py
"""

from __future__ import annotations

import base64
import getpass
import hashlib
import os
import re
import secrets
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ITERATIONS = 210_000
ROOT = Path(__file__).resolve().parent.parent
LOCK_JS = ROOT / "web" / "lock.js"
DATA_KEY_FILE = ROOT / "private" / "data-key.bin"
LOCAL_KEY_JS = ROOT / "web" / "local-key.js"

CONFIG_PATTERN = re.compile(
    r"const PASSWORD_CONFIG = \{.*?\n  \};",
    re.DOTALL,
)


def b64encode(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def b64decode(text: str) -> bytes:
    return base64.b64decode(text)


def load_local_key_js() -> bytes | None:
    if not LOCAL_KEY_JS.exists():
        return None
    match = re.search(
        r'window\.OURROAD_LOCAL_KEY\s*=\s*"([A-Za-z0-9+/=]+)"',
        LOCAL_KEY_JS.read_text(encoding="utf-8"),
    )
    if not match:
        return None
    key = b64decode(match.group(1))
    return key if len(key) == 32 else None


def load_data_key() -> bytes:
    if DATA_KEY_FILE.exists():
        key = DATA_KEY_FILE.read_bytes()
        if len(key) != 32:
            raise SystemExit("private/data-key.bin must contain exactly 32 bytes.")
        return key

    key = load_local_key_js()
    if key is not None:
        return key

    source = LOCK_JS.read_text(encoding="utf-8")
    wrapped_match = re.search(
        r'wrappedKey:\s*"([A-Za-z0-9+/=]+)"',
        source,
    )
    if not wrapped_match:
        raise SystemExit(
            "No data key found. Run tools/encrypt_private.py first, "
            "or restore private/data-key.bin."
        )

    salt_match = re.search(r'salt:\s*"([0-9a-f]+)"', source)
    iterations_match = re.search(r"iterations:\s*(\d+)", source)
    if not salt_match or not iterations_match:
        raise SystemExit("Could not read the current password configuration.")

    old_password = getpass.getpass("Current website password: ")
    derived = hashlib.pbkdf2_hmac(
        "sha256",
        old_password.encode("utf-8"),
        bytes.fromhex(salt_match.group(1)),
        int(iterations_match.group(1)),
        64,
    )
    wrapped = b64decode(wrapped_match.group(1))
    try:
        key = AESGCM(derived[32:64]).decrypt(wrapped[:12], wrapped[12:], None)
    except Exception as exc:  # noqa: BLE001 - report a friendly message
        raise SystemExit("Current password is incorrect.") from exc

    if len(key) != 32:
        raise SystemExit("Wrapped data key is invalid.")
    DATA_KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_KEY_FILE.write_bytes(key)
    return key


def build_config(password: str, data_key: bytes) -> tuple[str, str, str]:
    salt = secrets.token_hex(16)
    derived = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        bytes.fromhex(salt),
        ITERATIONS,
        64,
    )
    verify_hash = derived[:32].hex()
    wrapping_key = derived[32:64]

    iv = os.urandom(12)
    wrapped = AESGCM(wrapping_key).encrypt(iv, data_key, None)
    wrapped_key = b64encode(iv + wrapped)
    return salt, verify_hash, wrapped_key


def update_lock_js(salt: str, verify_hash: str, wrapped_key: str) -> None:
    source = LOCK_JS.read_text(encoding="utf-8")
    block = (
        "const PASSWORD_CONFIG = {\n"
        f'    salt: "{salt}",\n'
        f"    iterations: {ITERATIONS},\n"
        f'    hash: "{verify_hash}",\n'
        f'    wrappedKey: "{wrapped_key}",\n'
        "  };"
    )
    updated, count = CONFIG_PATTERN.subn(block, source, count=1)
    if count != 1:
        raise SystemExit("Could not locate PASSWORD_CONFIG in web/lock.js.")

    LOCK_JS.write_text(updated, encoding="utf-8", newline="\n")


def update_from_password(password: str, data_key: bytes) -> None:
    salt, verify_hash, wrapped_key = build_config(password, data_key)
    update_lock_js(salt, verify_hash, wrapped_key)


def read_new_password() -> str:
    password = getpass.getpass("New website password: ")
    if len(password) < 6:
        raise SystemExit("Password must contain at least 6 characters.")
    confirm = getpass.getpass("Repeat password: ")
    if password != confirm:
        raise SystemExit("Passwords do not match.")
    return password


def main() -> None:
    data_key = load_data_key()
    password = read_new_password()
    update_from_password(password, data_key)
    print("Password updated in web/lock.js")
    print(f"PBKDF2-SHA256, {ITERATIONS} iterations; data key re-wrapped.")


if __name__ == "__main__":
    main()
