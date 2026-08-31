import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectFacetSchema, buildLogFields, detectSwappedRoles, isFacetedSchema } from '../get-notion-logs.js';

// Fake relation resolver -- no network involved, since buildLogFields takes
// getRelationTitle as a parameter rather than closing over a real fetch.
const RELATION_TITLES = {
  'plant-page-1': 'Monstera',
  'project-page-1': 'Sweater #3',
};
const fakeGetRelationTitle = (id) => Promise.resolve(RELATION_TITLES[id] || 'General');

test('a lone relation with no paired rollup (no entity+type structure) is faceted, not tree', async () => {
  const props = {
    Name: { type: 'title', title: [{ plain_text: 'Watered the monstera' }] },
    Date: { type: 'date', date: { start: '2026-08-01' } },
    Plant: { type: 'relation', relation: [{ id: 'plant-page-1' }] },
  };

  const facetSchema = detectFacetSchema(props);
  assert.equal(facetSchema.length, 1);
  // No rollup anywhere, so there's no "type" dimension to pair with this
  // relation -- nothing to build a tree out of, so this is a single-facet
  // log rather than legacy tree mode.
  const isFaceted = isFacetedSchema(facetSchema);
  assert.equal(isFaceted, true);

  const result = await buildLogFields(props, facetSchema, isFaceted, fakeGetRelationTitle);
  assert.deepEqual(result.facets.plant, [{ name: 'Monstera', color: 'default' }]);
});

test('Home-Food-Log-shaped source (1 multi_select, no relation/rollup): faceted, not the generic Log/General fallback', async () => {
  const props = {
    Name: { type: 'title', title: [{ plain_text: 'Peach Jam' }] },
    'Log Date': { type: 'date', date: { start: '2026-08-30' } },
    Cuisine: { type: 'multi_select', multi_select: [{ name: 'Western', color: 'gray' }] },
  };

  const facetSchema = detectFacetSchema(props);
  assert.equal(facetSchema.length, 1);
  const isFaceted = isFacetedSchema(facetSchema);
  assert.equal(isFaceted, true);

  const result = await buildLogFields(props, facetSchema, isFaceted, fakeGetRelationTitle);
  assert.deepEqual(result.facets.cuisine, [{ name: 'Western', color: 'gray' }]);
});

test('Projects-shaped source (1 relation + 1 rollup): stays on the legacy single-value path', async () => {
  const props = {
    Name: { type: 'title', title: [{ plain_text: 'Cast on the ribbing' }] },
    Date: { type: 'date', date: { start: '2026-08-03' } },
    Project: { type: 'relation', relation: [{ id: 'project-page-1' }] },
    Type: { type: 'rollup', rollup: { array: [{ type: 'select', select: { name: 'Knitting', color: 'blue' } }] } },
  };

  const facetSchema = detectFacetSchema(props);
  assert.equal(facetSchema.length, 2);
  const isFaceted = isFacetedSchema(facetSchema);
  assert.equal(isFaceted, false);

  const result = await buildLogFields(props, facetSchema, isFaceted, fakeGetRelationTitle);
  assert.deepEqual(result, {
    projectName: 'Sweater #3',
    typeName: 'Knitting',
    typeColor: 'blue',
    facets: undefined,
  });
});

test('Projects-shaped source with an incidental extra select property (e.g. Payment Method): still stays on the tree path', async () => {
  const props = {
    Name: { type: 'title', title: [{ plain_text: 'Cast on the ribbing' }] },
    Date: { type: 'date', date: { start: '2026-08-03' } },
    Project: { type: 'relation', relation: [{ id: 'project-page-1' }] },
    Type: { type: 'rollup', rollup: { array: [{ type: 'select', select: { name: 'Knitting', color: 'blue' } }] } },
    'Payment Method': { type: 'select', select: { name: 'Card', color: 'gray' } },
  };

  const facetSchema = detectFacetSchema(props);
  assert.equal(facetSchema.length, 3);
  // A Relation+Rollup pair means this is still a progress-tracking source
  // (entity + type), even though the extra select property alone would
  // otherwise cross the 3-facet threshold into the flat/independent-tags
  // rendering meant for a source like Food Log.
  const isFaceted = isFacetedSchema(facetSchema);
  assert.equal(isFaceted, false);

  const result = await buildLogFields(props, facetSchema, isFaceted, fakeGetRelationTitle);
  assert.deepEqual(result, {
    projectName: 'Sweater #3',
    typeName: 'Knitting',
    typeColor: 'blue',
    facets: undefined,
  });
});

test('Food-Log-shaped source (3 select/multi_select properties): switches to the faceted path', async () => {
  const props = {
    Name: { type: 'title', title: [{ plain_text: 'Ramen burger' }] },
    Date: { type: 'date', date: { start: '2026-08-10' } },
    Establishment: { type: 'select', select: { name: 'Restaurant', color: 'blue' } },
    Cuisine: { type: 'multi_select', multi_select: [{ name: 'Japanese', color: 'red' }, { name: 'American', color: 'blue' }] },
    'Meal Type': { type: 'select', select: { name: 'Dinner', color: 'purple' } },
  };

  const facetSchema = detectFacetSchema(props);
  assert.equal(facetSchema.length, 3);
  assert.deepEqual(facetSchema.map(f => f.key), ['establishment', 'cuisine', 'mealType']);
  const isFaceted = isFacetedSchema(facetSchema);
  assert.equal(isFaceted, true);

  const result = await buildLogFields(props, facetSchema, isFaceted, fakeGetRelationTitle);
  assert.ok(result.facets, 'facets map should be present for a 3+-facet source');
  assert.deepEqual(result.facets.establishment, [{ name: 'Restaurant', color: 'blue' }]);
  assert.deepEqual(result.facets.cuisine, [
    { name: 'Japanese', color: 'red' },
    { name: 'American', color: 'blue' },
  ]);
  assert.deepEqual(result.facets.mealType, [{ name: 'Dinner', color: 'purple' }]);

  // Legacy fields are synthesized from facet #1/#2's first value as a
  // safety net for any caller that isn't facet-aware yet.
  assert.equal(result.projectName, 'Restaurant');
  assert.equal(result.typeName, 'Japanese');
  assert.equal(result.typeColor, 'red');
});

