import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error Node-only release script has no TypeScript declaration
import { verifyReleaseAssetBytes } from '../scripts/check-release-bu.mjs';

// Captured production addition, pinned independently of the verifier constant.
const beacon = `<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js/vce701823e78c4301a35b7e07294d87301792088814092" integrity="sha512-UKNk8GbxkABxKcXYuLkO16EleLGUkcvJWtpSNmExE0Too3ZaFAxTscNWEc1OdAv5/BikHawapSCaiD2XCmp+Bw==" data-cf-beacon='{"version":"2024.11.0","token":"ccdc34405cf54ca8bbefd51a664ffa35","r":1,"spa":2}' crossorigin="anonymous"></script>\n`;
const original = '<!doctype html><html><head><script type="module" src="/assets/index-current.js"></script></head>\r\n<body><div id="root"></div></body></html>\n';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const check = (actual: string, path = '/index.html') => verifyReleaseAssetBytes(path, Buffer.from(actual), Buffer.from(original));
const injected = (addition = beacon) => original.replace('</body>', addition + '</body>');

describe('strict deployed HTML integrity', () => {
  it('accepts unchanged HTML and records raw and normalized identity without removal', () => {
    expect(check(original)).toMatchObject({ rawSha256: hash(original), normalizedSha256: hash(original), expectedSha256: hash(original), removedBytes: 0, beaconSha256: null });
  });
  it('accepts exactly the observed 367-byte beacon once before closing body and records both hashes', () => {
    expect(Buffer.byteLength(beacon)).toBe(367);
    expect(hash(beacon)).toBe('91b7d9733082c92acf9323b856e64331bdd90fd9896753c814365aff338697cb');
    expect(check(injected())).toMatchObject({ bytes: Buffer.byteLength(injected()), rawSha256: hash(injected()), normalizedSha256: hash(original), expectedSha256: hash(original), removedBytes: 367, beaconSha256: hash(beacon) });
  });
  it('rejects application changes even with the exact legitimate beacon', () => {
    for (const actual of [injected().replace('index-current.js', 'index-old.js'), injected().replace('id="root"', 'id="other"'), injected().replace('<head>', '<head><script src="/injected.js"></script>')]) expect(() => check(actual)).toThrow('Exact release bytes mismatch');
  });
  it('rejects changed beacon URL, integrity, token, attributes, contents or line ending', () => {
    for (const altered of [beacon.replace('cloudflareinsights.com', 'cloudflareinsights.example'), beacon.replace('UKNk8Gbx', 'badk8Gbx'), beacon.replace('ccdc34405', 'changed05'), beacon.replace('type="module"', 'type="module" async'), beacon.replace('</script>', 'alert(1)</script>'), beacon.replace('\n', '\r\n')]) expect(() => check(injected(altered))).toThrow('Exact release bytes mismatch');
  });
  it('rejects duplicate insertion, the wrong position, extra whitespace and alternate body tags', () => {
    for (const actual of [injected(beacon + beacon), original.replace('</head>', beacon + '</head>'), injected(beacon + ' '), injected().replace('</body>', '</body></body>')]) expect(() => check(actual)).toThrow('Exact release bytes mismatch');
  });
  it('does not normalize application line endings or whitespace', () => {
    for (const actual of [original.replace('\r\n', '\n'), injected().replace('\r\n', '\n'), injected().replace('<body>', '<body> ')]) expect(() => check(actual)).toThrow('Exact release bytes mismatch');
  });
  it('keeps every non-index resource byte-exact, including JS and GLB', () => {
    for (const path of ['/assets/index-current.js', '/data/mobile/boston.glb', '/assets/mit-residences/boston-without-residences.glb', '/other.html']) {
      expect(check(original, path).removedBytes).toBe(0);
      expect(() => check(injected(), path)).toThrow('Exact release bytes mismatch');
      expect(() => check(original + ' ', path)).toThrow('Exact release bytes mismatch');
    }
  });
});
