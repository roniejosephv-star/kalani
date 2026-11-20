'use strict';

const slideElement = document.querySelector('#slide');
const previous = document.querySelector('#previous');
const next = document.querySelector('#next');
let deck;
let current = 0;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function group(item, index, numbered = false) {
  const node = element('div', 'group');
  if (numbered) node.append(element('span', 'step-number', String(index + 1).padStart(2, '0')));
  node.append(element('h3', '', item.label), element('p', '', item.text));
  return node;
}

function figure(src, label, caption) {
  const node = element('figure', 'product-screen');
  if (label) node.append(element('h3', '', label));
  const image = element('img');
  image.src = src;
  image.alt = `${label || 'Today'} screen from the actual Kalani iPhone Simulator app`;
  image.width = 368;
  image.height = 800;
  image.decoding = 'async';
  node.append(image, element('figcaption', '', caption));
  return node;
}

function focus(item) {
  const node = element('div', 'focus-statement');
  const quote = element('p', '', item.focus);
  if (item.focusTranslation) quote.lang = 'ta';
  node.append(quote);
  if (item.focusTranslation) node.append(element('span', '', item.focusTranslation));
  return node;
}

function content(item) {
  const region = element('div', `slide-content content-${item.layout}`);
  if (item.layout === 'cover') {
    const copy = element('div', 'cover-copy');
    copy.append(element('h1', '', item.title), element('p', 'cover-subtitle', item.subtitle));
    copy.querySelector('h1').id = 'slide-title';
    copy.append(...item.groups.map((value, index) => group(value, index)));
    region.append(copy, figure(item.image, '', item.imageCaption));
  } else if (item.layout === 'screens') {
    region.append(...item.images.map(image => figure(image.src, image.label, image.caption)));
  } else if (item.layout === 'problem') {
    const inputs = element('div', 'problem-inputs');
    inputs.append(...item.groups.map((value, index) => group(value, index)));
    region.append(inputs, focus(item));
  } else if (item.layout === 'journey') {
    const steps = element('div', 'journey-steps');
    steps.setAttribute('aria-label', 'Farmer journey in sequence');
    steps.append(...item.groups.map((value, index) => group(value, index, true)));
    region.append(steps, focus(item));
  } else if (item.layout === 'architecture') {
    const flow = element('div', 'architecture-flow');
    flow.setAttribute('aria-label', 'Application architecture in workflow order');
    item.groups.forEach((value, index) => {
      const node = group(value, index);
      node.classList.add('architecture-node', `node-${index + 1}`);
      if (index === 4) {
        node.setAttribute('role', 'complementary');
        node.setAttribute('aria-label', 'Orchestrator side connection');
        node.prepend(element('span', 'branch-context', 'Orchestration also connects to'));
      }
      flow.append(node);
    });
    region.append(flow);
  } else if (item.layout === 'trace') {
    const steps = element('div', 'trace-steps');
    steps.append(...item.groups.map((value, index) => group(value, index, true)));
    const branches = element('div', 'trace-branches');
    branches.setAttribute('aria-label', 'Two possible publication outcomes');
    branches.append(...item.branches.map((value, index) => group(value, index)));
    region.append(steps, branches);
  } else if (item.layout === 'control') {
    const steps = element('div', 'control-steps');
    steps.append(...item.groups.map((value, index) => group(value, index, true)));
    region.append(steps, focus(item));
  } else if (item.layout === 'verification') {
    const stat = element('div', 'test-total');
    stat.append(element('strong', '', item.stat), element('span', '', item.statLabel));
    const checks = element('div', 'verification-checks');
    checks.append(...item.groups.map((value, index) => group(value, index)));
    region.append(stat, checks);
  } else if (item.layout === 'status') {
    const table = element('table', 'status-table');
    const caption = element('caption', 'visually-hidden', item.title);
    const thead = element('thead');
    const header = element('tr');
    item.columns.forEach(column => {
      const th = element('th', '', column);
      th.scope = 'col';
      header.append(th);
    });
    thead.append(header);
    const tbody = element('tbody');
    item.rows.forEach(row => {
      const tr = element('tr');
      row.forEach((value, index) => {
        const td = element('td', '', value);
        td.dataset.label = item.columns[index];
        tr.append(td);
      });
      tbody.append(tr);
    });
    table.append(caption, thead, tbody);
    region.append(table);
  } else {
    const groups = element('div', 'closing-groups');
    groups.append(...item.groups.map((value, index) => group(value, index)));
    region.append(groups);
    if (item.focus) region.append(focus(item));
  }
  return region;
}

