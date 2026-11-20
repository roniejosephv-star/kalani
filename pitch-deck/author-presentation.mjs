import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const colors = { bg: '#F8F7F2', ink: '#183C2D', body: '#40554A', muted: '#66766B', green: '#5B8069', pale: '#E7EDE3', line: '#C8D3C6', white: '#FFFFFF' };

function text(slide, value, x, y, w, h, size = 25, opts = {}) {
  const shape = slide.shapes.add({
    geometry: 'textbox',
    name: opts.name || value.slice(0, 44),
    position: { left: x, top: y, width: w, height: h },
    fill: 'none', line: { fill: 'none', width: 0 },
  });
  shape.text = value;
  shape.text.style = { fontSize: size, typeface: opts.font || 'Arial', color: opts.color || colors.body, bold: !!opts.bold, alignment: opts.align || 'left', verticalAlignment: 'top', insets: 0, lineSpacing: 1.12 };
  return shape;
}

function node(slide, group, x, y, w, h, opts = {}) {
  const shape = slide.shapes.add({ geometry: 'rect', name: group.label, position: { left: x, top: y, width: w, height: h }, fill: opts.dark ? colors.ink : colors.pale, line: { fill: 'none', width: 0 } });
  text(slide, group.label, x + 22, y + 19, w - 44, 42, opts.labelSize || 25, { bold: true, color: opts.dark ? colors.white : colors.ink });
  text(slide, group.text, x + 22, y + 62, w - 44, h - 70, opts.size || 23, { color: opts.dark ? '#E2EBDD' : colors.body });
  return shape;
}

function connect(slide, a, b, from = 'right', to = 'left', kind = 'straight') {
  slide.shapes.connect(a, b, { fromSide: from, toSide: to, kind, line: { fill: colors.green, width: 2 }, tail: { type: 'triangle', width: 'sm', length: 'sm' } });
}

function header(slide, data, index) {
  text(slide, data.eyebrow, 72, 42, 1080, 24, 16, { color: colors.green, bold: true });
  text(slide, data.title, 72, 91, 1136, 100, data.title.length > 45 ? 46 : 50, { color: colors.ink, bold: true });
  text(slide, data.subtitle, 72, 203, 1110, 68, 26);
  text(slide, data.footnote, 72, 666, 1080, 42, 16, { color: colors.muted });
  text(slide, String(index + 1).padStart(2, '0') + ' / 10', 1133, 668, 80, 24, 15, { color: colors.muted, align: 'right' });
}

function group(slide, data, x, y, w, opts = {}) {
  text(slide, data.label, x, y, w, 40, opts.labelSize || 28, { bold: true, color: colors.ink });
  text(slide, data.text, x, y + 46, w, opts.h || 95, opts.size || 24);
}

