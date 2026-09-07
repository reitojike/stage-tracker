import { describe, expect, it } from 'vitest';
import { isRenderableHttpUrl } from './url';

describe('isRenderableHttpUrl', () => {
  it('accepts an https URL', () => {
    expect(isRenderableHttpUrl('https://example.com/event/123')).toBe(true);
  });

  it('accepts an http URL', () => {
    expect(isRenderableHttpUrl('http://example.com')).toBe(true);
  });

  it('rejects a javascript: URL', () => {
    expect(isRenderableHttpUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects a data: URL', () => {
    expect(isRenderableHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('rejects a non-URL string', () => {
    expect(isRenderableHttpUrl('not a url')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isRenderableHttpUrl('')).toBe(false);
  });

  it('rejects a protocol-relative string with no scheme', () => {
    expect(isRenderableHttpUrl('//example.com')).toBe(false);
  });
});
