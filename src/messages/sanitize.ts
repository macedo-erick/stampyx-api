import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

const purify = createDOMPurify(new JSDOM('').window);

// Remote images are the tracking-pixel vector: src is dropped into data-stampyx-src for the panel.
purify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'IMG' && node.hasAttribute('src')) {
    const src = node.getAttribute('src') ?? '';

    if (!src.startsWith('cid:')) {
      node.setAttribute('data-stampyx-src', src);
      node.removeAttribute('src');
    }
  }

  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer nofollow');
  }
});

export function sanitizeMessageHtml(html: string): string {
  return purify.sanitize(html, {
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed', 'base'],
    FORBID_ATTR: ['srcset', 'formaction', 'background', 'ping'],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['data-stampyx-src', 'target', 'rel'],
  });
}