async function addSlide(presentation, data, index) {
  const slide = presentation.slides.add({ width: 1280, height: 720 });
  slide.background.fill = colors.bg;
  slide.speakerNotes.text = `[${data.seconds} seconds]\n${data.notes}\n\nImplementation evidence:\n${data.sources.join('\n')}`;
  if (data.layout === 'cover') {
    text(slide, data.eyebrow, 76, 68, 720, 30, 16, { color: colors.green, bold: true });
    text(slide, data.title, 72, 205, 740, 120, 100, { color: colors.ink, bold: true });
    text(slide, data.subtitle, 76, 355, 680, 108, 40);
    group(slide, data.groups[0], 76, 533, 700, { labelSize: 22, size: 23, h: 60 });
    slide.images.add({ path: path.join(root, 'dist', data.image), alt: data.imageCaption, fit: 'contain', position: { left: 911, top: 64, width: 255, height: 554 } });
    text(slide, data.imageCaption, 842, 630, 360, 54, 15, { align: 'center', color: colors.muted });
    text(slide, data.footnote, 76, 673, 640, 25, 16, { color: colors.muted });
    return;
  }
  header(slide, data, index);
  switch (data.layout) {
    case 'problem': {
      const hub = node(slide, { label: data.focus, text: 'The farmer chooses the next step' }, 435, 403, 410, 136, { dark: true });
      const positions = [[72, 292], [72, 483], [930, 292], [930, 483]];
      data.groups.forEach((g, i) => {
        const [x, y] = positions[i];
        const n = node(slide, g, x, y, 278, 146, { labelSize: 22, size: 22 });
        connect(slide, n, hub, i < 2 ? 'right' : 'left', i < 2 ? 'left' : 'right', 'elbow');
      });
      break;
    }
    case 'journey': {
      let prev;
      data.groups.forEach((g, i) => {
        const x = 72 + i * 230;
        text(slide, String(i + 1).padStart(2, '0'), x, 305, 180, 62, 42, { color: colors.green });
        const n = node(slide, g, x, 380, 210, 185, { labelSize: 25, size: 23 });
        if (prev) connect(slide, prev, n);
        prev = n;
      });
      text(slide, data.focus, 72, 594, 590, 45, 28, { color: colors.ink });
      text(slide, data.focusTranslation, 690, 594, 518, 60, 24, { color: colors.green, align: 'right' });
      break;
    }
    case 'screens': {
      const subtitle = slide.shapes.items.find(shape => shape.name === data.subtitle.slice(0, 44));
      subtitle.position = { left: 72, top: 176, width: 1136, height: 48 };
      data.images.forEach((im, i) => {
        const center = 360 + i * 560;
        text(slide, im.label, center - 225, 225, 450, 37, 25, { color: colors.ink, bold: true, align: 'center' });
        slide.images.add({ path: path.join(root, 'dist', im.src), alt: im.caption, fit: 'contain', crop: { left: 0, top: 0.30, right: 0, bottom: 0.20 }, position: { left: center - 165, top: 267, width: 330, height: 374 } });
        text(slide, im.caption, center - 225, 644, 450, 24, 15, { color: colors.muted, align: 'center' });
      });
      break;
    }
    case 'architecture': {
      const app = node(slide, data.groups[0], 72, 310, 275, 130);
      const pi = node(slide, data.groups[1], 415, 310, 415, 130, { dark: true });
      const specialists = node(slide, data.groups[2], 900, 310, 308, 130);
      const evidence = node(slide, data.groups[3], 900, 506, 308, 130, { labelSize: 22, size: 22 });
      const state = node(slide, data.groups[4], 415, 506, 415, 130, { labelSize: 25, size: 23 });
      connect(slide, app, pi);
      connect(slide, pi, specialists);
      connect(slide, specialists, evidence, 'bottom', 'top');
      connect(slide, pi, state, 'bottom', 'top');
      break;
    }
    case 'trace': {
      let prev;
      const nodes = data.groups.map((g, i) => {
        const n = node(slide, g, 72 + i * 390, 300, 356, 133, { labelSize: 26, size: 23 });
        if (prev) connect(slide, prev, n);
        prev = n;
        return n;
      });
      data.branches.forEach((g, i) => {
        const n = node(slide, g, 72 + i * 584, 508, 552, 138, { dark: i === 1, labelSize: 25, size: 23 });
        connect(slide, nodes[2], n, 'bottom', 'top', 'elbow');
      });
      break;
    }
    case 'control': {
      data.groups.forEach((g, i) => {
        const x = 72 + (i % 2) * 600;
        const y = 310 + Math.floor(i / 2) * 153;
        text(slide, String(i + 1).padStart(2, '0'), x, y, 58, 50, 34, { color: colors.green });
        group(slide, g, x + 78, y, 455, { size: 24, h: 80 });
      });
      text(slide, data.focus, 72, 620, 1120, 35, 25, { color: colors.ink, bold: true });
      break;
    }
    case 'verification': {
      text(slide, data.stat, 72, 307, 375, 200, 155, { color: colors.ink, bold: true });
      text(slide, data.statLabel, 79, 510, 360, 45, 29, { color: colors.green });
      data.groups.forEach((g, i) => {
        const y = 298 + i * 70;
        text(slide, g.label, 500, y, 300, 35, 25, { color: colors.ink, bold: true });
        text(slide, g.text, 500, y + 33, 690, 36, 22);
      });
      break;
    }
    case 'status': {
      const table = slide.tables.add({ rows: data.rows.length + 1, columns: 3, left: 72, top: 300, width: 1136, height: 326, columnWidths: [350, 380, 406], values: [data.columns, ...data.rows] });
      table.borders.assign({ fill: colors.line, width: 1, style: 'solid' });
      for (let r = 0; r < data.rows.length + 1; r++) {
        for (let c = 0; c < 3; c++) {
          const cell = table.getCell(r, c);
          cell.fill = r === 0 ? colors.ink : colors.bg;
          cell.text.style = { fontSize: 22, typeface: 'Arial', bold: r === 0, color: r === 0 ? colors.white : colors.body, insets: 15 };
        }
      }
      break;
    }
    case 'closing': {
      data.groups.forEach((g, i) => {
        text(slide, String(i + 1).padStart(2, '0'), 72, 304 + i * 101, 64, 50, 32, { color: colors.green });
        text(slide, g.label, 170, 301 + i * 101, 430, 44, 30, { color: colors.ink, bold: true });
        text(slide, g.text, 625, 304 + i * 101, 568, 70, 25);
      });
      text(slide, data.focus, 72, 620, 1136, 38, 30, { color: colors.ink, bold: true });
      break;
    }
  }
}

export async function authorBatch({ presentation, input }) {
  const data = JSON.parse(await fs.readFile(path.join(root, 'dist/deck.json'), 'utf8'));
  if (input.reset) presentation.slides.delete(presentation.slides.items.map(slide => slide.id));
  for (let i = input.start; i < input.end; i++) await addSlide(presentation, data.slides[i], i);
  return { slideCount: presentation.slides.items.length, range: [input.start + 1, input.end] };
}