function render() {
  const item = deck.slides[current];
  slideElement.replaceChildren();
  slideElement.className = `slide layout-${item.layout}`;
  if (item.layout !== 'cover') {
    const header = element('header', 'slide-header');
    const title = element('h1', '', item.title);
    title.id = 'slide-title';
    header.append(title, element('p', 'slide-subtitle', item.subtitle));
    slideElement.append(header);
  }
  slideElement.append(content(item));
  const footer = element('footer', 'slide-footer');
  footer.append(element('span', 'slide-context', item.eyebrow), element('p', '', item.footnote));
  slideElement.append(footer);
  slideElement.setAttribute('aria-busy', 'false');
  document.querySelector('#counter').textContent = `${String(current + 1).padStart(2, '0')} / ${String(deck.slides.length).padStart(2, '0')}`;
  previous.disabled = current === 0;
  next.disabled = current === deck.slides.length - 1;
  document.querySelectorAll('.slide-link').forEach((link, index) => {
    if (index === current) link.setAttribute('aria-current', 'step');
    else link.removeAttribute('aria-current');
  });
  document.querySelector('#presenter-notes').textContent = item.notes;
  document.querySelector('#timing').textContent = `${item.seconds} seconds`;
  document.querySelector('#sources').replaceChildren(...item.sources.map(source => {
    const row = element('li');
    const url = source.match(/https?:\/\/\S+/)?.[0];
    if (url) {
      const link = element('a', '', source.slice(0, source.indexOf(url)).replace(/:\s*$/, '') || url);
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      row.append(link);
    } else row.textContent = source;
    return row;
  }));
  document.querySelector('#announcement').textContent = `Slide ${current + 1} of ${deck.slides.length}: ${item.title.replace(/\n/g, ' ')}`;
  document.title = item.layout === 'cover' ? `${deck.title} · ${item.subtitle}` : `${item.title.replace(/\n/g, ' ')} · ${deck.title}`;
}

function navigate(index) {
  if (!deck) return;
  const target = Math.max(0, Math.min(deck.slides.length - 1, index));
  if (target === current) return;
  window.location.hash = deck.slides[target].id;
}

function readHash() {
  if (!deck) return;
  let id;
  try { id = decodeURIComponent(window.location.hash.slice(1)); }
  catch { id = ''; }
  const index = deck.slides.findIndex(slide => slide.id === id);
  current = index >= 0 ? index : 0;
  render();
}

previous.addEventListener('click', () => navigate(current - 1));
next.addEventListener('click', () => navigate(current + 1));
window.addEventListener('hashchange', () => {
  readHash();
  window.scrollTo({ top: 0, behavior: 'instant' });
});
window.addEventListener('keydown', event => {
  if (!deck || event.altKey || event.ctrlKey || event.metaKey || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable) return;
  const index = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: deck.slides.length - 1 }[event.key];
  if (index !== undefined) {
    event.preventDefault();
    navigate(index);
  }
});

async function load() {
  try {
    const response = await fetch('deck.json');
    if (!response.ok) throw new Error('Presentation content is unavailable.');
    deck = await response.json();
    if (!Array.isArray(deck.slides) || !deck.slides.length) throw new Error('Presentation content is incomplete.');
    document.querySelector('#slide-links').replaceChildren(...deck.slides.map((slide, index) => {
      const link = element('a', 'slide-link');
      link.href = `#${slide.id}`;
      link.setAttribute('aria-label', `Slide ${index + 1}: ${slide.title.replace(/\n/g, ' ')}`);
      link.title = slide.title.replace(/\n/g, ' ');
      return link;
    }));
    readHash();
  } catch (error) {
    const title = element('h1', '', 'The presentation could not load');
    title.id = 'slide-title';
    const message = element('p', '', 'Please reload this page to try again.');
    const retry = element('button', 'nav-button next', 'Reload presentation');
    retry.addEventListener('click', () => window.location.reload());
    slideElement.replaceChildren(title, message, retry);
    slideElement.className = 'slide load-error';
    slideElement.setAttribute('aria-busy', 'false');
    document.querySelector('#notes').hidden = true;
    document.querySelector('.keyboard-hint').hidden = true;
    document.querySelector('#announcement').textContent = title.textContent;
  }
}

load();
