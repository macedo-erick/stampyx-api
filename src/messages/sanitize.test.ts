import { expect, it } from 'vitest';

import { sanitizeMessageHtml } from './sanitize';

it('strips script tags', () => {
  const clean = sanitizeMessageHtml('<p>hi</p><script>alert(1)</script>');

  expect(clean).toContain('hi');
  expect(clean).not.toContain('script');
});

it('strips inline event handlers', () => {
  const clean = sanitizeMessageHtml('<div onclick="steal()">click</div>');

  expect(clean).not.toContain('onclick');
});

it('strips javascript: URLs', () => {
  const clean = sanitizeMessageHtml('<a href="javascript:alert(1)">x</a>');

  expect(clean).not.toContain('javascript:');
});

it('blocks remote images but keeps the source for a load-images control', () => {
  const clean = sanitizeMessageHtml('<img src="https://tracker.example/pixel.gif">');

  expect(clean).not.toMatch(/\ssrc=/);
  expect(clean).toContain('data-stampyx-src="https://tracker.example/pixel.gif"');
});

it('leaves inline cid: images alone, since they came with the message', () => {
  const clean = sanitizeMessageHtml('<img src="cid:logo@example">');

  expect(clean).toContain('src="cid:logo@example"');
});

it('forces links to open safely in a new tab', () => {
  const clean = sanitizeMessageHtml('<a href="https://example.com">x</a>');

  expect(clean).toContain('rel="noopener noreferrer nofollow"');
  expect(clean).toContain('target="_blank"');
});

it('drops iframes, forms and base tags', () => {
  const clean = sanitizeMessageHtml(
    '<iframe src="https://x"></iframe><form action="/x"><input name="p"></form><base href="https://evil">',
  );

  expect(clean).not.toContain('iframe');
  expect(clean).not.toContain('<form');
  expect(clean).not.toContain('<input');
  expect(clean).not.toContain('<base');
});

it('keeps ordinary formatting intact', () => {
  const clean = sanitizeMessageHtml(
    '<p><strong>bold</strong> and <em>italic</em></p><ul><li>one</li></ul>',
  );

  expect(clean).toContain('<strong>bold</strong>');
  expect(clean).toContain('<em>italic</em>');
  expect(clean).toContain('<li>one</li>');
});
