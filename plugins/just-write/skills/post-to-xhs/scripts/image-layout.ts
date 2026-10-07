// 此脚本在分页浏览器中执行，图片与正文使用同一高度测量和连续分页。
export const IMAGE_LAYOUT_SCRIPT = String.raw`
const imageDimensions = new Map();
source.querySelectorAll('img').forEach((img, index) => {
  const loaded = loadedImages.get(img.src);
  img.dataset.xhsSourceIndex = String(index + 1);
  if (loaded) {
    img.setAttribute('width', loaded.naturalWidth);
    img.setAttribute('height', loaded.naturalHeight);
    imageDimensions.set(index + 1, { width: loaded.naturalWidth, height: loaded.naturalHeight });
  }
});
const imageInfo = (block) => {
  if (!block.hasImage) return null;
  const container = document.createElement('div');
  container.innerHTML = block.html;
  const images = Array.from(container.querySelectorAll('img'));
  if (images.length !== 1) return null;
  const img = images[0];
  const first = container.firstElementChild;
  if (!first || !['P', 'FIGURE', 'IMG', 'DIV'].includes(first.tagName)) return null;
  if (first.tagName === 'P' && (first.textContent || '').trim()) return null;
  if (first.tagName === 'DIV' && !first.classList.contains('xhs-flow-image')) return null;
  const sourceIndex = Number(img.dataset.xhsSourceIndex);
  const dimensions = imageDimensions.get(sourceIndex);
  if (!dimensions) throw new Error('无法读取图片尺寸：' + img.src);
  const requested = img.dataset.xhsImageMode || 'auto';
  if (!['auto', 'inline', 'page', 'split'].includes(requested)) throw new Error('未知图片布局：' + requested);
  const fullHeight = imageViewportWidth * dimensions.height / dimensions.width;
  const start = Number(img.dataset.xhsSliceStart || 0) / dimensions.height * fullHeight;
  const frame = img.closest('.xhs-image-frame');
  if (frame) frame.remove(); else img.remove();
  container.querySelectorAll('p').forEach(p => { if (!p.textContent.trim()) p.remove(); });
  container.querySelectorAll('figure,.xhs-flow-image,[data-xhs-image-caption]').forEach(el => el.replaceWith(...Array.from(el.childNodes)));
  return { img, sourceIndex, dimensions, requested, start, caption: container.innerHTML, fullHeight };
};
const imageFragmentHtml = (info, start, end, withCaption) => {
  const clone = info.img.cloneNode(true);
  clone.style.width = imageViewportWidth + 'px';
  clone.style.height = info.fullHeight + 'px';
  clone.style.maxHeight = 'none';
  clone.style.top = -start + 'px';
  clone.dataset.xhsImageMode = 'split';
  clone.dataset.xhsSliceStart = String(start / info.fullHeight * info.dimensions.height);
  clone.dataset.xhsSliceEnd = String(end / info.fullHeight * info.dimensions.height);
  return '<div class="xhs-flow-image"><div class="xhs-image-frame" style="height:' + (end - start) + 'px">' +
    clone.outerHTML + '</div>' + (withCaption && info.caption ? '<div data-xhs-image-caption="true">' + info.caption + '</div>' : '') + '</div>';
};
// 只有作者明确指定 page 才独立成页；自动模式始终沿原文连续排版。
const planImagePages = (block, heading = '') => {
  const info = imageInfo(block);
  if (!info || info.requested !== 'page') return null;
  const reserve = heightOf(heading + info.caption);
  const width = Math.min(imageViewportWidth, Math.max(100, limit - reserve - 24) * info.dimensions.width / info.dimensions.height);
  info.img.style.width = width + 'px';
  info.img.style.height = width * info.dimensions.height / info.dimensions.width + 'px';
  info.img.style.maxHeight = 'none';
  info.img.dataset.xhsImageMode = 'page';
  const html = '<div class="xhs-image-page" data-xhs-image-page="true">' + heading + info.img.outerHTML + info.caption + '</div>';
  if (heightOf(html) > limit + 0.5) throw new Error('图片与说明超过一页，请缩短说明或单独分段');
  return [html];
};
const minimumImagePrefix = (block) => {
  const info = imageInfo(block);
  if (!info || info.requested === 'inline' || info.fullHeight < 360) return block.html;
  return imageFragmentHtml(info, info.start, Math.min(info.fullHeight, info.start + 220), false);
};
const blankRowCache = new Map();
const blankRowsFor = (info) => {
  if (blankRowCache.has(info.sourceIndex)) return blankRowCache.get(info.sourceIndex);
  let sample = null;
  try {
    const width = Math.min(320, info.dimensions.width);
    const scale = width / imageViewportWidth;
    const height = Math.ceil(info.fullHeight * scale);
    if (height <= 12000) {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(loadedImages.get(info.img.src), 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height).data;
      const rows = new Uint8Array(height);
      for (let y = 0; y < height; y++) {
        let dark = 0;
        for (let x = 0; x < width; x++) {
          const offset = (y * width + x) * 4;
          if (pixels[offset + 3] > 10 && Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2]) < 238) dark++;
        }
        rows[y] = dark / width < 0.015 ? 1 : 0;
      }
      sample = { rows, scale };
    }
  } catch (_) { /* 无法读取像素时，用重叠范围保留跨页内容。 */ }
  blankRowCache.set(info.sourceIndex, sample);
  return sample;
};
const blankCut = (info, lower, upper, backwards) => {
  const sample = blankRowsFor(info);
  if (!sample) return null;
  let run = 0;
  const lo = Math.ceil(lower * sample.scale), hi = Math.floor(upper * sample.scale);
  for (let y = backwards ? hi : lo; backwards ? y >= lo : y <= hi; y += backwards ? -1 : 1) {
    run = sample.rows[y] ? run + 1 : 0;
    if (run >= 3) return Math.max(lower, Math.min(upper, (backwards ? y + 1 : y - 1) / sample.scale));
  }
  return null;
};
const splitImageToFit = (prefix, block) => {
  const info = imageInfo(block);
  if (!info || info.requested === 'inline' || info.requested === 'page') return null;
  // 小横图保持完整；长图从当前页剩余空间开始，不强制另起一页。
  if (info.start === 0 && info.fullHeight < 320) return null;
  const remaining = info.fullHeight - info.start;
  let low = 1, high = Math.floor(remaining), best = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (heightOf(prefix + imageFragmentHtml(info, info.start, info.start + mid, false)) <= limit) { best = mid; low = mid + 1; }
    else high = mid - 1;
  }
  if (best < Math.min(180, remaining)) return null;
  if (best >= remaining - 0.5 && heightOf(prefix + imageFragmentHtml(info, info.start, info.fullHeight, true)) <= limit) {
    return { head: imageFragmentHtml(info, info.start, info.fullHeight, true), tail: '' };
  }
  // 为尾段保留最小阅读高度，避免最后只剩一条图片。
  const endLimit = Math.min(info.start + best, info.fullHeight - 160);
  const end = blankCut(info, Math.max(info.start + 180, endLimit - 70), endLimit, true) ?? endLimit;
  if (end - info.start < 180) return null;
  const nextStart = blankCut(info, Math.max(info.start + 1, end - 36), end, false) ?? end - 36;
  return { head: imageFragmentHtml(info, info.start, end, false), tail: imageFragmentHtml(info, nextStart, info.fullHeight, true) };
};
`;
