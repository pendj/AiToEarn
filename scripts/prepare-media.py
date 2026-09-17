#!/usr/bin/env python3
"""Prepare registered product photos privately; never publish or grant access."""

import argparse
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path, PurePosixPath
import re
import urllib.request
from urllib.parse import urlsplit

from PIL import Image, ImageOps, __version__ as pillow_version

ROOT = Path(__file__).resolve().parents[1]
MAX_BYTES = 8 * 1024 * 1024
MAX_PIXELS = 16_000_000
SIZE = 1080
TYPES = {'image/webp': 'WEBP', 'image/png': 'PNG', 'image/jpeg': 'JPEG'}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('source_redirect_not_allowed')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def private_directory(root, relative):
    current = root
    for part in Path(relative).parts:
        current = current / part
        if current.is_symlink():
            raise ValueError('media_directory_symlink_not_allowed')
        current.mkdir(mode=0o700, exist_ok=True)
        current.chmod(0o700)
    return current


def write_once(path, raw):
    if path.is_symlink():
        raise ValueError('media_symlink_not_allowed')
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        if path.read_bytes() != raw:
            raise ValueError('existing_media_differs') from None
        return
    with os.fdopen(descriptor, 'wb') as output:
        output.write(raw)


def source_bytes(root, source):
    image = source['image']
    url = urlsplit(image['url'])
    name = PurePosixPath(url.path).name
    if (url.scheme != 'https' or url.netloc != 'luxsabers.com' or url.query or url.fragment
            or not url.path.startswith('/assets/catalog/')
            or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]+\.(webp|png|jpg|jpeg)', name)
            or image.get('type') not in TYPES
            or not re.fullmatch(r'[a-f0-9]{64}', image.get('sha256', ''))):
        raise ValueError('source_image_not_registered')
    staged = root / '.runtime/assets' / name
    if staged.is_symlink() or any(parent.is_symlink() for parent in (staged.parent, staged.parent.parent)):
        raise ValueError('source_symlink_not_allowed')
    if staged.exists():
        if staged.stat().st_size > MAX_BYTES:
            raise ValueError('source_image_size_limit')
        raw = staged.read_bytes()
    else:
        request = urllib.request.Request(image['url'], headers={'User-Agent': 'LuxSabers-PrivateMedia/1.0'})
        with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
            if response.status != 200 or response.headers.get_content_type() != image['type']:
                raise ValueError('source_image_unconfirmed')
            raw = response.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError('source_image_size_limit')
    if digest(raw) != image['sha256']:
        raise ValueError('source_image_hash_mismatch')
    if not staged.exists():
        private_directory(root, '.runtime/assets')
        write_once(staged, raw)
    return raw


def render(raw, expected_format):
    with Image.open(BytesIO(raw)) as original:
        if original.format != expected_format or getattr(original, 'n_frames', 1) != 1:
            raise ValueError('source_image_format_unconfirmed')
        if original.width * original.height > MAX_PIXELS:
            raise ValueError('source_image_pixel_limit')
        if original.info.get('icc_profile'):
            raise ValueError('source_color_profile_requires_review')
        image = ImageOps.exif_transpose(original).convert('RGBA')
        dimensions = list(image.size)
        image.thumbnail((SIZE, SIZE), Image.Resampling.LANCZOS)
        canvas = Image.new('RGBA', (SIZE, SIZE), (255, 255, 255, 255))
        canvas.alpha_composite(image, ((SIZE - image.width) // 2, (SIZE - image.height) // 2))
        output = BytesIO()
        canvas.convert('RGB').save(output, format='JPEG', quality=92, subsampling=0, optimize=True, progressive=True)
    return output.getvalue(), dimensions


def prepare(root, source_id):
    manifest_raw = (root / 'automation/sources.json').read_bytes()
    manifest = json.loads(manifest_raw)
    matches = [source for source in manifest['sources'] if source.get('id') == source_id]
    if len(matches) != 1 or not re.fullmatch(r'[a-z0-9][a-z0-9-]{2,70}', source_id):
        raise ValueError('source_not_registered')
    source = matches[0]
    if not source.get('sourceReference') or not source.get('rightsReference'):
        raise ValueError('source_provenance_missing')
    jpeg, dimensions = render(source_bytes(root, source), TYPES[source['image']['type']])
    sha = digest(jpeg)
    filename = f'{source_id}-{sha[:16]}.jpg'
    record = {
        'schemaVersion': 1, 'sourceId': source_id,
        'sourceUrl': source['image']['url'], 'sourceSha256': source['image']['sha256'],
        'sourceManifestFileSha256': digest(manifest_raw), 'sourceDimensions': dimensions,
        'sourceReference': source['sourceReference'], 'rightsReference': source['rightsReference'],
        'targetUrl': source['targetUrl'], 'file': f'.runtime/prepared-media/{filename}',
        'sha256': sha, 'type': 'image/jpeg', 'width': SIZE, 'height': SIZE, 'bytes': len(jpeg),
        'visibility': 'private', 'publicFetchVerified': False,
        'transform': {'crop': False, 'upscale': False, 'background': '#ffffff', 'quality': 92,
                      'metadata': 'removed', 'orientation': 'normalized', 'pillowVersion': pillow_version},
    }
    directory = private_directory(root, '.runtime/prepared-media')
    write_once(directory / filename, jpeg)
    write_once(directory / f'{filename}.json', (json.dumps(record, indent=2) + '\n').encode())
    return record


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, help='Exact source ID registered in automation/sources.json')
    args = parser.parse_args()
    try:
        result = prepare(ROOT, args.source)
    except (OSError, ValueError, KeyError) as error:
        reason = str(error) if isinstance(error, ValueError) and re.fullmatch(r'[a-z_]+', str(error)) else 'private_media_preparation_failed'
        raise SystemExit(reason) from None
    print(json.dumps({key: result[key] for key in ('sourceId', 'file', 'sha256', 'width', 'height', 'bytes', 'visibility')}))
