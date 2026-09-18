import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image

SPEC = importlib.util.spec_from_file_location('media', Path(__file__).resolve().parents[1] / 'scripts/prepare-media.py')


class MediaTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(Path(SPEC.origin).is_file(), 'Private media preparation is not implemented')
        self.media = importlib.util.module_from_spec(SPEC)
        SPEC.loader.exec_module(self.media)
        self.temporary = tempfile.TemporaryDirectory(prefix='social-media-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        assets = self.root / '.runtime/assets'
        assets.mkdir(parents=True)
        (self.root / 'automation').mkdir()
        self.original = assets / 'synthetic-photo.webp'
        image = Image.new('RGB', (480, 160), '#e02020')
        image.paste(Image.new('RGB', (160, 160), '#2050e0'), (320, 0))
        image.save(self.original, 'WEBP', lossless=True)
        self.source = {
            'id': 'synthetic-model', 'name': 'Synthetic test photo',
            'sourceReference': 'Synthetic local test, not a real product',
            'rightsReference': 'Test-generated pixels',
            'targetUrl': 'https://luxsabers.com/products/synthetic-test',
            'image': {'url': 'https://luxsabers.com/assets/catalog/synthetic-photo.webp',
                      'type': 'image/webp', 'sha256': hashlib.sha256(self.original.read_bytes()).hexdigest()},
        }
        self.manifest = self.root / 'automation/sources.json'
        self.manifest.write_text(json.dumps({'schemaVersion': 1, 'sources': [self.source]}))

    def test_complete_photo_is_retained_in_private_jpeg_with_provenance(self):
        result = self.media.prepare(self.root, 'synthetic-model')
        output = self.root / result['file']
        with Image.open(output) as image:
            self.assertEqual(image.format, 'JPEG')
            self.assertEqual(image.size, (1080, 1080))
            self.assertEqual(image.getexif(), {})
            self.assertNotIn('icc_profile', image.info)
            left = image.getpixel((310, 540))
            right = image.getpixel((770, 540))
            self.assertGreater(left[0], left[2] + 80)
            self.assertGreater(right[2], right[0] + 80)
            self.assertGreater(image.getpixel((10, 10))[0], 240)
        self.assertEqual(result['sourceSha256'], self.source['image']['sha256'])
        self.assertEqual(result['sha256'], hashlib.sha256(output.read_bytes()).hexdigest())
        self.assertEqual(result['visibility'], 'private')
        self.assertFalse(result['publicFetchVerified'])
        self.assertEqual(result['transform']['crop'], False)
        self.assertEqual(output.stat().st_mode & 0o777, 0o600)
        self.assertEqual(output.parent.stat().st_mode & 0o777, 0o700)

    def test_changed_source_is_rejected_before_conversion(self):
        self.original.write_bytes(b'not the reviewed product photo')
        with self.assertRaisesRegex(ValueError, 'source_image_hash_mismatch'):
            self.media.prepare(self.root, 'synthetic-model')
        self.assertFalse((self.root / '.runtime/prepared-media').exists())

    def test_orientation_is_applied_and_private_exif_is_removed(self):
        with Image.open(self.original) as original:
            image = original.copy()
        exif = Image.Exif()
        exif[274] = 6
        exif[315] = 'Synthetic private author metadata'
        image.save(self.original, 'WEBP', lossless=True, exif=exif)
        self.source['image']['sha256'] = hashlib.sha256(self.original.read_bytes()).hexdigest()
        self.manifest.write_text(json.dumps({'schemaVersion': 1, 'sources': [self.source]}))
        result = self.media.prepare(self.root, 'synthetic-model')
        self.assertEqual(result['sourceDimensions'], [160, 480])
        output = self.root / result['file']
        with Image.open(output) as image:
            self.assertEqual(image.getexif(), {})
        self.assertNotIn(b'Synthetic private author metadata', output.read_bytes())

    def test_repeated_preparation_reuses_output_and_never_overwrites_changed_file(self):
        first = self.media.prepare(self.root, 'synthetic-model')
        output = self.root / first['file']
        before = output.stat().st_mtime_ns
        second = self.media.prepare(self.root, 'synthetic-model')
        self.assertEqual(first, second)
        self.assertEqual(before, output.stat().st_mtime_ns)
        output.write_bytes(b'user change')
        with self.assertRaisesRegex(ValueError, 'existing_media_differs'):
            self.media.prepare(self.root, 'synthetic-model')
        self.assertEqual(output.read_bytes(), b'user change')

    def test_unknown_source_and_symlink_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'source_not_registered'):
            self.media.prepare(self.root, '../outside')
        saved = self.original.with_suffix('.saved')
        self.original.rename(saved)
        self.original.symlink_to(saved)
        with self.assertRaisesRegex(ValueError, 'source_symlink_not_allowed'):
            self.media.prepare(self.root, 'synthetic-model')


if __name__ == '__main__':
    unittest.main()
