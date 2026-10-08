import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSearch, textMatches, filterProjectTree, filterFacetGroups } from '../../src/projectSearch.js';

test('typed text is compared without case or surrounding spaces', () => {
  assert.equal(normalizeSearch('  Tweed '), 'tweed');
  assert.equal(normalizeSearch(undefined), '');
  assert.equal(normalizeSearch(null), '');
});

test('composed and decomposed Korean count as the same text', () => {
  const composed = '바늘이야기';
  const decomposed = composed.normalize('NFD');
  assert.notEqual(composed, decomposed);
  assert.equal(textMatches(decomposed, normalizeSearch(composed)), true);
  assert.equal(textMatches(composed, normalizeSearch(decomposed)), true);
});

test('a piece of a name matches, wherever it falls', () => {
  assert.equal(textMatches("YR's | Faux Tweed Cardigan", normalizeSearch('tweed')), true);
  assert.equal(textMatches("YR's | Faux Tweed Cardigan", normalizeSearch('CARD')), true);
  assert.equal(textMatches("YR's | Faux Tweed Cardigan", normalizeSearch('socks')), false);
  assert.equal(textMatches('바늘이야기 (새틴 알파카)', normalizeSearch('알파카')), true);
});

test('every word has to be there, in any order', () => {
  assert.equal(textMatches("YR's | Faux Tweed Cardigan", normalizeSearch('cardigan tweed')), true);
  assert.equal(textMatches("YR's | Faux Tweed Cardigan", normalizeSearch('tweed socks')), false);
});

test('nothing typed matches everything', () => {
  assert.equal(textMatches('anything', ''), true);
});

const tree = {
  KNITS: {
    Log: [
      { title: "YR's | Faux Tweed Cardigan" },
      { title: "YR's | Cotton reknit" },
      { title: '바늘이야기' },
    ],
  },
  PLANTS: {
    'Cycadopsida (Cycads)': [{ title: '뽀쪽이-사고' }],
    'Magnoliopsida (Dicots)': [{ title: '옥나무' }, { title: '팡팡이' }],
  },
};

test('with no search the tree is left alone', () => {
  assert.equal(filterProjectTree(tree, ''), tree);
});

test('only the matching projects stay, under the categories and databases that hold them', () => {
  assert.deepEqual(filterProjectTree(tree, normalizeSearch('cotton')), {
    KNITS: { Log: [{ title: "YR's | Cotton reknit" }] },
  });
});

test('naming a category or database brings in all of its projects', () => {
  assert.deepEqual(filterProjectTree(tree, normalizeSearch('cycads')), {
    PLANTS: { 'Cycadopsida (Cycads)': [{ title: '뽀쪽이-사고' }] },
  });
  assert.deepEqual(Object.keys(filterProjectTree(tree, normalizeSearch('plants'))), ['PLANTS']);
  assert.equal(filterProjectTree(tree, normalizeSearch('plants')).PLANTS['Magnoliopsida (Dicots)'].length, 2);
});

test('a database and a project name can be combined', () => {
  assert.deepEqual(filterProjectTree(tree, normalizeSearch('knits tweed')), {
    KNITS: { Log: [{ title: "YR's | Faux Tweed Cardigan" }] },
  });
});

test('no match leaves an empty tree', () => {
  assert.deepEqual(filterProjectTree(tree, normalizeSearch('zzz')), {});
});

const facetGroups = {
  'HOME FOOD': {
    cuisine: { label: 'Cuisine', values: new Map([['Japanese', { color: 'red', count: 4 }], ['Korean', { color: 'blue', count: 2 }]]) },
    meal: { label: 'Meal Type', values: new Map([['Dinner', { color: 'gray', count: 5 }]]) },
  },
};

test('tagged values are matched on their own name', () => {
  const found = filterFacetGroups(facetGroups, normalizeSearch('korea'));
  assert.deepEqual(Object.keys(found['HOME FOOD']), ['cuisine']);
  assert.deepEqual([...found['HOME FOOD'].cuisine.values.keys()], ['Korean']);
  assert.equal(found['HOME FOOD'].cuisine.label, 'Cuisine');
  assert.deepEqual(found['HOME FOOD'].cuisine.values.get('Korean'), { color: 'blue', count: 2 });
});

test('naming a tag group brings in all of its values', () => {
  const found = filterFacetGroups(facetGroups, normalizeSearch('cuisine'));
  assert.deepEqual([...found['HOME FOOD'].cuisine.values.keys()], ['Japanese', 'Korean']);
  assert.equal(found['HOME FOOD'].meal, undefined);
});

test('no search leaves the tag groups alone, no match leaves none', () => {
  assert.equal(filterFacetGroups(facetGroups, ''), facetGroups);
  assert.deepEqual(filterFacetGroups(facetGroups, normalizeSearch('zzz')), {});
});