test('a multi-relation facet resolves every linked page, not just the first', async () => {
  const props = {
    Name: { type: 'title', title: [{ plain_text: 'Dinner with friends' }] },
    Date: { type: 'date', date: { start: '2026-08-12' } },
    Cuisine: { type: 'select', select: { name: 'Fusion', color: 'purple' } },
    'Meal Type': { type: 'select', select: { name: 'Dinner', color: 'purple' } },
    Companions: { type: 'relation', relation: [{ id: 'plant-page-1' }, { id: 'project-page-1' }] },
  };

  const facetSchema = detectFacetSchema(props);
  assert.equal(facetSchema.length, 3);
  const isFaceted = true;

  const result = await buildLogFields(props, facetSchema, isFaceted, fakeGetRelationTitle);
  const companionsKey = facetSchema.find(f => f.name === 'Companions').key;
  assert.deepEqual(result.facets[companionsKey], [
    { name: 'Monstera', color: 'default' },
    { name: 'Sweater #3', color: 'default' },
  ]);
});

test('duplicate values within one property are de-duped', async () => {
  const props = {
    Name: { type: 'title', title: [{ plain_text: 'Leftovers' }] },
    Date: { type: 'date', date: { start: '2026-08-14' } },
    Establishment: { type: 'select', select: { name: 'Home', color: 'green' } },
    Cuisine: { type: 'multi_select', multi_select: [{ name: 'Italian', color: 'green' }, { name: 'Italian', color: 'green' }] },
    'Meal Type': { type: 'select', select: { name: 'Lunch', color: 'orange' } },
  };

  const facetSchema = detectFacetSchema(props);
  const result = await buildLogFields(props, facetSchema, true, fakeGetRelationTitle);
  assert.deepEqual(result.facets.cuisine, [{ name: 'Italian', color: 'green' }]);
});

// A tenant's real "Projects" database can wire the Relation and Rollup to
// the opposite roles from the norm -- the Relation holding a project's
// type/category (few distinct values reused across many rows) and the
// Rollup holding the project's own identity (a near-distinct value per
// row). detectSwappedRoles catches this from the data itself: an identity
// dimension has more distinct values across a database than a type
// dimension ever does.
function makeProgressPage(relationId, rollupName) {
  return {
    properties: {
      'Field A': { type: 'relation', relation: [{ id: relationId }] },
      'Field B': { type: 'rollup', rollup: { array: [{ type: 'select', select: { name: rollupName, color: 'pink' } }] } },
    },
  };
}

test('detectSwappedRoles: rollup with more distinct values than the relation is treated as the identity', () => {
  // 6 rows, only 2 distinct relation ids ("type"-like), 6 distinct rollup
  // names ("identity"-like) -- exactly the shape from the reported bug.
  const pages = [
    makeProgressPage('type-web', 'Branding'),
    makeProgressPage('type-web', "Creator's Calendar App"),
    makeProgressPage('type-3d', 'Greenhouse for Sprouts'),
    makeProgressPage('type-3d', 'Hanok Kit'),
    makeProgressPage('type-3d', 'Kokedama 01'),
    makeProgressPage('type-web', 'Life Log'),
  ];
  assert.equal(detectSwappedRoles(pages, 'Field A', 'Field B'), true);
});

test('detectSwappedRoles: relation with more distinct values than the rollup stays unswapped', () => {
  // The normal shape: many distinct relation ids (one per project), one
  // rollup value ("type") reused across several rows.
  const pages = [
    makeProgressPage('sweater-1', 'Knitting'),
    makeProgressPage('sweater-2', 'Knitting'),
    makeProgressPage('scarf-1', 'Knitting'),
    makeProgressPage('hat-1', 'Knitting'),
  ];
  assert.equal(detectSwappedRoles(pages, 'Field A', 'Field B'), false);
});

test('detectSwappedRoles: too few rows to trust cardinality falls back to property naming', () => {
  const pages = [makeProgressPage('a', 'x'), makeProgressPage('b', 'y')];
  // Relation named "Type", rollup named "Project" -- naming says swap.
  assert.equal(detectSwappedRoles(pages, 'Type', 'Project'), true);
  // Relation named "Project", rollup named "Type" -- naming says don't.
  assert.equal(detectSwappedRoles(pages, 'Project', 'Type'), false);
});

test('buildLogFields: rolesSwapped routes the rollup value to projectName and the relation to typeName', async () => {
  const props = {
    Name: { type: 'title', title: [{ plain_text: 'Progress update' }] },
    Date: { type: 'date', date: { start: '2026-08-20' } },
    'Field A': { type: 'relation', relation: [{ id: 'type-web' }] },
    'Field B': { type: 'rollup', rollup: { array: [{ type: 'select', select: { name: 'Branding', color: 'pink' } }] } },
  };
  const getRelationTitle = (id) => Promise.resolve(id === 'type-web' ? 'Gen / Web' : 'General');

  const facetSchema = detectFacetSchema(props);
  const result = await buildLogFields(props, facetSchema, false, getRelationTitle, true);
  assert.equal(result.projectName, 'Branding');
  assert.equal(result.typeName, 'Gen / Web');
  assert.equal(result.typeColor, 'default');
});
