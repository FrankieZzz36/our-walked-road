"""Encrypt private profiles and portraits for the public website.

Source files (all ignored by Git):
    private/profiles.json
    private/portraits/*.jpg
    private/data-key.bin

Generated public files:
    web/assets/enc/profiles.enc.js
    web/assets/enc/portraits.enc.js

Generated local-only file:
    web/local-key.js

Usage:
    D:\\anaconda\\python.exe tools\\encrypt_private.py
"""

from __future__ import annotations

import base64
import getpass
import hashlib
import json
import os
import re
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(__file__).resolve().parent.parent
PRIVATE = ROOT / "private"
PROFILES_JSON = PRIVATE / "profiles.json"
PORTRAITS_DIR = PRIVATE / "portraits"
DATA_KEY_FILE = PRIVATE / "data-key.bin"
LOCK_JS = ROOT / "web" / "lock.js"
LOCAL_KEY_JS = ROOT / "web" / "local-key.js"
ENC_DIR = ROOT / "web" / "assets" / "enc"
PROFILES_ENC = ENC_DIR / "profiles.enc.js"
PORTRAITS_ENC = ENC_DIR / "portraits.enc.js"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


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


def load_wrapped_key() -> bytes | None:
    if not LOCK_JS.exists():
        return None

    source = LOCK_JS.read_text(encoding="utf-8")
    wrapped_match = re.search(r'wrappedKey:\s*"([A-Za-z0-9+/=]+)"', source)
    salt_match = re.search(r'salt:\s*"([0-9a-f]+)"', source)
    iterations_match = re.search(r"iterations:\s*(\d+)", source)
    if not wrapped_match or not salt_match or not iterations_match:
        return None

    password = getpass.getpass("Current website password: ")
    derived = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        bytes.fromhex(salt_match.group(1)),
        int(iterations_match.group(1)),
        64,
    )
    wrapped = b64decode(wrapped_match.group(1))
    try:
        key = AESGCM(derived[32:64]).decrypt(wrapped[:12], wrapped[12:], None)
    except Exception as exc:  # noqa: BLE001 - report a friendly message
        raise SystemExit("Current website password is incorrect.") from exc

    if len(key) != 32:
        raise SystemExit("Wrapped data key is invalid.")
    return key


def load_or_create_data_key() -> bytes:
    if DATA_KEY_FILE.exists():
        key = DATA_KEY_FILE.read_bytes()
        if len(key) != 32:
            raise SystemExit("private/data-key.bin must contain exactly 32 bytes.")
        return key

    key = load_local_key_js()
    if key is None:
        key = load_wrapped_key()
    if key is None:
        raise SystemExit(
            "No data key found. Restore private/data-key.bin or web/local-key.js, "
            "or configure a website password with tools/set_password.py."
        )

    DATA_KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_KEY_FILE.write_bytes(key)
    return key


def write_local_key(key: bytes) -> None:
    LOCAL_KEY_JS.write_text(
        "/* Local-only key. Ignored by Git; do not publish. */\n"
        f'window.OURROAD_LOCAL_KEY = "{b64encode(key)}";\n',
        encoding="utf-8",
        newline="\n",
    )


def encrypt_bytes(aes: AESGCM, plaintext: bytes) -> str:
    iv = os.urandom(12)
    ciphertext = aes.encrypt(iv, plaintext, None)
    return b64encode(iv + ciphertext)


def encrypt_profiles(aes: AESGCM) -> None:
    if not PROFILES_JSON.exists():
        raise SystemExit(f"Not found: {PROFILES_JSON}")

    data = json.loads(PROFILES_JSON.read_text(encoding="utf-8"))
    plaintext = json.dumps(
        data,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    payload = encrypt_bytes(aes, plaintext)
    PROFILES_ENC.write_text(
        "/* Encrypted profile data. Open the website with the password to view. */\n"
        f'window.OURROAD_PROFILES_ENC = "{payload}";\n',
        encoding="utf-8",
        newline="\n",
    )


def mime_for(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".png":
        return "image/png"
    if suffix == ".webp":
        return "image/webp"
    return "image/jpeg"


def encrypt_portraits(aes: AESGCM) -> int:
    if not PORTRAITS_DIR.exists():
        raise SystemExit(f"Not found: {PORTRAITS_DIR}")

    entries: list[str] = []
    for path in sorted(PORTRAITS_DIR.iterdir()):
        if not path.is_file() or path.suffix.lower() not in IMAGE_SUFFIXES:
            continue
        payload = encrypt_bytes(aes, path.read_bytes())
        entries.append(
            f'  "{path.stem}": {{ "type": "{mime_for(path)}", "data": "{payload}" }}'
        )

    if not entries:
        raise SystemExit(f"No portrait images found in {PORTRAITS_DIR}")

    PORTRAITS_ENC.write_text(
        "/* Encrypted portraits. Open the website with the password to view. */\n"
        "window.OURROAD_PORTRAITS_ENC = {\n"
        + ",\n".join(entries)
        + "\n};\n",
        encoding="utf-8",
        newline="\n",
    )
    return len(entries)


def main() -> None:
    ENC_DIR.mkdir(parents=True, exist_ok=True)
    key = load_or_create_data_key()
    write_local_key(key)

    aes = AESGCM(key)
    encrypt_profiles(aes)
    portrait_count = encrypt_portraits(aes)

    print("Encrypted assets updated.")
    print(f"  profiles: {PROFILES_ENC.relative_to(ROOT)}")
    print(f"  portraits: {portrait_count} -> {PORTRAITS_ENC.relative_to(ROOT)}")
    print(f"  local key: {LOCAL_KEY_JS.relative_to(ROOT)} (ignored by Git)")


if __name__ == "__main__":
    main()
